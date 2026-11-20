//! The `zorvo-artifact` protocol: how a stored page reaches its own webview.
//!
//! Registered on the artifact's child webview only, never on the main one.
//! A URL names a session, an artifact and a version; the webview never sends a
//! path. The page's limits are the CSP sent with every answer.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::http::Response;

use super::canvas::canvas_file;
use super::canvas_shell::CANVAS_SHELL;
use super::commands::is_inside_known_session_folder;
use super::store::{is_artifact_id, is_canvas_key, is_session_id, ArtifactStore};

pub const SCHEME: &str = "zorvo-artifact";
const ORIGIN: &str = "zorvo-artifact://localhost/";

/// What a page may load. Scripts and fonts come from the hosts Claude's
/// artifacts use; nothing can be fetched, framed or posted, and
/// `sandbox allow-scripts` gives the page an opaque origin, so it keeps no
/// storage and shares nothing with another artifact. Changing this changes a
/// security boundary: `the_page_csp_is_exactly` makes that a visible diff.
pub const PAGE_CSP: &str = "default-src 'none'; \
script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
style-src 'unsafe-inline' https://fonts.googleapis.com; \
font-src https://fonts.gstatic.com data:; \
img-src data: blob:; \
media-src data: blob:; \
connect-src 'none'; frame-src 'none'; object-src 'none'; \
form-action 'none'; base-uri 'none'; \
sandbox allow-scripts";

/// The canvas wrapper's limits: it frames artboards and shows their pictures, runs its own
/// inline script, and can fetch nothing. Pinned by `the_shell_csp_is_exactly`.
pub const SHELL_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; \
connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

/// An artboard's page: `PAGE_CSP` plus this scheme, so it can load its own folder's files.
/// Pinned by `board_csp_is_page_csp_plus_the_scheme`.
pub const BOARD_CSP: &str = "default-src 'none'; \
script-src 'unsafe-inline' zorvo-artifact://localhost https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
style-src 'unsafe-inline' zorvo-artifact://localhost https://fonts.googleapis.com; \
font-src zorvo-artifact://localhost https://fonts.gstatic.com data:; \
img-src zorvo-artifact://localhost data: blob:; \
media-src data: blob:; \
connect-src 'none'; frame-src 'none'; object-src 'none'; \
form-action 'none'; base-uri 'none'; \
sandbox allow-scripts";

