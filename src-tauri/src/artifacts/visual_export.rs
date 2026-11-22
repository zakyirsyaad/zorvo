//! Saving and copying an inline visual: the stored markup as a file, or a picture of it.

use std::sync::mpsc;
use std::time::Duration;

use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG};
use objc2_foundation::NSData;
use tauri::AppHandle;

use super::commands::clean_file_stem;
pub use super::visual_clean::VisualKind;
use super::visual_wrapper::token_value;
pub use super::visual_wrapper::Theme;

pub const VISUAL_EXPORT_FAILED: &str = "Zorvo could not save that visual.";
pub const VISUAL_COPY_FAILED: &str = "Zorvo could not copy that visual.";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    Svg,
    Html,
    Png,
}

impl Format {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "svg" => Some(Self::Svg),
            "html" => Some(Self::Html),
            "png" => Some(Self::Png),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Html => "html",
            Self::Png => "png",
        }
    }
}

/// What a visual can be saved as: its own markup, and a picture.
pub fn offered(kind: VisualKind) -> [Format; 2] {
    match kind {
        VisualKind::Svg => [Format::Svg, Format::Png],
        VisualKind::Html => [Format::Html, Format::Png],
    }
}

/// The name the save dialog starts with: the title's letters and digits, never a path.
pub fn export_name(title: &str, format: Format) -> String {
    format!(
        "{}.{}",
        clean_file_stem(title, "visual"),
        format.extension()
    )
}

/// The size a picture is drawn at, as the webview measured the block: refused outside sane bounds.
pub fn checked_size(width: u32, height: u32) -> Option<(u32, u32)> {
    ((200..=2000).contains(&width) && (1..=8000).contains(&height)).then_some((width, height))
}

pub fn theme_of(name: &str) -> Option<Theme> {
    match name {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    }
}

/// What stands in for a CSS reference that would leave the file.
const NO_REFERENCE: &str = "none";
const CSS_REFERENCES: [&str; 3] = ["@import", "url(", "image-set("];
const QUOTES: [&str; 5] = ["\"", "'", "&quot;", "&#34;", "&#39;"];

fn is_local_reference(argument: &str) -> bool {
    let mut inner = argument.trim();
    while let Some(bare) = QUOTES.iter().find_map(|quote| inner.strip_prefix(quote)) {
        inner = bare.trim_start();
    }
    inner.starts_with('#') || inner.to_ascii_lowercase().starts_with("data:image/")
}

/// The markup with every CSS reference that is not a fragment or an inline image taken out:
/// `@import` rules go, and an outside `url()` or any `image-set()` becomes `none`.
fn without_references(markup: &str) -> String {
    let lower = markup.to_ascii_lowercase();
    let mut out = String::with_capacity(markup.len());
    let mut at = 0;
    while let Some((start, found)) = CSS_REFERENCES
        .iter()
        .filter_map(|name| lower[at..].find(name).map(|offset| (at + offset, *name)))
        .min_by_key(|(start, _)| *start)
    {
        out.push_str(&markup[at..start]);
        let after = start + found.len();
        let tail = &markup[after..];
        if found == "@import" {
            at = match tail.find([';', '<']) {
                Some(end) if tail[end..].starts_with(';') => after + end + 1,
                Some(end) => after + end,
                None => markup.len(),
            };
            continue;
        }
        let (argument, next) = match tail.find(')') {
            Some(close) => (&tail[..close], after + close + 1),
            None => ("", after + tail.find('<').unwrap_or(tail.len())),
        };
        if found == "url(" && tail.contains(')') && is_local_reference(argument) {
            out.push_str(&markup[start..next]);
        } else {
            out.push_str(NO_REFERENCE);
        }
        at = next;
    }
    out.push_str(&markup[at..]);
    out
}

