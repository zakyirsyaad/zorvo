//! What Zorvo puts around a component's `preview.html`: the system's tokens, its bundle and its
//! libraries, inserted right after `<head>`, so a preview made for Claude's viewer draws here.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 3.

use std::fs;
use std::path::Path;

use super::design_system::DsIndex;
use super::protocol::encode_segment;

const REACT: &str = "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js";
const REACT_DOM: &str =
    "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js";

/// The tags, in order, with `base` the preview's `.../t/<theme>/f/` URL: `tokens.css`,
/// `components/bundle.css`, `components/lib/*.js` by name, React and React DOM when the index
/// names them and the system carries no React of its own, then `components/bundle.js`.
pub fn preview_tags(base: &str, index: &DsIndex, folder: &Path) -> String {
    let is_file = |relative: &str| {
        fs::symlink_metadata(folder.join(relative)).is_ok_and(|meta| meta.is_file())
    };
    let style = |href: String| format!("<link rel=\"stylesheet\" href=\"{href}\">");
    let script = |src: String| format!("<script src=\"{src}\"></script>");
    let mut tags = vec![style(format!("{base}tokens.css"))];
    if is_file("components/bundle.css") {
        tags.push(style(format!("{base}components/bundle.css")));
    }
    let libraries = library_files(folder);
    tags.extend(
        libraries
            .iter()
            .map(|name| script(format!("{base}components/lib/{}", encode_segment(name)))),
    );
    let wants_react = index
        .libraries
        .iter()
        .any(|name| name == "react" || name == "react-dom");
    if wants_react && !libraries.iter().any(|name| name.starts_with("react")) {
        tags.push(script(REACT.to_string()));
        tags.push(script(REACT_DOM.to_string()));
    }
    if is_file("components/bundle.js") {
        tags.push(script(format!("{base}components/bundle.js")));
    }
    tags.concat()
}

/// The `.js` files of `components/lib/`, by name.
fn library_files(folder: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(folder.join("components/lib")) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| name.ends_with(".js") && !name.starts_with('.'))
        .collect();
    names.sort();
    names
}

/// `html` with `tags` inserted after its `<head ...>`, else after `<html ...>`, else after its
/// doctype, else after a leading comment, else at the start: never before the doctype, which
/// would put the page in quirks mode.
pub fn with_tags(html: &str, tags: &str) -> String {
    let at = insert_at(html);
    format!("{}{tags}{}", &html[..at], &html[at..])
}

fn insert_at(html: &str) -> usize {
    // ASCII lowercasing keeps every byte offset, so offsets found in `lower` cut `html`.
    let lower = html.to_ascii_lowercase();
    tag_end(&lower, "<head")
        .or_else(|| tag_end(&lower, "<html"))
        .or_else(|| tag_end(&lower, "<!doctype"))
        .or_else(|| leading_comment_end(&lower))
        .unwrap_or(0)
}

/// The byte after the `>` of the first `name` tag outside a comment, when `name` is followed
/// by `>` or white space (so `<head` never matches `<header`).
fn tag_end(lower: &str, name: &str) -> Option<usize> {
    let bytes = lower.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if lower[at..].starts_with("<!--") {
            at = lower[at + 4..].find("-->").map(|end| at + 4 + end + 3)?;
            continue;
        }
        if lower[at..].starts_with(name) {
            let after = at + name.len();
            match bytes.get(after) {
                Some(b'>') => return Some(after + 1),
                Some(b' ' | b'\t' | b'\n' | b'\r') => {
                    return lower[after..].find('>').map(|end| after + end + 1)
                }
                _ => {}
            }
        }
        at += lower[at..].chars().next().map_or(1, char::len_utf8);
    }
    None
}