/// What every view of the scheme serves from.
pub struct Served {
    pub store: Arc<ArtifactStore>,
    pub thumbs: PathBuf,
    pub is_known: Arc<dyn Fn(&Path) -> bool + Send + Sync>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CanvasUrl {
    Shell {
        session_id: String,
        key: String,
    },
    File {
        session_id: String,
        key: String,
        relative: String,
    },
    Thumb {
        sha256: String,
    },
}

const CANVAS_PREFIX: &str = "canvas/";
const THUMB_PREFIX: &str = "thumb/";

pub fn canvas_shell_url(session_id: &str, key: &str) -> String {
    format!("{ORIGIN}canvas/{session_id}/{key}/")
}

pub fn canvas_file_url(session_id: &str, key: &str, relative: &str) -> String {
    let encoded: Vec<String> = relative.split('/').map(encode_segment).collect();
    format!("{ORIGIN}canvas/{session_id}/{key}/f/{}", encoded.join("/"))
}

pub fn thumb_url(sha256: &str) -> String {
    format!("{ORIGIN}thumb/{sha256}.png")
}

/// Keeps RFC 3986 unreserved characters, writes every other byte as `%XX`.
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// The inverse of `encode_segment`; refuses a bad escape, invalid UTF-8 and an encoded `/`.
fn decode_segment(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let pair = segment.get(at + 1..at + 3)?;
            if !pair.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(pair, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    let text = String::from_utf8(out).ok()?;
    (!text.contains('/')).then_some(text)
}

pub fn parse_canvas_url(uri: &str) -> Option<CanvasUrl> {
    let path = uri.strip_prefix(ORIGIN)?;
    let path = path.split(['?', '#']).next()?;
    if let Some(name) = path.strip_prefix(THUMB_PREFIX) {
        let sha256 = name.strip_suffix(".png")?;
        let is_hash = sha256.len() == 64
            && sha256
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
        return is_hash.then(|| CanvasUrl::Thumb {
            sha256: sha256.to_string(),
        });
    }
    let rest = path.strip_prefix(CANVAS_PREFIX)?;
    let mut parts = rest.splitn(4, '/');
    let (session_id, key, after) = (parts.next()?, parts.next()?, parts.next()?);
    if !is_session_id(session_id) || !is_canvas_key(key) {
        return None;
    }
    let (session_id, key) = (session_id.to_string(), key.to_string());
    if after.is_empty() {
        return match parts.next() {
            None => Some(CanvasUrl::Shell { session_id, key }),
            Some(_) => None,
        };
    }
    if after != "f" {
        return None;
    }
    let tail = parts.next()?;
    let relative = tail
        .split('/')
        .map(decode_segment)
        .collect::<Option<Vec<_>>>()?
        .join("/");
    (!tail.is_empty()).then_some(CanvasUrl::File {
        session_id,
        key,
        relative,
    })
}

pub fn page_url(session_id: &str, artifact_id: &str, version: u32) -> String {
    format!("{ORIGIN}{session_id}/{artifact_id}/{version}")
}

/// The session, artifact and version a page URL names; a query or fragment is ignored.
pub fn parse_url(uri: &str) -> Option<(String, String, u32)> {
    let path = uri.strip_prefix(ORIGIN)?;
    let path = path.split(['?', '#']).next()?;
    let mut parts = path.split('/');
    let (session_id, artifact_id, version) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || !is_session_id(session_id) || !is_artifact_id(artifact_id) {
        return None;
    }
    let is_plain_number = !version.is_empty() && version.chars().all(|c| c.is_ascii_digit());
    let version = version
        .parse::<u32>()
        .ok()
        .filter(|n| is_plain_number && *n > 0)?;
    Some((session_id.to_string(), artifact_id.to_string(), version))
}

/// The bytes sent for a stored page. Unchanged today; a later spec adds
/// Zorvo's comment script here, and export must keep writing the stored bytes.
pub fn served_body(stored: Vec<u8>) -> Vec<u8> {
    stored
}

fn not_found() -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = tauri::http::StatusCode::NOT_FOUND;
    response
}

fn canvas_response(kind: &str, csp: Option<&str>, body: Vec<u8>) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(200)
        .header("Content-Type", kind)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store");
    if let Some(csp) = csp {
        builder = builder.header("Content-Security-Policy", csp);
    }
    builder.body(body).unwrap_or_else(|_| not_found())
}

fn respond_canvas(served: &Served, url: CanvasUrl) -> Response<Vec<u8>> {
    match url {
        CanvasUrl::Shell { session_id, key } => {
            if served.store.canvas(&session_id, &key).is_none() {
                return not_found();
            }
            canvas_response(
                "text/html; charset=utf-8",
                Some(SHELL_CSP),
                CANVAS_SHELL.as_bytes().to_vec(),
            )
        }
        CanvasUrl::File {
            session_id,
            key,
            relative,
        } => {
            let Some(entry) = served.store.canvas(&session_id, &key) else {
                return not_found();
            };
            let root = PathBuf::from(&entry.folder);
            let known = |path: &Path| (served.is_known)(path);
            if !is_inside_known_session_folder(&root, &entry.relative, &known) {
                return not_found();
            }
            let Some((path, kind)) = canvas_file(&root, &relative) else {
                return not_found();
            };
            let Ok(body) = super::source::read_bytes_checked(&path) else {
                return not_found();
            };
            let csp = kind.starts_with("text/html").then_some(BOARD_CSP);
            canvas_response(kind, csp, body)
        }
        CanvasUrl::Thumb { sha256 } => {
            let path = served.thumbs.join(format!("{sha256}.png"));
            let is_file = std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file());
            match std::fs::read(&path) {
                Ok(body) if is_file => canvas_response("image/png", None, body),
                _ => not_found(),
            }
        }
    }
}

/// Whether the canvas view may go to `url`: the wrapper and the files of this canvas only.
pub fn is_allowed_canvas_navigation(url: &str, session_id: &str, key: &str) -> bool {
    match parse_canvas_url(url) {
        Some(CanvasUrl::Shell {
            session_id: s,
            key: k,
        })
        | Some(CanvasUrl::File {
            session_id: s,
            key: k,
            ..
        }) => s == session_id && k == key,
        _ => false,
    }
}