/// The text with CSS escapes read the way a style sheet reads them (`\75` and `\u` are both u).
fn css_unescaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let mut hex = String::new();
        while hex.len() < 6 {
            match chars.peek() {
                Some(digit) if digit.is_ascii_hexdigit() => hex.push(*digit),
                _ => break,
            }
            chars.next();
        }
        if hex.is_empty() {
            out.extend(chars.next());
            continue;
        }
        if chars.peek().is_some_and(|next| next.is_whitespace()) {
            chars.next();
        }
        let code = u32::from_str_radix(&hex, 16).unwrap_or(0);
        out.push(
            char::from_u32(code)
                .filter(|c| *c != '\0')
                .unwrap_or('\u{fffd}'),
        );
    }
    out
}

/// A saved file has no content policy around it, so nothing in it may name the network. An
/// escaped spelling (`u\72l(`) is found by reading the escapes; markup whose escapes hide no
/// reference keeps them as written.
fn without_external_css(markup: &str) -> String {
    let plain = without_references(markup);
    if !plain.contains('\\') {
        return plain;
    }
    let unescaped = css_unescaped(&plain);
    let checked = without_references(&unescaped);
    if checked == unescaped {
        plain
    } else {
        checked
    }
}

/// An SVG visual as a file other programs open: with its namespace, with Zorvo's colour
/// variables turned into the theme's values (a standalone file defines none), and without the
/// one named entity HTML writes that XML does not know.
pub fn standalone_svg(markup: &str, theme: Theme) -> String {
    let local = without_external_css(markup);
    let mut out = String::with_capacity(local.len() + 64);
    let mut rest = local.as_str();
    while let Some(at) = rest.find("var(") {
        let (before, from) = rest.split_at(at);
        out.push_str(before);
        let Some(close) = from.find(')') else {
            break;
        };
        let name = from[4..close].trim();
        match name
            .strip_prefix("--")
            .and_then(|name| token_value(name, theme))
        {
            Some(value) => out.push_str(value),
            None => out.push_str(&from[..=close]),
        }
        rest = &from[close + 1..];
    }
    out.push_str(rest);
    let out = out.replace("&nbsp;", "&#160;");
    let opening = out.find('>').map_or(out.as_str(), |end| &out[..end]);
    match out.find("<svg") {
        Some(at) if !opening.contains("xmlns=") => {
            let (head, tail) = out.split_at(at + 4);
            format!("{head} xmlns=\"http://www.w3.org/2000/svg\"{tail}")
        }
        _ => out,
    }
}

