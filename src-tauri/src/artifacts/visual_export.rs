//! Saving and copying an inline visual: the stored markup as a file, or a picture of it.

use std::sync::mpsc;
use std::time::Duration;

use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG};
use objc2_foundation::NSData;
use tauri::AppHandle;

use super::commands::clean_file_stem;
pub use super::visual_clean::VisualKind;
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
}