/// Answers one request from the artifact's webview.
pub fn respond(served: &Served, method: &str, uri: &str) -> Response<Vec<u8>> {
    if method != "GET" {
        return not_found();
    }
    if let Some(url) = parse_canvas_url(uri) {
        return respond_canvas(served, url);
    }
    let store = &served.store;
    let stored = parse_url(uri)
        .and_then(|(session_id, artifact_id, version)| {
            store.version_path(&session_id, &artifact_id, version)
        })
        .and_then(|path| std::fs::read(path).ok());
    let Some(stored) = stored else {
        return not_found();
    };
    Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", PAGE_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(served_body(stored))
        .unwrap_or_else(|_| not_found())
}

/// Whether the artifact's webview may go to `url`: only to an artifact page.
/// This is the only thing between a page and the open web.
pub fn is_allowed_navigation(url: &str) -> bool {
    parse_url(url).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    const SESSION: &str = "session-1794800000000-k3x9a";

    /// A store holding one artifact with one version; returns its id.
    fn stored(temp: &Temp, body: &[u8]) -> (Arc<ArtifactStore>, String) {
        let store = Arc::new(ArtifactStore::new(temp.0.clone()));
        let id = store
            .show(SESSION, "/work/page.html", Some("Page"), body, 1)
            .unwrap()
            .artifact
            .id;
        (store, id)
    }

    fn served_from(store: &Arc<ArtifactStore>) -> Served {
        Served {
            store: Arc::clone(store),
            thumbs: PathBuf::from("/nonexistent-thumbs"),
            is_known: Arc::new(|_| true),
        }
    }

    fn header<'a>(response: &'a tauri::http::Response<Vec<u8>>, name: &str) -> &'a str {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
    }

    #[test]
    fn serves_a_stored_version_with_its_headers() {
        let temp = Temp::new("serve");
        let (store, id) = stored(&temp, b"<p>hello</p>");

        let response = respond(&served_from(&store), "GET", &page_url(SESSION, &id, 1));

        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), b"<p>hello</p>");
        assert_eq!(
            header(&response, "Content-Type"),
            "text/html; charset=utf-8"
        );
        assert_eq!(header(&response, "Content-Security-Policy"), PAGE_CSP);
        assert_eq!(header(&response, "X-Content-Type-Options"), "nosniff");
        assert_eq!(header(&response, "Cache-Control"), "no-store");
    }

    #[test]
    fn the_page_csp_is_exactly() {
        assert_eq!(
            PAGE_CSP,
            "default-src 'none'; \
             script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
             style-src 'unsafe-inline' https://fonts.googleapis.com; \
             font-src https://fonts.gstatic.com data:; \
             img-src data: blob:; \
             media-src data: blob:; \
             connect-src 'none'; frame-src 'none'; object-src 'none'; \
             form-action 'none'; base-uri 'none'; \
             sandbox allow-scripts"
        );
    }

    #[test]
    fn the_csp_sandboxes_the_page() {
        assert!(PAGE_CSP.ends_with("; sandbox allow-scripts"));
        assert!(!PAGE_CSP.contains("allow-same-origin"));
        assert!(!PAGE_CSP.contains("unsafe-eval"));
    }

    #[test]
    fn served_body_is_the_stored_page() {
        assert_eq!(served_body(b"<p>a</p>".to_vec()), b"<p>a</p>");
    }

    #[test]
    fn refuses_what_is_not_a_get_of_a_listed_version() {
        let temp = Temp::new("refuse");
        let (store, id) = stored(&temp, b"x");
        let good = page_url(SESSION, &id, 1);

        for (method, uri) in [
            ("POST", good.clone()),
            ("GET", page_url(SESSION, &id, 2)),
            ("GET", page_url("other-session", &id, 1)),
            ("GET", format!("zorvo-artifact://localhost/../{id}/1")),
            ("GET", good.replace("localhost", "evil")),
            ("GET", format!("{good}/extra")),
            ("GET", "zorvo-artifact://localhost/".to_string()),
        ] {
            let response = respond(&served_from(&store), method, &uri);
            assert_eq!(response.status(), 404, "{method} {uri}");
            assert!(response.body().is_empty());
        }
    }

    #[test]
    fn a_listed_version_whose_file_is_gone_is_404() {
        let temp = Temp::new("gone");
        let (store, id) = stored(&temp, b"x");
        std::fs::remove_file(store.version_path(SESSION, &id, 1).unwrap()).unwrap();

        assert_eq!(
            respond(&served_from(&store), "GET", &page_url(SESSION, &id, 1)).status(),
            404
        );
    }

    #[test]
    fn page_url_round_trips_through_parse_url() {
        let url = page_url(SESSION, "a-0123456789abcdef", 7);

        assert_eq!(
            url,
            format!("zorvo-artifact://localhost/{SESSION}/a-0123456789abcdef/7")
        );
        assert_eq!(
            parse_url(&url),
            Some((SESSION.to_string(), "a-0123456789abcdef".to_string(), 7))
        );
    }

    #[test]
    fn parse_url_ignores_a_query_and_a_fragment() {
        let url = page_url(SESSION, "a-0123456789abcdef", 7);

        assert!(parse_url(&format!("{url}?r=3")).is_some());
        assert!(parse_url(&format!("{url}#section")).is_some());
        assert!(parse_url(&format!("{url}?r=3#section")).is_some());
    }

    #[test]
    fn parse_url_refuses_other_shapes() {
        let id = "a-0123456789abcdef";
        for url in [
            format!("zorvo-artifact://localhost/{SESSION}/{id}/+1"),
            format!("zorvo-artifact://localhost/{SESSION}/{id}/0"),
            format!("zorvo-artifact://localhost/{SESSION}/{id}/1.5"),
            format!("zorvo-artifact://localhost/{SESSION}/{id}/"),
            format!("zorvo-artifact://localhost/{SESSION}/bad/1"),
            format!("https://localhost/{SESSION}/{id}/1"),
        ] {
            assert_eq!(parse_url(&url), None, "{url}");
        }
    }

    #[test]
    fn navigation_allows_only_artifact_pages() {
        let page = page_url(SESSION, "a-0123456789abcdef", 1);

        assert!(is_allowed_navigation(&page));
        assert!(is_allowed_navigation(&format!("{page}#section")));
        for url in [
            "https://example.com",
            "http://localhost:1420",
            "file:///etc/hosts",
            "tauri://localhost",
            "zorvo-artifact://evil/",
            "about:blank",
            "javascript:alert(1)",
        ] {
            assert!(!is_allowed_navigation(url), "{url}");
        }
    }

    // ---- canvas routes ----

    use crate::artifacts::canvas::CanvasFolder;
    use std::sync::atomic::{AtomicBool, Ordering};

    const KEY: &str = "c-0123456789abcdef";

    /// A session folder holding `design/` with a canvas.json, a page, a picture and a script;
    /// its canvas is remembered in a store. `known` decides what is a workspace.
    fn canvas_fixture(temp: &Temp, known: Arc<AtomicBool>) -> (Served, std::path::PathBuf, String) {
        let session_folder = temp.0.join("work");
        let design = session_folder.join("design");
        std::fs::create_dir_all(design.join("screens")).unwrap();
        std::fs::write(design.join("canvas.json"), "{}").unwrap();
        std::fs::write(design.join("screens/cart.html"), "<p>cart</p>").unwrap();
        std::fs::write(design.join("logo.png"), b"\x89PNG").unwrap();
        std::fs::write(design.join("app.js"), "1").unwrap();
        std::fs::write(design.join("notes.txt"), "x").unwrap();
        let store = Arc::new(ArtifactStore::new(temp.0.join("store")));
        let root = std::fs::canonicalize(&design).unwrap();
        let entry = store
            .remember_canvas(
                SESSION,
                &CanvasFolder {
                    root: root.clone(),
                    relative: "design".to_string(),
                },
                "Shop",
                1,
            )
            .unwrap();
        let session = std::fs::canonicalize(&session_folder).unwrap();
        let served = Served {
            store,
            thumbs: temp.0.join("thumbs"),
            is_known: Arc::new(move |path| known.load(Ordering::SeqCst) && path == session),
        };
        (served, root, entry.key)
    }

    #[test]
    fn parses_canvas_urls() {
        assert_eq!(
            parse_canvas_url(&canvas_shell_url(SESSION, KEY)),
            Some(CanvasUrl::Shell {
                session_id: SESSION.into(),
                key: KEY.into()
            })
        );
        assert_eq!(
            parse_canvas_url(&format!("{}?v=2#x", canvas_shell_url(SESSION, KEY))),
            Some(CanvasUrl::Shell {
                session_id: SESSION.into(),
                key: KEY.into()
            })
        );
        let file = canvas_file_url(SESSION, KEY, "screens/cart page.html");
        assert!(file.ends_with("/f/screens/cart%20page.html"));
        assert_eq!(
            parse_canvas_url(&file),
            Some(CanvasUrl::File {
                session_id: SESSION.into(),
                key: KEY.into(),
                relative: "screens/cart page.html".into()
            })
        );
        let hash = "a".repeat(64);
        assert_eq!(
            parse_canvas_url(&thumb_url(&hash)),
            Some(CanvasUrl::Thumb { sha256: hash })
        );
        assert_eq!(
            parse_canvas_url(&format!(
                "zorvo-artifact://localhost/canvas/{SESSION}/{KEY}/f/../x"
            )),
            Some(CanvasUrl::File {
                session_id: SESSION.into(),
                key: KEY.into(),
                relative: "../x".into()
            })
        );
    }

    #[test]
    fn canvas_file_urls_round_trip_non_ascii_names() {
        let url = canvas_file_url(SESSION, KEY, "é/日本.png");
        assert!(url.is_ascii());
        assert!(matches!(
            parse_canvas_url(&url),
            Some(CanvasUrl::File { relative, .. }) if relative == "é/日本.png"
        ));
    }

    #[test]
    fn refuses_malformed_canvas_urls() {
        let base = format!("zorvo-artifact://localhost/canvas/{SESSION}/{KEY}");
        for url in [
            format!("{base}/f/"),
            format!("{base}/f"),
            format!("{base}/g/x"),
            format!("{base}/f/a%2Fb"),
            format!("{base}/f/%ff"),
            format!("{base}/f/%zz"),
            format!("{base}/extra/"),
            format!("zorvo-artifact://localhost/canvas/{SESSION}/bad/"),
            "zorvo-artifact://localhost/thumb/short.png".to_string(),
            format!("zorvo-artifact://localhost/thumb/{}.png", "A".repeat(64)),
            format!("https://localhost/canvas/{SESSION}/{KEY}/"),
        ] {
            assert_eq!(parse_canvas_url(&url), None, "{url}");
        }
    }

    #[test]
    fn the_shell_csp_is_exactly() {
        assert_eq!(
            SHELL_CSP,
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
             img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; \
             connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
        );
    }

    #[test]
    fn board_csp_is_page_csp_plus_the_scheme() {
        assert_eq!(
            BOARD_CSP,
            "default-src 'none'; \
             script-src 'unsafe-inline' zorvo-artifact://localhost https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
             style-src 'unsafe-inline' zorvo-artifact://localhost https://fonts.googleapis.com; \
             font-src zorvo-artifact://localhost https://fonts.gstatic.com data:; \
             img-src zorvo-artifact://localhost data: blob:; \
             media-src data: blob:; \
             connect-src 'none'; frame-src 'none'; object-src 'none'; \
             form-action 'none'; base-uri 'none'; \
             sandbox allow-scripts"
        );
        // Nothing else differs from the page's policy.
        assert_eq!(
            BOARD_CSP.replace(" zorvo-artifact://localhost", ""),
            PAGE_CSP
        );
        assert!(BOARD_CSP.ends_with("; sandbox allow-scripts"));
        assert!(!BOARD_CSP.contains("allow-same-origin"));
    }

    #[test]
    fn serves_the_shell_with_its_csp() {
        let temp = Temp::new("shell");
        let (served, _root, key) = canvas_fixture(&temp, Arc::new(AtomicBool::new(true)));

        let response = respond(&served, "GET", &canvas_shell_url(SESSION, &key));

        assert_eq!(response.status(), 200);
        assert_eq!(header(&response, "Content-Security-Policy"), SHELL_CSP);
        assert!(header(&response, "Content-Type").starts_with("text/html"));
        assert_eq!(response.body(), CANVAS_SHELL.as_bytes());
        let unknown = canvas_shell_url(SESSION, "c-ffffffffffffffff");
        assert_eq!(respond(&served, "GET", &unknown).status(), 404);
        assert_eq!(
            respond(&served, "POST", &canvas_shell_url(SESSION, &key)).status(),
            404
        );
    }

    #[test]
    fn serves_a_board_with_board_csp_and_an_image_with_nosniff() {
        let temp = Temp::new("board");
        let (served, _root, key) = canvas_fixture(&temp, Arc::new(AtomicBool::new(true)));

        let page = respond(
            &served,
            "GET",
            &canvas_file_url(SESSION, &key, "screens/cart.html"),
        );
        assert_eq!(page.status(), 200);
        assert_eq!(page.body(), b"<p>cart</p>");
        assert_eq!(header(&page, "Content-Security-Policy"), BOARD_CSP);
        assert_eq!(header(&page, "X-Content-Type-Options"), "nosniff");

        let image = respond(&served, "GET", &canvas_file_url(SESSION, &key, "logo.png"));
        assert_eq!(image.status(), 200);
        assert_eq!(header(&image, "Content-Type"), "image/png");
        assert_eq!(header(&image, "X-Content-Type-Options"), "nosniff");
        assert_eq!(header(&image, "Content-Security-Policy"), "");

        for relative in ["notes.txt", "missing.png", "../x"] {
            let url = canvas_file_url(SESSION, &key, relative);
            assert_eq!(respond(&served, "GET", &url).status(), 404, "{relative}");
        }
    }

    #[test]
    fn serves_nothing_outside_a_known_workspace() {
        let temp = Temp::new("unknown");
        let known = Arc::new(AtomicBool::new(true));
        let (served, _root, key) = canvas_fixture(&temp, Arc::clone(&known));
        let url = canvas_file_url(SESSION, &key, "logo.png");
        assert_eq!(respond(&served, "GET", &url).status(), 200);

        known.store(false, Ordering::SeqCst);

        assert_eq!(respond(&served, "GET", &url).status(), 404);
    }

    #[test]
    fn serves_nothing_for_a_link_out_of_the_folder() {
        let temp = Temp::new("link");
        let (served, root, key) = canvas_fixture(&temp, Arc::new(AtomicBool::new(true)));
        std::fs::write(temp.0.join("secret.png"), b"s").unwrap();
        std::os::unix::fs::symlink(temp.0.join("secret.png"), root.join("out.png")).unwrap();

        let url = canvas_file_url(SESSION, &key, "out.png");

        assert_eq!(respond(&served, "GET", &url).status(), 404);
    }

    #[test]
    fn serves_a_thumb_only_when_it_is_a_regular_file() {
        let temp = Temp::new("thumb");
        let (served, _root, _key) = canvas_fixture(&temp, Arc::new(AtomicBool::new(true)));
        let hash = "b".repeat(64);
        let url = thumb_url(&hash);
        assert_eq!(respond(&served, "GET", &url).status(), 404);

        std::fs::create_dir_all(&served.thumbs).unwrap();
        std::fs::write(served.thumbs.join(format!("{hash}.png")), b"png").unwrap();
        let response = respond(&served, "GET", &url);
        assert_eq!(response.status(), 200);
        assert_eq!(header(&response, "Content-Type"), "image/png");
        assert_eq!(header(&response, "X-Content-Type-Options"), "nosniff");

        let linked = "c".repeat(64);
        std::os::unix::fs::symlink(
            served.thumbs.join(format!("{hash}.png")),
            served.thumbs.join(format!("{linked}.png")),
        )
        .unwrap();
        assert_eq!(respond(&served, "GET", &thumb_url(&linked)).status(), 404);
    }

    #[test]
    fn allows_navigation_only_inside_the_shown_canvas() {
        let shell = canvas_shell_url(SESSION, KEY);
        let file = canvas_file_url(SESSION, KEY, "a.html");
        assert!(is_allowed_canvas_navigation(&shell, SESSION, KEY));
        assert!(is_allowed_canvas_navigation(&file, SESSION, KEY));
        assert!(!is_allowed_canvas_navigation(
            &shell,
            SESSION,
            "c-ffffffffffffffff"
        ));
        assert!(!is_allowed_canvas_navigation(&shell, "other-session", KEY));
        for url in [
            thumb_url(&"a".repeat(64)),
            page_url(SESSION, "a-0123456789abcdef", 1),
            "https://example.com".to_string(),
            "about:blank".to_string(),
        ] {
            assert!(!is_allowed_canvas_navigation(&url, SESSION, KEY), "{url}");
        }
    }
}
