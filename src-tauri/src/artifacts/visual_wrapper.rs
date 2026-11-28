//! The document an inline visual is shown, exported and drawn in: Zorvo's tokens as CSS variables
//! around the cleaned markup. One builder, so the screen and the exports cannot drift.

use std::fmt::Write as _;
use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
}

struct Token {
    name: String,
    dark: String,
    light: String,
}

/// The colour tokens of `docs/design-system/tokens.json`, which a test keeps equal to `globals.css`.
fn tokens() -> &'static [Token] {
    static TOKENS: OnceLock<Vec<Token>> = OnceLock::new();
    TOKENS.get_or_init(|| {
        let file: serde_json::Value =
            serde_json::from_str(include_str!("../../../docs/design-system/tokens.json"))
                .expect("tokens.json is valid JSON");
        let text = |value: &serde_json::Value| value.as_str().map(str::to_string);
        file["color"]["tokens"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|token| {
                        Some(Token {
                            name: text(&token["name"])?,
                            dark: text(&token["value"]["dark"])?,
                            light: text(&token["value"]["light"])?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// The document's own policy, so a saved copy opened in a browser loads nothing either: the
/// chat's frame also inherits Zorvo's CSP, but an exported file has only this.
const POLICY: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">";

/// A colour token's value in one theme.
pub fn token_value(name: &str, theme: Theme) -> Option<&'static str> {
    tokens()
        .iter()
        .find(|token| token.name == name)
        .map(|token| match theme {
            Theme::Dark => token.dark.as_str(),
            Theme::Light => token.light.as_str(),
        })
}

pub fn token_names() -> Vec<String> {
    tokens().iter().map(|token| token.name.clone()).collect()
}

fn variables(theme: Theme) -> String {
    let mut out = String::new();
    for token in tokens() {
        let value = match theme {
            Theme::Dark => &token.dark,
            Theme::Light => &token.light,
        };
        let _ = write!(out, "--{}: {};", token.name, value);
    }
    out
}

/// A whole document around cleaned `markup`. `None` follows the system's scheme on a transparent
/// background (the chat's frame); a fixed theme paints the `sheet` colour (a PNG has no page
/// behind it).
pub fn document(markup: &str, fixed: Option<Theme>) -> String {
    let (scheme, colours, background) = match fixed {
        None => (
            "light dark",
            format!(
                ":root{{{}}}@media (prefers-color-scheme: light){{:root{{{}}}}}",
                variables(Theme::Dark),
                variables(Theme::Light)
            ),
            "background: transparent",
        ),
        Some(theme) => (
            if theme == Theme::Dark {
                "dark"
            } else {
                "light"
            },
            format!(":root{{{}}}", variables(theme)),
            "background: var(--sheet)",
        ),
    };
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">{POLICY}<style>\
:root{{color-scheme: {scheme}}}{colours}\
html,body{{margin:0}}\
body{{display: flow-root; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: var(--fg); {background}; overflow-x: hidden}}\
svg, img {{ max-width: 100%; height: auto; }}\
@media (prefers-reduced-motion: reduce){{*{{animation:none!important;transition:none!important}}}}\
</style></head><body>{markup}</body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variable_comes_from_tokens_json() {
        let names = token_names();
        assert!(names.contains(&"fg".to_string()) && names.contains(&"sheet".to_string()));
        let doc = document("<p>a</p>", None);
        for name in &names {
            assert!(doc.contains(&format!("--{name}:")), "{name}");
        }
    }
    #[test]
    fn follows_the_scheme_unless_fixed() {
        let live = document("<p>a</p>", None);
        assert!(
            live.contains("prefers-color-scheme: light")
                && live.contains("background: transparent")
        );
        let light = document("<p>a</p>", Some(Theme::Light));
        assert!(
            !light.contains("prefers-color-scheme") && light.contains("background: var(--sheet)")
        );
    }
    #[test]
    fn ends_motion_and_fits_media_to_the_column() {
        let doc = document("<svg width=\"4000\" height=\"10\"></svg>", None);
        assert!(doc.contains("prefers-reduced-motion: reduce"));
        assert!(doc.contains("svg, img { max-width: 100%; height: auto; }"));
        assert!(doc.contains("overflow-x: hidden"));
    }
    #[test]
    fn has_no_script_and_starts_as_a_document() {
        let doc = document("<p>a</p>", None);
        assert!(doc.starts_with("<!doctype html>") && !doc.to_lowercase().contains("<script"));
    }

    #[test]
    fn every_reader_gets_a_policy_that_loads_nothing() {
        for fixed in [None, Some(Theme::Dark)] {
            let doc = document("<p style=\"background:url(https://e.com/p)\">a</p>", fixed);
            assert!(doc.contains(
                "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">"
            ));
            assert!(doc.find("Content-Security-Policy").unwrap() < doc.find("<style>").unwrap());
        }
    }

    #[test]
    fn a_first_margin_stays_inside_the_body() {
        assert!(document("<h3>a</h3>", None).contains("display: flow-root"));
    }
}
