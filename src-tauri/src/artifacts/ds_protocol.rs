//! A design system on the `zorvo-artifact` scheme: Zorvo's shell at `ds/<session>/<key>/` and
//! the system's own files at `ds/<session>/<key>/t/<theme>/f/<path>`, with `f/tokens.css`
//! built from `tokens.json` for the theme in the URL.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, sections 3 and 4.

use std::path::{Path, PathBuf};

use tauri::http::Response;

use super::canvas::canvas_file;
use super::commands::is_inside_known_session_folder;
use super::design_system::{is_ds_key, parse_index, DsIndex, INDEX_FILE};
use super::ds_preview::{preview_tags, with_tags};
use super::ds_shell::DS_SHELL;
use super::ds_tokens::{is_theme_id, parse_tokens, DsTokens};
use super::ds_tokens_css::tokens_css;
use super::protocol::{
    canvas_response, decode_segment, encode_segment, not_found, Served, BOARD_CSP, FILE_CSP,
};
use super::source::{read_bytes_checked, read_checked};
use super::store::is_session_id;

/// The shell's limits: its own inline script and style, the system's files, images, fonts and
/// preview frames from the scheme, Google Fonts for hosted families, and nothing to fetch.
/// Pinned by `the_ds_shell_csp_is_exactly`.
pub const DS_SHELL_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; \
style-src 'unsafe-inline' https://fonts.googleapis.com; \
font-src zorvo-artifact://localhost https://fonts.gstatic.com; \
img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; \
connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

#[derive(Debug, Clone, PartialEq)]
pub enum DsUrl {
    Shell {
        session_id: String,
        key: String,
    },
    File {
        session_id: String,
        key: String,
        theme: String,
        relative: String,
    },
}

const ORIGIN: &str = "zorvo-artifact://localhost/";
const DS_PREFIX: &str = "ds/";
/// Built from `tokens.json` for the URL's theme; it wins over a real `tokens.css`.
const TOKENS_CSS: &str = "tokens.css";
const TOKENS_JSON: &str = "tokens.json";
/// The one theme of a system with no `tokens.json`, as `parse_tokens` names it.
const NO_THEME: &str = "default";

pub fn ds_shell_url(session_id: &str, key: &str) -> String {
    format!("{ORIGIN}{DS_PREFIX}{session_id}/{key}/")
}

pub fn ds_file_url(session_id: &str, key: &str, theme: &str, relative: &str) -> String {
    let encoded: Vec<String> = relative.split('/').map(encode_segment).collect();
    format!(
        "{}t/{theme}/f/{}",
        ds_shell_url(session_id, key),
        encoded.join("/")
    )
}

pub fn parse_ds_url(uri: &str) -> Option<DsUrl> {
    let path = uri.strip_prefix(ORIGIN)?.split(['?', '#']).next()?;
    let rest = path.strip_prefix(DS_PREFIX)?;
    let mut parts = rest.splitn(6, '/');
    let (session_id, key, after) = (parts.next()?, parts.next()?, parts.next()?);
    if !is_session_id(session_id) || !is_ds_key(key) {
        return None;
    }
    let (session_id, key) = (session_id.to_string(), key.to_string());
    if after.is_empty() {
        return parts
            .next()
            .is_none()
            .then_some(DsUrl::Shell { session_id, key });
    }
    if after != "t" {
        return None;
    }
    let theme = parts.next().filter(|theme| is_theme_id(theme))?.to_string();
    if parts.next()? != "f" {
        return None;
    }
    let tail = parts.next().filter(|tail| !tail.is_empty())?;
    let relative = tail
        .split('/')
        .map(decode_segment)
        .collect::<Option<Vec<_>>>()?
        .join("/");
    Some(DsUrl::File {
        session_id,
        key,
        theme,
        relative,
    })
}

/// The remembered system's folder, when it is still inside a known session folder.
fn system_root(served: &Served, session_id: &str, key: &str) -> Option<PathBuf> {
    let entry = served.store.design_system(session_id, key)?;
    let root = PathBuf::from(&entry.folder);
    let relative = if entry.relative == "." {
        ""
    } else {
        entry.relative.as_str()
    };
    let known = |path: &Path| (served.is_known)(path);
    is_inside_known_session_folder(&root, relative, &known).then_some(root)
}

/// The system's tokens, `None` when it has none or they do not read.
fn tokens_of(root: &Path) -> Option<DsTokens> {
    read_bytes_checked(&root.join(TOKENS_JSON))
        .ok()
        .and_then(|bytes| parse_tokens(&bytes).ok())
}

