//! Cleans the markup of an inline visual: an allowlist, so what Zorvo does not know is dropped.
//! Design: `docs/superpowers/specs/2026-11-21-inline-visuals-design.md`.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use ammonia::{Builder, UrlRelative};
use serde::{Deserialize, Serialize};

/// The most markup one visual may hold, before and after cleaning.
pub const MAX_VISUAL_BYTES: usize = 256 * 1024;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum VisualKind {
    Svg,
    Html,
}

const HTML_TAGS: [&str; 39] = [
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "small",
    "span",
    "strong",
    "style",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
    "section",
    "header",
    "footer",
    "label",
];
const SVG_TAGS: [&str; 24] = [
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "marker",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "title",
    "desc",
];
/// Attributes any kept tag may carry. None of them names a URL or a handler.
const ATTRIBUTES: [&str; 70] = [
    "class",
    "id",
    "style",
    "title",
    "role",
    "aria-label",
    "aria-hidden",
    "colspan",
    "rowspan",
    "viewBox",
    "xmlns",
    "preserveAspectRatio",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "dx",
    "dy",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "transform",
    "text-anchor",
    "dominant-baseline",
    "font-size",
    "font-weight",
    "font-family",
    "font-style",
    "letter-spacing",
    "marker-start",
    "marker-mid",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "refX",
    "refY",
    "orient",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "clip-path",
    "clipPathUnits",
    "mask",
    "patternUnits",
    "startOffset",
    "textLength",
    "alt",
    "vector-effect",
];

fn builder() -> &'static Builder<'static> {
    static BUILDER: OnceLock<Builder<'static>> = OnceLock::new();
    BUILDER.get_or_init(|| {
        let mut builder = Builder::empty();
        builder
            .tags(HTML_TAGS.iter().chain(SVG_TAGS.iter()).copied().collect())
            .clean_content_tags(HashSet::from(["script"]))
            .generic_attributes(ATTRIBUTES.iter().copied().collect())
            .tag_attributes(HashMap::from([
                ("img", HashSet::from(["src"])),
                ("use", HashSet::from(["href"])),
            ]))
            .url_schemes(HashSet::from(["data"]))
            .url_relative(UrlRelative::PassThrough)
            .link_rel(None)
            .strip_comments(true)
            .attribute_filter(|element, attribute, value| match (element, attribute) {
                // A visual has no links, and a `use` may only point inside its own drawing.
                ("use", "href") if !value.starts_with('#') => None,
                ("img", "src") if !value.starts_with("data:image/") => None,
                _ => Some(Cow::Borrowed(value)),
            });
        builder
    })
}

/// The markup with everything Zorvo does not know dropped: nothing left can run, load or link.
pub fn clean(markup: &str) -> String {
    builder().clean(markup).to_string()
}

/// `Svg` when the markup is an SVG document, else an HTML fragment.
pub fn kind_of(markup: &str) -> VisualKind {
    let text = markup.trim_start();
    let text = match text.strip_prefix("<?xml") {
        Some(rest) => rest
            .split_once("?>")
            .map_or(text, |(_, after)| after.trim_start()),
        None => text,
    };
    let is_svg = text
        .get(..4)
        .is_some_and(|start| start.eq_ignore_ascii_case("<svg"))
        && text[4..]
            .chars()
            .next()
            .is_none_or(|next| next.is_whitespace() || next == '>' || next == '/');
    if is_svg {
        VisualKind::Svg
    } else {
        VisualKind::Html
    }
}

/// Tags that draw something by themselves, with no text inside them.
const DRAWN_TAGS: [&str; 10] = [
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "img", "use", "hr",
];
/// Tags whose text is never shown.
const UNSHOWN_TEXT: [&str; 3] = ["style", "title", "desc"];

fn without_unshown_text(cleaned: &str) -> String {
    let mut out = cleaned.to_string();
    for tag in UNSHOWN_TEXT {
        let (open, close) = (format!("<{tag}"), format!("</{tag}>"));
        while let Some(start) = out.find(&open) {
            let end = out[start..]
                .find(&close)
                .map_or(out.len(), |at| start + at + close.len());
            out.replace_range(start..end, "");
        }
    }
    out
}

fn has_tag(markup: &str, tag: &str) -> bool {
    let open = format!("<{tag}");
    markup.match_indices(&open).any(|(at, _)| {
        markup[at + open.len()..]
            .chars()
            .next()
            .is_some_and(|next| next.is_whitespace() || next == '>' || next == '/')
    })
}

