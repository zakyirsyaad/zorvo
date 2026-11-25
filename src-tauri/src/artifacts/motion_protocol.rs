//! The `zorvo-artifact://localhost/motion/…` routes: Zorvo's preview wrapper and a composition's
//! files, for the preview view and the hidden view that renders. Only a remembered motion whose
//! folder is inside a known workspace is served, and only its own files.

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::http::Response;

use super::canvas::is_id;
use super::commands::is_inside_known_session_folder;
use super::motion::{motion_file, Motion, MotionFormat};
use super::motion_store::is_motion_key;
use super::protocol::{Served, BOARD_CSP, FILE_CSP};
use super::store::is_session_id;

const ORIGIN: &str = "zorvo-artifact://localhost/";
const MOTION_PREFIX: &str = "motion/";

/// The motion runtime and the preview wrapper. Each is pinned by its SHA-256 in the tests below.
pub const MOTION_RUNTIME: &str = include_str!("motion_runtime.js");
pub const MOTION_SHELL: &str = include_str!("motion_shell.html");

/// The wrapper's own CSP: its inline script and style, the composition's page in a frame, and
/// the composition's audio. Nothing to fetch, and a sandbox with scripts only.
pub const MOTION_SHELL_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; \
media-src zorvo-artifact://localhost; connect-src 'none'; object-src 'none'; base-uri 'none'; \
form-action 'none'; sandbox allow-scripts";

#[derive(Debug, Clone, PartialEq)]
pub enum MotionUrl {
    Shell {
        session_id: String,
        key: String,
    },
    File {
        session_id: String,
        key: String,
        relative: String,
    },
}

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

pub fn motion_shell_url(session_id: &str, key: &str) -> String {
    format!("{ORIGIN}{MOTION_PREFIX}{session_id}/{key}/")
}

pub fn motion_file_url(session_id: &str, key: &str, relative: &str) -> String {
    let encoded: Vec<String> = relative.split('/').map(encode_segment).collect();
    format!(
        "{ORIGIN}{MOTION_PREFIX}{session_id}/{key}/f/{}",
        encoded.join("/")
    )
}

/// The page of `motion` in `format`, with what the runtime reads from its query.
pub fn motion_page_url(
    session_id: &str,
    key: &str,
    motion: &Motion,
    format: &MotionFormat,
) -> String {
    format!(
        "{}?format={}&w={}&h={}&d={}&fps={}",
        motion_file_url(session_id, key, &motion.page),
        format.id,
        format.width,
        format.height,
        motion.duration,
        motion.fps
    )
}

pub fn parse_motion_url(uri: &str) -> Option<MotionUrl> {
    let path = uri.strip_prefix(ORIGIN)?.split(['?', '#']).next()?;
    let rest = path.strip_prefix(MOTION_PREFIX)?;
    let mut parts = rest.splitn(4, '/');
    let (session_id, key, after) = (parts.next()?, parts.next()?, parts.next()?);
    if !is_session_id(session_id) || !is_motion_key(key) {
        return None;
    }
    let (session_id, key) = (session_id.to_string(), key.to_string());
    if after.is_empty() {
        return parts
            .next()
            .is_none()
            .then_some(MotionUrl::Shell { session_id, key });
    }
    if after != "f" {
        return None;
    }
    let tail = parts.next().filter(|tail| !tail.is_empty())?;
    let relative = tail
        .split('/')
        .map(decode_segment)
        .collect::<Option<Vec<_>>>()?
        .join("/");
    Some(MotionUrl::File {
        session_id,
        key,
        relative,
    })
}

/// Whether a motion view may go to `url`: the wrapper and the files of this motion only.
pub fn is_allowed_motion_navigation(url: &str, session_id: &str, key: &str) -> bool {
    match parse_motion_url(url) {
        Some(MotionUrl::Shell {
            session_id: s,
            key: k,
        })
        | Some(MotionUrl::File {
            session_id: s,
            key: k,
            ..
        }) => s == session_id && k == key,
        None => false,
    }
}

fn not_found() -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = tauri::http::StatusCode::NOT_FOUND;
    response
}

fn answer(kind: &str, csp: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(200)
        .header("Content-Type", kind)
        .header("Content-Security-Policy", csp)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap_or_else(|_| not_found())
}

/// The folder of a remembered motion, when it is still inside a known workspace.
pub fn motion_root(served: &Served, session_id: &str, key: &str) -> Option<PathBuf> {
    let entry = served.store.motion(session_id, key)?;
    let root = PathBuf::from(&entry.folder);
    let known = |path: &Path| (served.is_known)(path);
    is_inside_known_session_folder(&root, &entry.relative, &known).then_some(root)
}

/// Answers a motion route; `None` for a URL that is not one.
pub fn respond_motion(served: &Served, uri: &str) -> Option<Response<Vec<u8>>> {
    let url = parse_motion_url(uri)?;
    Some(match url {
        MotionUrl::Shell { session_id, key } => match motion_root(served, &session_id, &key) {
            Some(_) => answer(
                "text/html; charset=utf-8",
                MOTION_SHELL_CSP,
                MOTION_SHELL.as_bytes().to_vec(),
            ),
            None => not_found(),
        },
        MotionUrl::File {
            session_id,
            key,
            relative,
        } => {
            let Some(root) = motion_root(served, &session_id, &key) else {
                return Some(not_found());
            };
            let Some((path, kind)) = motion_file(&root, &relative) else {
                return Some(not_found());
            };
            let Ok(body) = super::source::read_bytes_checked(&path) else {
                return Some(not_found());
            };
            let csp = if kind.starts_with("text/html") {
                BOARD_CSP
            } else {
                FILE_CSP
            };
            answer(kind, csp, body)
        }
    })
}