/// A `.html` file directly inside `components/<Name>/`: a preview, served with the system
/// around it.
fn is_preview(relative: &str) -> bool {
    let parts: Vec<&str> = relative.split('/').collect();
    parts.len() == 3 && parts[0] == "components" && parts[2].to_ascii_lowercase().ends_with(".html")
}

/// `None` when `uri` is not a `ds/` URL.
pub fn respond_ds(served: &Served, uri: &str) -> Option<Response<Vec<u8>>> {
    Some(match parse_ds_url(uri)? {
        DsUrl::Shell { session_id, key } => match system_root(served, &session_id, &key) {
            Some(_) => canvas_response(
                "text/html; charset=utf-8",
                Some(DS_SHELL_CSP),
                DS_SHELL.as_bytes().to_vec(),
            ),
            None => not_found(),
        },
        DsUrl::File {
            session_id,
            key,
            theme,
            relative,
        } => respond_file(served, &session_id, &key, &theme, &relative),
    })
}

fn respond_file(
    served: &Served,
    session_id: &str,
    key: &str,
    theme: &str,
    relative: &str,
) -> Response<Vec<u8>> {
    let Some(root) = system_root(served, session_id, key) else {
        return not_found();
    };
    let tokens = tokens_of(&root);
    let has_theme = match &tokens {
        Some(tokens) => tokens.themes.iter().any(|t| t.id == theme),
        None => theme == NO_THEME,
    };
    if !has_theme {
        return not_found();
    }
    if relative == TOKENS_CSS {
        let css = tokens
            .as_ref()
            .and_then(|tokens| tokens_css(tokens, theme))
            .unwrap_or_default();
        return canvas_response("text/css", None, css.into_bytes());
    }
    let Some((path, kind)) = canvas_file(&root, relative) else {
        return not_found();
    };
    let Ok(body) = read_bytes_checked(&path) else {
        return not_found();
    };
    if !kind.starts_with("text/html") || !is_preview(relative) {
        return canvas_response(kind, Some(FILE_CSP), body);
    }
    let (Ok(html), Some(index)) = (String::from_utf8(body), index_of(&root)) else {
        return not_found();
    };
    let base = ds_file_url(session_id, key, theme, "");
    let tags = preview_tags(&base, &index, &root);
    canvas_response(kind, Some(BOARD_CSP), with_tags(&html, &tags).into_bytes())
}

fn index_of(root: &Path) -> Option<DsIndex> {
    read_checked(&root.join(INDEX_FILE))
        .ok()
        .and_then(|bytes| parse_index(&bytes).ok())
}