/// Puts a PNG on the macOS clipboard, replacing what it held.
pub fn copy_png(app: &AppHandle, png: Vec<u8>) -> Result<(), String> {
    let failed = || VISUAL_COPY_FAILED.to_string();
    let (sent, received) = mpsc::channel::<bool>();
    app.run_on_main_thread(move || {
        // SAFETY: AppKit's general pasteboard, used on the main thread; `data` owns its bytes
        // and the pasteboard keeps its own reference to them.
        #[allow(unused_unsafe)]
        let is_set = unsafe {
            let board = NSPasteboard::generalPasteboard();
            board.clearContents();
            let data = NSData::with_bytes(&png);
            board.setData_forType(Some(&data), NSPasteboardTypePNG)
        };
        let _ = sent.send(is_set);
    })
    .map_err(|_| failed())?;
    match received.recv_timeout(Duration::from_secs(5)) {
        Ok(true) => Ok(()),
        _ => Err(failed()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_format_parses_from_its_name_only() {
        assert_eq!(Format::parse("svg"), Some(Format::Svg));
        assert_eq!(Format::parse("html"), Some(Format::Html));
        assert_eq!(Format::parse("png"), Some(Format::Png));
        assert_eq!(Format::parse("pdf"), None);
        assert_eq!(Format::parse("PNG"), None);
    }

    #[test]
    fn a_visual_offers_its_own_markup_and_a_picture() {
        assert_eq!(offered(VisualKind::Svg), [Format::Svg, Format::Png]);
        assert_eq!(offered(VisualKind::Html), [Format::Html, Format::Png]);
    }

    #[test]
    fn a_file_name_comes_from_the_title_and_holds_no_path() {
        let name = export_name("Alur / bot ../x", Format::Png);
        assert!(
            name.ends_with(".png") && !name.contains('/') && !name.contains(".."),
            "{name}"
        );
        assert_eq!(export_name("///", Format::Svg), "visual.svg");
        assert_eq!(export_name("Flow", Format::Html), "Flow.html");
    }

    #[test]
    fn a_picture_is_drawn_only_at_a_sane_size() {
        assert_eq!(checked_size(700, 300), Some((700, 300)));
        assert_eq!(checked_size(200, 1), Some((200, 1)));
        assert_eq!(checked_size(2000, 8000), Some((2000, 8000)));
        for (width, height) in [(199, 300), (2001, 300), (700, 0), (700, 8001)] {
            assert_eq!(checked_size(width, height), None);
        }
    }

    #[test]
    fn a_theme_parses_from_its_name_only() {
        assert_eq!(theme_of("dark"), Some(Theme::Dark));
        assert_eq!(theme_of("light"), Some(Theme::Light));
        assert_eq!(theme_of("sepia"), None);
    }

    #[test]
    fn a_saved_svg_stands_alone() {
        let stored = "<svg viewBox=\"0 0 4 4\"><rect fill=\"var(--chip)\" stroke=\"var(--border)\"></rect><text style=\"fill: var( --fg )\">a&nbsp;b</text></svg>";
        let dark = standalone_svg(stored, Theme::Dark);
        assert!(dark.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox"));
        assert!(!dark.contains("var(") && !dark.contains("&nbsp;") && dark.contains("a&#160;b"));
        assert_ne!(dark, standalone_svg(stored, Theme::Light));
    }

    #[test]
    fn a_saved_svg_keeps_its_own_namespace_and_unknown_variables() {
        let own =
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect fill=\"var(--mine)\"></rect></svg>";
        let out = standalone_svg(own, Theme::Dark);
        assert_eq!(out.matches("xmlns=").count(), 1);
        assert!(out.contains("var(--mine)"));
    }

    #[test]
    fn a_saved_svg_loads_nothing_from_the_network() {
        for hostile in [
            "<svg><style>@import url(https://e.com/t.css);.a{fill:red}</style><rect class=\"a\"></rect></svg>",
            "<svg><style>@IMPORT 'https://e.com/t.css';</style><rect></rect></svg>",
            "<svg><style>.a{background:URL( \"//e.com/p.png\" )}</style><rect></rect></svg>",
            "<svg><rect style=\"background:url(&quot;https://e.com/p.png&quot;)\"></rect></svg>",
            "<svg><style>.a{background:image-set('https://e.com/p.png' 1x)}</style><rect></rect></svg>",
            "<svg><style>@\\69mport 'https://e.com/t.css';</style><rect></rect></svg>",
            "<svg><style>.a{background:u\\72l(https://e.com/p.png)}</style><rect></rect></svg>",
            "<svg><rect fill=\"url(https://e.com/g.svg#g)\"></rect></svg>",
        ] {
            let out = standalone_svg(hostile, Theme::Dark).to_lowercase();
            assert!(!out.contains("e.com"), "{out}");
            assert!(!out.contains("@import"), "{out}");
        }
    }

    #[test]
    fn a_saved_svg_keeps_its_own_references_and_escapes() {
        let own = "<svg xmlns=\"http://www.w3.org/2000/svg\"><style>.q::before{content:\"\\201C\"}.a{fill:red}</style><path marker-end=\"url(#m)\" fill=\"url( '#g' )\"></path><rect style=\"background:url(data:image/png;base64,AAAA)\"></rect><text>C:\\temp</text></svg>";
        assert_eq!(standalone_svg(own, Theme::Dark), own);
    }
}