/// The state the wrapper is handed: the format shown, each format's page URL and the audio.
pub fn shell_state(
    session_id: &str,
    key: &str,
    motion: &Motion,
    format: &str,
    version: &str,
) -> String {
    let formats: Vec<_> = motion
        .formats
        .iter()
        .map(|f| {
            json!({
                "id": f.id,
                "width": f.width,
                "height": f.height,
                "url": motion_page_url(session_id, key, motion, f),
            })
        })
        .collect();
    let audio: Vec<_> = motion
        .audio
        .iter()
        .map(|track| {
            json!({
                "url": motion_file_url(session_id, key, &track.file),
                "start": track.start,
                "volume": track.volume,
            })
        })
        .collect();
    let shown = if motion.format(format).is_some() {
        format.to_string()
    } else {
        motion.formats[0].id.clone()
    };
    json!({
        "key": key,
        "version": version,
        "title": motion.title,
        "duration": motion.duration,
        "format": shown,
        "formats": formats,
        "audio": audio,
    })
    .to_string()
}

/// The script that hands the wrapper `state_json`.
pub fn apply_script(state_json: &str) -> String {
    format!("window.__zorvoMotionShell && window.__zorvoMotionShell.apply({state_json});")
}

/// One of the wrapper's commands, from a fixed list; `None` for anything else.
pub fn command_script(name: &str, value: Option<f64>) -> Option<String> {
    let call = match name {
        "play" => "play()".to_string(),
        "pause" => "pause()".to_string(),
        "mute" => "mute(true)".to_string(),
        "unmute" => "mute(false)".to_string(),
        "seek" => {
            let t = value.filter(|t| t.is_finite() && *t >= 0.0)?;
            format!("seek({t})")
        }
        _ => return None,
    };
    Some(format!(
        "window.__zorvoMotionShell && window.__zorvoMotionShell.{call};"
    ))
}

/// Whether `id` could be a format id; checked before it reaches a script or a file name.
pub fn is_format_id(id: &str) -> bool {
    is_id(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    const SESSION: &str = "session-1";
    const KEY: &str = "m-0123456789abcdef";

    fn sha(text: &str) -> String {
        Sha256::digest(text.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn parses_shell_and_file_urls() {
        assert_eq!(
            parse_motion_url(&motion_shell_url(SESSION, KEY)),
            Some(MotionUrl::Shell {
                session_id: SESSION.into(),
                key: KEY.into()
            })
        );
        let url = motion_file_url(SESSION, KEY, "audio/bed one.mp3");
        assert!(url.ends_with("/f/audio/bed%20one.mp3"));
        assert_eq!(
            parse_motion_url(&format!("{url}?v=1")),
            Some(MotionUrl::File {
                session_id: SESSION.into(),
                key: KEY.into(),
                relative: "audio/bed one.mp3".into()
            })
        );
        assert_eq!(
            parse_motion_url(&format!("{ORIGIN}motion/{SESSION}/c-0123456789abcdef/")),
            None
        );
        assert_eq!(
            parse_motion_url(&format!("{ORIGIN}motion/{SESSION}/{KEY}/f/a%2Fb")),
            None
        );
    }

    #[test]
    fn navigation_stays_in_one_motion() {
        assert!(is_allowed_motion_navigation(
            &motion_shell_url(SESSION, KEY),
            SESSION,
            KEY
        ));
        assert!(!is_allowed_motion_navigation(
            &motion_shell_url(SESSION, "m-ffffffffffffffff"),
            SESSION,
            KEY
        ));
        assert!(!is_allowed_motion_navigation(
            "https://example.com/",
            SESSION,
            KEY
        ));
    }

    #[test]
    fn commands_come_from_a_fixed_list() {
        assert!(command_script("play", None).is_some());
        assert_eq!(
            command_script("seek", Some(4.5)).as_deref(),
            Some("window.__zorvoMotionShell && window.__zorvoMotionShell.seek(4.5);")
        );
        assert!(command_script("seek", Some(f64::NAN)).is_none());
        assert!(command_script("seek", None).is_none());
        assert!(command_script("eval", None).is_none());
    }

    #[test]
    fn the_shell_csp_is_exactly() {
        assert!(MOTION_SHELL_CSP.contains("connect-src 'none'"));
        assert!(MOTION_SHELL_CSP.contains("media-src zorvo-artifact://localhost;"));
        assert!(!MOTION_SHELL_CSP.contains("http"));
    }

    #[test]
    fn motion_runtime_is_pinned() {
        assert_eq!(
            sha(MOTION_RUNTIME),
            "cab7bbf7c271c10497ed6e4cb01493a7f587297e16bca790fd44ffb6fae9a2f1",
            "motion_runtime.js changed: review it, then update this hash"
        );
    }

    #[test]
    fn motion_shell_is_pinned() {
        assert!(!MOTION_SHELL.contains("http"));
        assert_eq!(
            sha(MOTION_SHELL),
            "fa8778e0c304f0a50cdcf13fc1e6bd0b7e3298866b648effe5f4c480a72f2b03",
            "motion_shell.html changed: review it, then update this hash"
        );
    }
}
