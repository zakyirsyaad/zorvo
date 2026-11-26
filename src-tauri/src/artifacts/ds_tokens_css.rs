//! `tokens.css` for one theme of a design system, built from its `tokens.json`: the variables
//! `bundle.css` and previews read, as `docs/design-system/viewer/tokens-css.ts` makes them.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 4.

use super::ds_tokens::{DsFont, DsTheme, DsTokens};
use super::protocol::encode_segment;

/// `None` for a theme id the tokens do not have.
///
/// The URL's theme goes on `:root`, then every theme gets a `[data-theme]` block so a subtree
/// can pin another one. There is no `prefers-color-scheme` block: the theme is chosen.
pub fn tokens_css(tokens: &DsTokens, theme: &str) -> Option<String> {
    let index = tokens.themes.iter().position(|t| t.id == theme)?;
    let families: Vec<String> = tokens
        .families
        .iter()
        .filter(|(_, stack)| is_safe_stack(stack))
        .map(|(name, stack)| format!("--font-{}: {};", css_ident(name), stack))
        .collect();
    let lines: Vec<String> = tokens
        .fonts
        .iter()
        .filter_map(font_face)
        .chain(std::iter::once(block(
            ":root",
            &tokens.themes[index],
            index,
            tokens,
            &families,
        )))
        .chain(tokens.themes.iter().enumerate().map(|(at, each)| {
            block(
                &format!("[data-theme=\"{}\"]", each.id),
                each,
                at,
                tokens,
                &families,
            )
        }))
        .collect();
    Some(format!("{}\n", lines.join("\n")))
}

fn block(
    selector: &str,
    theme: &DsTheme,
    index: usize,
    tokens: &DsTokens,
    families: &[String],
) -> String {
    let scheme = match theme.id.as_str() {
        "dark" | "light" => format!("color-scheme: {}; ", theme.id),
        _ => String::new(),
    };
    let vars: Vec<String> = tokens
        .tokens
        .iter()
        .map(|t| format!("--{}: {};", css_ident(&t.name), t.values[index]))
        .chain(families.iter().cloned())
        .collect();
    format!("{selector} {{ {scheme}{} }}", vars.join(" "))
}

/// A font stack lands in a declaration: printable text that cannot end it or open a rule.
fn is_safe_stack(stack: &str) -> bool {
    !stack.trim().is_empty()
        && !stack
            .chars()
            .any(|c| c.is_control() || matches!(c, ';' | '{' | '}' | '<' | '\\'))
}

const FONT_EXTENSIONS: &[&str] = &["woff2", "woff", "ttf", "otf"];
const FONT_STYLES: &[&str] = &["normal", "italic", "oblique"];
const DEFAULT_WEIGHT: u16 = 400;

/// An `@font-face` rule for a font whose file is under `fonts/`, with its URL relative to
/// `tokens.css`; `None` for any other font.
fn font_face(font: &DsFont) -> Option<String> {
    let file = font.file.as_deref()?;
    let rest = file.strip_prefix("fonts/")?;
    let segments: Vec<&str> = rest.split('/').collect();
    let plain = segments
        .iter()
        .all(|s| !s.is_empty() && *s != "." && *s != ".." && !s.contains('\\'));
    let extension = rest.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())?;
    if !plain || !FONT_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }
    let family_ok = !font.family.trim().is_empty()
        && !font
            .family
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '\\' | ';' | '{' | '}' | '<'));
    if !family_ok {
        return None;
    }
    let url: Vec<String> = std::iter::once("fonts".to_string())
        .chain(segments.iter().map(|s| encode_segment(s)))
        .collect();
    let style = font
        .style
        .as_deref()
        .filter(|style| FONT_STYLES.contains(style))
        .unwrap_or("normal");
    Some(format!(
        "@font-face {{ font-family: \"{}\"; src: url(\"{}\"); font-weight: {}; font-style: {style}; }}",
        font.family,
        url.join("/"),
        font.weight.unwrap_or(DEFAULT_WEIGHT),
    ))
}