/// Whether cleaned markup would show nothing: no text, no shape or picture, and no element that
/// could be drawn by its own style. `<div id="chart"></div>` waiting for a script is the usual
/// case, and the agent should be told rather than the user shown an empty frame.
pub fn is_empty_visual(cleaned: &str) -> bool {
    let shown = without_unshown_text(cleaned);
    let mut text = String::new();
    let mut is_in_tag = false;
    for c in shown.chars() {
        match c {
            '<' => is_in_tag = true,
            '>' => is_in_tag = false,
            _ if !is_in_tag => text.push(c),
            _ => {}
        }
    }
    let has_text = !text.trim().is_empty();
    let has_shape = DRAWN_TAGS.iter().any(|tag| has_tag(&shown, tag));
    let has_styled_box = shown.contains(" style=\"") || shown.contains(" class=\"");
    !(has_text || has_shape || has_styled_box)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_everything_that_could_run_or_navigate() {
        for bad in [
            "<script>alert(1)</script>",
            "<p onclick=\"x()\">a</p>",
            "<a href=\"javascript:x()\">a</a>",
            "<a href=\"https://e.com\">a</a>",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://e.com\">",
            "<base href=\"https://e.com\">",
            "<iframe src=\"https://e.com\"></iframe>",
            "<object data=\"x\"></object>",
            "<embed src=\"x\">",
            "<form action=\"https://e.com\"><button>go</button></form>",
            "<link rel=\"stylesheet\" href=\"x\">",
            "<svg><script>alert(1)</script></svg>",
            "<svg onload=\"x()\"></svg>",
        ] {
            let out = clean(bad).to_lowercase();
            for gone in [
                "href=\"http",
                "<script",
                "onclick",
                "onload",
                "javascript:",
                "http-equiv",
                "<base",
                "<iframe",
                "<object",
                "<embed",
                "<form",
                "<link",
            ] {
                assert!(!out.contains(gone), "{gone} survived in {out}");
            }
        }
    }
    #[test]
    fn keeps_style_and_svg_drawing() {
        let html = clean(
            "<style>.a{color:var(--fg)}</style><div class=\"a\" style=\"padding:8px\">hi</div>",
        );
        assert!(
            html.contains("<style>")
                && html.contains("var(--fg)")
                && html.contains("style=\"padding:8px\"")
        );
        let svg = clean("<svg viewBox=\"0 0 10 10\"><defs><marker id=\"m\"/></defs><rect x=\"1\" y=\"1\" width=\"2\" height=\"2\" fill=\"var(--accent)\"/><path d=\"M0 0L1 1\" marker-end=\"url(#m)\"/><text x=\"1\" y=\"1\">a</text></svg>");
        for kept in [
            "viewBox",
            "<rect",
            "<path",
            "<text",
            "<marker",
            "marker-end",
            "var(--accent)",
        ] {
            assert!(svg.contains(kept), "{kept}");
        }
    }
    #[test]
    fn text_that_looks_like_a_closing_frame_stays_text() {
        let out = clean("<p>&lt;/iframe&gt;&lt;script&gt;</p>");
        assert!(!out.contains("</iframe>") && !out.contains("<script"));
    }
    #[test]
    fn kind_follows_the_first_tag() {
        assert_eq!(kind_of("  <svg></svg>"), VisualKind::Svg);
        assert_eq!(
            kind_of("<?xml version=\"1.0\"?>\n<svg></svg>"),
            VisualKind::Svg
        );
        assert_eq!(kind_of("<div><svg></svg></div>"), VisualKind::Html);
    }
    #[test]
    fn only_a_script_leaves_nothing() {
        assert!(is_empty_visual(&clean("<script>1</script>  ")));
        assert!(!is_empty_visual(&clean("<p>a</p>")));
    }

    #[test]
    fn markup_that_tries_to_leave_its_frame_is_dropped_or_text() {
        let out = clean(
            "</iframe></body><style>a{}</style><script>x()</script><p title='\"><script>'>a</p>",
        );
        assert!(!out.contains("</iframe>") && !out.contains("</body>") && !out.contains("<script"));
        assert!(out.contains("<p") && out.contains("&quot;"));
    }

    #[test]
    fn markup_that_draws_nothing_is_empty() {
        for nothing in [
            "<div></div>",
            "<div id=\"chart\"></div><script>draw()</script>",
            "<svg></svg>",
            "<style>p{}</style>",
            "<svg><foreignObject><div>x</div></foreignObject></svg>",
            "<svg><desc>about</desc><title>t</title></svg>",
            "<p>   </p>",
            "<svg><g></g><defs></defs></svg>",
        ] {
            assert!(is_empty_visual(&clean(nothing)), "{nothing}");
        }
    }

    #[test]
    fn text_a_shape_or_a_styled_box_is_something() {
        for something in [
            "<p>a</p>",
            "<svg><rect width=\"2\" height=\"2\"/></svg>",
            "<svg><text>a</text></svg>",
            "<div style=\"width:40px;height:40px;background:var(--chip)\"></div>",
            "<style>.b{height:20px}</style><div class=\"b\"></div>",
            "<hr>",
            "<img src=\"data:image/png;base64,AAAA\" alt=\"\">",
        ] {
            assert!(!is_empty_visual(&clean(something)), "{something}");
        }
    }
}