/// The end of a comment that starts the document (after white space).
fn leading_comment_end(lower: &str) -> Option<usize> {
    let start = lower.len() - lower.trim_start().len();
    if !lower[start..].starts_with("<!--") {
        return None;
    }
    lower[start + 4..]
        .find("-->")
        .map(|end| start + 4 + end + 3)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::super::ds_content::read_content;
    use super::super::test_support::Temp;
    use super::*;

    const T: &str = "<TAGS>";

    #[test]
    fn inserts_after_head() {
        assert_eq!(
            with_tags("<!doctype html><html><head lang=x><title>a</title>", T),
            "<!doctype html><html><head lang=x><TAGS><title>a</title>"
        );
        assert_eq!(
            with_tags("<html>\n<head>\n<meta charset=utf-8>", T),
            "<html>\n<head><TAGS>\n<meta charset=utf-8>"
        );
    }

    #[test]
    fn insert_after_head_skips_header_and_matches_any_case() {
        let page = "<!-- @dsCard group=\"A\" -->\n<!DOCTYPE html><HTML><body><header>x</header>";
        assert_eq!(
            with_tags(page, T),
            "<!-- @dsCard group=\"A\" -->\n<!DOCTYPE html><HTML><TAGS><body><header>x</header>"
        );
        assert_eq!(
            with_tags("<!DOCTYPE html><HTML><HEAD>", T),
            "<!DOCTYPE html><HTML><HEAD><TAGS>"
        );
        assert_eq!(
            with_tags("<html><header>a</header><head\tid=\"h\">", T),
            "<html><header>a</header><head\tid=\"h\"><TAGS>"
        );
    }

    #[test]
    fn a_head_inside_a_comment_is_not_the_head() {
        assert_eq!(
            with_tags("<!-- <head> --><html><head>", T),
            "<!-- <head> --><html><head><TAGS>"
        );
    }

    #[test]
    fn inserts_after_html_without_head() {
        assert_eq!(
            with_tags("<html lang=\"en\"><body>x", T),
            "<html lang=\"en\"><TAGS><body>x"
        );
    }

    #[test]
    fn inserts_after_doctype_without_html() {
        assert_eq!(
            with_tags("<!doctype html>\n<p>x</p>", T),
            "<!doctype html><TAGS>\n<p>x</p>"
        );
    }

    #[test]
    fn a_fragment_gets_them_after_its_dscard_comment() {
        assert_eq!(
            with_tags("<!-- @dsCard group=\"A\" -->\n<button>x</button>", T),
            "<!-- @dsCard group=\"A\" --><TAGS>\n<button>x</button>"
        );
        assert_eq!(
            with_tags("<button>x</button>", T),
            "<TAGS><button>x</button>"
        );
    }

    #[test]
    fn never_before_the_doctype() {
        for page in [
            "<!-- c -->\n<!doctype html><p>x",
            "  <!DOCTYPE html>\n<body>",
            "<!-- @dsCard height=1 -->\n<!doctype html>\n<html>\n<body>",
        ] {
            let out = with_tags(page, T);
            let doctype = out.to_ascii_lowercase().find("<!doctype").unwrap();
            assert!(out.find(T).unwrap() > doctype, "{out}");
        }
    }

    fn fixture_copy(tag: &str) -> Temp {
        let temp = Temp::new(tag);
        let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ds-two-themes");
        for file in [
            "design-system.json",
            "README.md",
            "tokens.json",
            "components/bundle.css",
        ] {
            let target = temp.0.join(file);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::copy(from.join(file), target).unwrap();
        }
        temp
    }

    const BASE: &str = "zorvo-artifact://localhost/ds/s1/d-0123456789abcdef/t/dark/f/";

    fn srcs(tags: &str) -> Vec<String> {
        tags.split(['"'])
            .filter(|part| part.starts_with("zorvo-artifact://") || part.starts_with("https://"))
            .map(|part| part.replace(BASE, ""))
            .collect()
    }

    #[test]
    fn tags_in_order() {
        let temp = fixture_copy("ds-tags");
        let lib = temp.0.join("components/lib");
        fs::create_dir_all(&lib).unwrap();
        fs::write(lib.join("b.js"), "1").unwrap();
        fs::write(lib.join("a b.js"), "1").unwrap();
        fs::write(lib.join("notes.txt"), "1").unwrap();
        fs::write(temp.0.join("components/bundle.js"), "1").unwrap();
        let index = r#"{"title": "Acme", "libraries": ["react", "react-dom"]}"#;
        fs::write(temp.0.join("design-system.json"), index).unwrap();
        let content = read_content(&temp.0).unwrap();
        let tags = preview_tags(BASE, &content.index, &temp.0);
        assert_eq!(
            srcs(&tags),
            [
                "tokens.css",
                "components/bundle.css",
                "components/lib/a%20b.js",
                "components/lib/b.js",
                "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
                "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
                "components/bundle.js",
            ]
        );
        assert!(tags.contains(r#"<link rel="stylesheet" href=""#), "{tags}");
        assert!(tags.contains("<script src=\""), "{tags}");
    }

    #[test]
    fn no_bundle_no_react_without_libraries_and_a_system_react_wins() {
        let temp = fixture_copy("ds-tags-bare");
        fs::remove_file(temp.0.join("components/bundle.css")).unwrap();
        let content = read_content(&temp.0).unwrap();
        assert_eq!(
            srcs(&preview_tags(BASE, &content.index, &temp.0)),
            ["tokens.css"]
        );

        let index = r#"{"title": "Acme", "libraries": ["react"]}"#;
        fs::write(temp.0.join("design-system.json"), index).unwrap();
        fs::create_dir_all(temp.0.join("components/lib")).unwrap();
        fs::write(temp.0.join("components/lib/react.js"), "1").unwrap();
        let content = read_content(&temp.0).unwrap();
        assert_eq!(
            srcs(&preview_tags(BASE, &content.index, &temp.0)),
            ["tokens.css", "components/lib/react.js"]
        );
    }
}
