//! A design system's brand book, `README.md` and its other sections, rendered to clean HTML.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 3.

use std::collections::HashSet;

use ammonia::{Builder, UrlRelative};
use pulldown_cmark::{html, Options, Parser};

use super::protocol::{decode_segment, encode_segment};

const ID_PREFIX: &str = "ds-u-";
const MAX_FRAGMENT_CHARS: usize = 100;

/// Markdown to HTML with no script, handler, `name` or outside link: every `id` and every
/// `#fragment` link is prefixed `ds-u-`, so a section cannot clobber the shell's globals, and
/// an `<img>` keeps its `src` only when it names a file inside the system.
///
/// `image_base` is the shell-relative folder of the section file, such as `t/dark/f/`; the
/// protocol's own path check still refuses a file that leaves the system's folder.
pub fn markdown_html(source: &str, image_base: &str) -> String {
    let mut rendered = String::new();
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH;
    html::push_html(&mut rendered, Parser::new_ext(source, options));
    let base = image_base.to_string();
    let mut builder = Builder::default();
    builder
        .rm_generic_attributes(["name", "lang", "title"])
        .add_generic_attributes(["id"])
        .id_prefix(Some(ID_PREFIX))
        .add_tag_attributes("a", ["href"])
        .add_tag_attributes("img", ["src", "alt"])
        // No scheme is allowed, so no absolute URL survives; relative ones reach the filter.
        .url_schemes(HashSet::new())
        .url_relative(UrlRelative::PassThrough)
        .link_rel(None)
        .attribute_filter(
            move |element, attribute, value| match (element, attribute) {
                ("a", "href") => fragment(value).map(|id| format!("#{ID_PREFIX}{id}").into()),
                ("img", "src") => plain_relative(value).map(|path| format!("{base}{path}").into()),
                _ => Some(value.into()),
            },
        );
    builder.clean(&rendered).to_string()
}

/// The id of a `#fragment` link: `[A-Za-z0-9_-]{1,100}`.
fn fragment(value: &str) -> Option<&str> {
    let id = value.strip_prefix('#')?;
    let fits = (1..=MAX_FRAGMENT_CHARS).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    fits.then_some(id)
}

/// A plain relative path, its segments decoded and encoded again; `None` for a scheme, a
/// leading `/`, a `\`, an empty, `.` or `..` segment, or an escape that does not decode.
fn plain_relative(value: &str) -> Option<String> {
    if value.contains(':') || value.contains('\\') || value.starts_with('/') {
        return None;
    }
    let segments = value
        .split('/')
        .map(|segment| {
            let decoded = decode_segment(segment)?;
            let plain = !decoded.is_empty() && decoded != "." && decoded != "..";
            plain.then(|| encode_segment(&decoded))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(segments.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html(source: &str) -> String {
        markdown_html(source, "t/dark/f/")
    }

    #[test]
    fn drops_script_handlers_and_javascript_urls() {
        let out =
            html("Hi\n\n<script>x</script>\n\n<img src=x onerror=y>\n\n[a](javascript:alert(1))");
        assert!(out.contains("Hi"), "{out}");
        for word in ["<script", "onerror", "javascript:"] {
            assert!(!out.contains(word), "{word} in {out}");
        }
    }

    #[test]
    fn drops_outside_links_keeps_fragments_prefixed() {
        let out = html("[x](https://a.b) and [y](#usage)");
        assert!(out.contains(">x<"), "{out}");
        assert!(!out.contains("https://a.b"), "{out}");
        assert!(out.contains(r##"href="#ds-u-usage""##), "{out}");
        assert_eq!(out.matches("href").count(), 1, "{out}");
    }

    #[test]
    fn prefixes_every_id_and_strips_name() {
        let out = html(r#"<h2 id="apply" name="ipc">Apply</h2>"#);
        assert!(out.contains(r#"id="ds-u-apply""#), "{out}");
        assert!(!out.contains("name="), "{out}");
    }

    #[test]
    fn rewrites_images_inside_the_system_only() {
        let out = html("![m](assets/Logos/mark.svg)\n\n<img src=\"assets/Logos/mark.svg\">");
        assert_eq!(
            out.matches(r#"src="t/dark/f/assets/Logos/mark.svg""#)
                .count(),
            2,
            "{out}"
        );
        let spaced = html("![m](assets/Brand%20Kit/M%C3%A4rk.svg)");
        assert!(
            spaced.contains(r#"src="t/dark/f/assets/Brand%20Kit/M%C3%A4rk.svg""#),
            "{spaced}"
        );
        for outside in [
            "../secret.png",
            "/etc/x.png",
            "https://x/y.png",
            "data:image/png;base64,AA",
            "./a.png",
            "a\\b.png",
        ] {
            let out = html(&format!("<img src=\"{outside}\">"));
            assert!(!out.contains("src="), "{outside}: {out}");
        }
    }

    #[test]
    fn keeps_tables_and_code() {
        let out = html("| a | b |\n| - | - |\n| 1 | 2 |\n\n```\nlet x = 1;\n```\n");
        assert!(out.contains("<table>"), "{out}");
        assert!(out.contains("<td>1</td>"), "{out}");
        assert!(out.contains("<pre><code>let x = 1;"), "{out}");
    }
}