/// Whether a design system's view may go to `url`: its shell and its own files only.
pub fn is_allowed_ds_navigation(url: &str, session_id: &str, key: &str) -> bool {
    match parse_ds_url(url) {
        Some(DsUrl::Shell {
            session_id: s,
            key: k,
        })
        | Some(DsUrl::File {
            session_id: s,
            key: k,
            ..
        }) => s == session_id && k == key,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::super::design_system::system_key;
    use super::super::ds_store::DesignSystemEntry;
    use super::super::store::ArtifactStore;
    use super::super::test_support::Temp;
    use super::*;

    const SESSION: &str = "s1";

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap().flatten() {
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_dir(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    struct Setup {
        _temp: Temp,
        served: Served,
        key: String,
        root: PathBuf,
        known: Arc<AtomicBool>,
    }

    /// A session folder holding the two-theme fixture at `brand/`, remembered and known.
    fn setup(tag: &str) -> Setup {
        let temp = Temp::new(tag);
        let session = temp.0.join("work");
        let root = session.join("brand");
        copy_dir(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ds-two-themes"),
            &root,
        );
        let root = fs::canonicalize(root).unwrap();
        let key = system_key(&root);
        let store = Arc::new(ArtifactStore::new(temp.0.join("artifacts")));
        store
            .remember_design_system(
                SESSION,
                DesignSystemEntry {
                    key: key.clone(),
                    folder: root.to_string_lossy().into_owned(),
                    relative: "brand".into(),
                    title: "Acme".into(),
                    tokens: 6,
                    components: 2,
                    shown_at: 1,
                },
            )
            .unwrap();
        let known = Arc::new(AtomicBool::new(true));
        let flag = Arc::clone(&known);
        let session = fs::canonicalize(session).unwrap();
        let served = Served {
            store,
            thumbs: temp.0.join("thumbs"),
            is_known: Arc::new(move |path| flag.load(Ordering::SeqCst) && path == session),
        };
        Setup {
            _temp: temp,
            served,
            key,
            root,
            known,
        }
    }

    fn get(setup: &Setup, url: &str) -> Response<Vec<u8>> {
        respond_ds(&setup.served, url).expect("a ds/ URL")
    }

    fn header<'a>(response: &'a Response<Vec<u8>>, name: &str) -> &'a str {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
    }

    fn body(response: &Response<Vec<u8>>) -> String {
        String::from_utf8(response.body().clone()).unwrap()
    }

    const KEY: &str = "d-0123456789abcdef";

    #[test]
    fn the_ds_shell_csp_is_exactly() {
        assert_eq!(
            DS_SHELL_CSP,
            "default-src 'none'; script-src 'unsafe-inline'; \
style-src 'unsafe-inline' https://fonts.googleapis.com; \
font-src zorvo-artifact://localhost https://fonts.gstatic.com; \
img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; \
connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
        );
    }

    #[test]
    fn parses_shell_and_file_urls() {
        let shell = ds_shell_url(SESSION, KEY);
        assert_eq!(
            shell,
            format!("zorvo-artifact://localhost/ds/{SESSION}/{KEY}/")
        );
        let want = DsUrl::Shell {
            session_id: SESSION.into(),
            key: KEY.into(),
        };
        assert_eq!(parse_ds_url(&shell), Some(want.clone()));
        assert_eq!(parse_ds_url(&format!("{shell}#colours")), Some(want));
        let file = ds_file_url(SESSION, KEY, "dark", "components/Button/preview.html");
        assert_eq!(
            file,
            format!("{shell}t/dark/f/components/Button/preview.html")
        );
        assert_eq!(
            parse_ds_url(&format!("{file}?v=1&d=2")),
            Some(DsUrl::File {
                session_id: SESSION.into(),
                key: KEY.into(),
                theme: "dark".into(),
                relative: "components/Button/preview.html".into(),
            })
        );
        assert_eq!(
            parse_ds_url("zorvo-artifact://localhost/canvas/s1/c-1/"),
            None
        );
    }

    #[test]
    fn refuses_a_bad_theme_id_a_bad_key_and_an_encoded_slash() {
        let base = format!("zorvo-artifact://localhost/ds/{SESSION}");
        for url in [
            format!("{base}/{KEY}/t/da rk/f/a.css"),
            format!("{base}/{KEY}/t/{}/f/a.css", "a".repeat(33)),
            format!("{base}/{KEY}/t//f/a.css"),
            format!("{base}/c-0123456789abcdef/t/dark/f/a.css"),
            format!("{base}/{KEY}/t/dark/f/a%2Fb.css"),
            format!("{base}/{KEY}/t/dark/f/"),
            format!("{base}/{KEY}/t/dark/x/a.css"),
            format!("{base}/{KEY}/x"),
            format!("zorvo-artifact://localhost/ds/../{KEY}/"),
        ] {
            assert_eq!(parse_ds_url(&url), None, "{url}");
        }
    }

    #[test]
    fn file_urls_round_trip_spaces_and_unicode() {
        let url = ds_file_url(SESSION, KEY, "light", "assets/Brand Kit/Märk.svg");
        assert!(url.is_ascii(), "{url}");
        assert!(
            url.ends_with("/f/assets/Brand%20Kit/M%C3%A4rk.svg"),
            "{url}"
        );
        assert_eq!(
            parse_ds_url(&url),
            Some(DsUrl::File {
                session_id: SESSION.into(),
                key: KEY.into(),
                theme: "light".into(),
                relative: "assets/Brand Kit/Märk.svg".into(),
            })
        );
    }

    #[test]
    fn serves_tokens_css_for_the_url_theme_over_a_real_tokens_css() {
        let setup = setup("ds-proto-tokens");
        fs::write(setup.root.join("tokens.css"), ":root { --x: 1; }").unwrap();
        let response = get(
            &setup,
            &ds_file_url(SESSION, &setup.key, "light", "tokens.css"),
        );
        assert_eq!(response.status(), 200);
        let tokens = parse_tokens(&fs::read(setup.root.join("tokens.json")).unwrap()).unwrap();
        assert_eq!(body(&response), tokens_css(&tokens, "light").unwrap());
        assert_eq!(header(&response, "Content-Type"), "text/css");
        assert_eq!(header(&response, "Cache-Control"), "no-store");
    }

    #[test]
    fn a_theme_the_system_lacks_is_404() {
        let setup = setup("ds-proto-theme");
        for theme in ["sepia", "default"] {
            let response = get(
                &setup,
                &ds_file_url(SESSION, &setup.key, theme, "tokens.css"),
            );
            assert_eq!(response.status(), 404, "{theme}");
        }
        fs::remove_file(setup.root.join("tokens.json")).unwrap();
        let url = ds_file_url(SESSION, &setup.key, "default", "assets/Logos/mark.svg");
        assert_eq!(get(&setup, &url).status(), 200);
    }

    #[test]
    fn a_preview_gets_board_csp_and_the_tags() {
        let setup = setup("ds-proto-preview");
        let url = ds_file_url(
            SESSION,
            &setup.key,
            "dark",
            "components/Button/preview.html",
        );
        let response = get(&setup, &format!("{url}?v=1"));
        assert_eq!(response.status(), 200);
        assert_eq!(header(&response, "Content-Security-Policy"), BOARD_CSP);
        let text = body(&response);
        let tokens = ds_file_url(SESSION, &setup.key, "dark", "tokens.css");
        let head = text.find("<head>").unwrap();
        assert!(text.find(&tokens).unwrap() > head, "{text}");
        assert!(text.contains(&ds_file_url(
            SESSION,
            &setup.key,
            "dark",
            "components/bundle.css"
        )));
    }

    #[test]
    fn other_files_get_file_csp() {
        let setup = setup("ds-proto-files");
        for file in [
            "assets/Logos/mark.svg",
            "components/bundle.css",
            "README.md.html",
        ] {
            if file.ends_with(".md.html") {
                fs::write(setup.root.join(file), "<p>x</p>").unwrap();
            }
            let response = get(&setup, &ds_file_url(SESSION, &setup.key, "dark", file));
            assert_eq!(response.status(), 200, "{file}");
            assert_eq!(
                header(&response, "Content-Security-Policy"),
                FILE_CSP,
                "{file}"
            );
        }
    }

    #[test]
    fn traversal_and_a_forgotten_system_are_404() {
        let setup = setup("ds-proto-traversal");
        fs::write(setup.root.parent().unwrap().join("secret.css"), "x").unwrap();
        let url = format!(
            "zorvo-artifact://localhost/ds/{SESSION}/{}/t/dark/f/../secret.css",
            setup.key
        );
        assert_eq!(get(&setup, &url).status(), 404);
        let other = ds_file_url(SESSION, KEY, "dark", "components/bundle.css");
        assert_eq!(get(&setup, &other).status(), 404);
        setup
            .served
            .store
            .forget_design_system(SESSION, &setup.key)
            .unwrap();
        let url = ds_file_url(SESSION, &setup.key, "dark", "components/bundle.css");
        assert_eq!(get(&setup, &url).status(), 404);
        assert_eq!(
            get(&setup, &ds_shell_url(SESSION, &setup.key)).status(),
            404
        );
    }

    #[test]
    fn a_system_outside_a_known_workspace_is_404() {
        let setup = setup("ds-proto-unknown");
        setup.known.store(false, Ordering::SeqCst);
        let url = ds_file_url(SESSION, &setup.key, "dark", "components/bundle.css");
        assert_eq!(get(&setup, &url).status(), 404);
        assert_eq!(
            get(&setup, &ds_shell_url(SESSION, &setup.key)).status(),
            404
        );
    }

    #[test]
    fn the_shell_is_served_only_for_a_remembered_system() {
        let setup = setup("ds-proto-shell");
        let response = get(&setup, &ds_shell_url(SESSION, &setup.key));
        assert_eq!(response.status(), 200);
        assert_eq!(header(&response, "Content-Security-Policy"), DS_SHELL_CSP);
        assert_eq!(body(&response), DS_SHELL);
        assert_eq!(get(&setup, &ds_shell_url(SESSION, KEY)).status(), 404);
        assert_eq!(get(&setup, &ds_shell_url("s2", &setup.key)).status(), 404);
    }

    #[test]
    fn the_scheme_answers_ds_urls() {
        let setup = setup("ds-proto-scheme");
        let url = ds_shell_url(SESSION, &setup.key);
        let response = super::super::protocol::respond(&setup.served, "GET", &url);
        assert_eq!(response.status(), 200);
        assert_eq!(header(&response, "Content-Security-Policy"), DS_SHELL_CSP);
    }

    #[test]
    fn navigation_allows_the_shell_and_this_systems_files_only() {
        let other = "d-fedcba9876543210";
        assert!(is_allowed_ds_navigation(
            &ds_shell_url(SESSION, KEY),
            SESSION,
            KEY
        ));
        assert!(is_allowed_ds_navigation(
            &ds_file_url(SESSION, KEY, "dark", "a.svg"),
            SESSION,
            KEY
        ));
        assert!(!is_allowed_ds_navigation(
            &ds_shell_url(SESSION, other),
            SESSION,
            KEY
        ));
        assert!(!is_allowed_ds_navigation(
            &ds_shell_url("s2", KEY),
            SESSION,
            KEY
        ));
        assert!(!is_allowed_ds_navigation(
            "https://example.com/",
            SESSION,
            KEY
        ));
        assert!(!is_allowed_ds_navigation(
            "zorvo-artifact://localhost/canvas/s1/c-0123456789abcdef/",
            SESSION,
            KEY
        ));
    }
}