/// A token name as a CSS identifier, escaped as `CSS.escape` does.
pub fn css_ident(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    if chars == ['-'] {
        return "\\-".to_string();
    }
    chars
        .iter()
        .enumerate()
        .map(|(at, &c)| {
            let leading_digit = c.is_ascii_digit() && (at == 0 || (at == 1 && chars[0] == '-'));
            if c == '\0' {
                "\u{FFFD}".to_string()
            } else if c.is_control() || leading_digit {
                format!("\\{:x} ", c as u32)
            } else if !c.is_ascii() || c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c.to_string()
            } else {
                format!("\\{c}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::ds_tokens::parse_tokens;
    use super::*;
    use std::path::Path;

    const UPDATE: &str = "ZORVO_UPDATE_FIXTURES";

    fn css(json: &str, theme: &str) -> String {
        tokens_css(&parse_tokens(json.as_bytes()).expect("tokens read"), theme).expect("a theme")
    }

    const TWO: &str = r##"{"color": {"themes": [{"id": "dark", "name": "Dark"}, {"id": "light", "name": "Light"}],
        "tokens": [{"name": "ink", "value": {"dark": "#fff", "light": "#000"}}]},
        "motion": {"tokens": [{"name": "duration-quick", "value": "120ms"}]},
        "type": {"families": {"sans": "-apple-system, sans-serif", "bad": "a;b"}}}"##;

    #[test]
    fn css_ident_escapes_like_css_escape() {
        assert_eq!(css_ident("space-0.5"), r"space-0\.5");
        assert_eq!(css_ident("1x"), r"\31 x");
        assert_eq!(css_ident("a_b-c"), "a_b-c");
        assert_eq!(css_ident("-1"), r"-\31 ");
        assert_eq!(css_ident("-"), r"\-");
    }

    #[test]
    fn root_holds_the_url_theme_then_each_theme_has_a_block() {
        let text = css(TWO, "light");
        assert!(
            text.starts_with(":root { color-scheme: light; --ink: #000;"),
            "{text}"
        );
        assert!(text.contains("[data-theme=\"dark\"] { color-scheme: dark; --ink: #fff;"));
        assert!(text.contains("[data-theme=\"light\"] { color-scheme: light; --ink: #000;"));
        assert!(!text.contains("prefers-color-scheme"));
        assert!(text.ends_with("}\n"));
        assert_eq!(text.lines().count(), 3);
    }

    #[test]
    fn color_scheme_only_for_dark_and_light() {
        let text = css(
            r##"{"color": {"themes": [{"id": "brand", "name": "Brand"}],
                "tokens": [{"name": "ink", "value": "#123"}]}}"##,
            "brand",
        );
        assert_eq!(
            text,
            ":root { --ink: #123; }\n[data-theme=\"brand\"] { --ink: #123; }\n"
        );
    }

    #[test]
    fn every_family_but_type_becomes_variables() {
        let text = css(TWO, "dark");
        assert!(text.contains("--duration-quick: 120ms;"));
        assert!(text.contains("--font-sans: -apple-system, sans-serif;"));
        assert!(
            !text.contains("--font-bad"),
            "a stack that breaks a rule is left out"
        );
    }

    #[test]
    fn font_face_only_for_a_file_under_fonts() {
        let face = |font: &str| css(&format!(r#"{{"type": {{"fonts": [{font}]}}}}"#), "default");
        let text = face(r#"{"family": "Acme", "file": "fonts/Acme Sans.woff2", "weight": 600}"#);
        assert!(
            text.starts_with(
                "@font-face { font-family: \"Acme\"; src: url(\"fonts/Acme%20Sans.woff2\"); font-weight: 600; font-style: normal; }\n:root {"
            ),
            "{text}"
        );
        for font in [
            r#"{"family": "Acme", "file": "../x.woff2"}"#,
            r#"{"family": "Acme", "file": "fonts/../x.woff2"}"#,
            r#"{"family": "Acme", "file": "fonts/x.exe"}"#,
            r#"{"family": "Ac\"me", "file": "fonts/x.woff2"}"#,
            r#"{"family": "Acme"}"#,
        ] {
            assert!(!face(font).contains("@font-face"), "{font}");
        }
        let italic = face(r#"{"family": "Acme", "file": "fonts/a/b.ttf", "style": "italic"}"#);
        assert!(
            italic.contains("src: url(\"fonts/a/b.ttf\"); font-weight: 400; font-style: italic; }")
        );
    }

    #[test]
    fn unknown_theme_is_none() {
        let tokens = parse_tokens(TWO.as_bytes()).unwrap();
        assert_eq!(tokens_css(&tokens, "sepia"), None);
        assert_eq!(tokens_css(&tokens, "../dark"), None);
    }

    #[test]
    fn zorvo_dark_matches_the_fixture() {
        let tokens = parse_tokens(include_bytes!("../../../docs/design-system/tokens.json"))
            .expect("Zorvo's tokens read");
        let text = tokens_css(&tokens, "dark").expect("dark");
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ds-zorvo-tokens.css");
        if std::env::var_os(UPDATE).is_some() {
            std::fs::write(&fixture, &text).expect("write the fixture");
            return;
        }
        let expected = std::fs::read_to_string(&fixture)
            .unwrap_or_else(|_| panic!("no fixture yet: run this test once with {UPDATE}=1"));
        assert_eq!(text, expected);
    }
}
