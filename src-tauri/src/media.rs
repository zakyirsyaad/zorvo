//! Videos the main webview plays: the chat's video cards, Output and the Files viewer.
//!
//! The webview never names a file. A command checks what it asks for (a video an agent showed, a
//! motion's rendered format, or a workspace file whose header is a video) and hands back
//! `zorvo-media://localhost/<token>`; the scheme answers only tokens it made, with byte ranges,
//! since WebKit reads media in ranges and a video can be large. Tokens live in memory only.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::State;

use crate::artifacts::motion::{out_file, read_motion};
use crate::artifacts::motion_protocol::motion_root;
use crate::artifacts::protocol::Served;
use crate::artifacts::store::ArtifactStore;
use crate::files::{ensure_known_workspace, resolve_inside_root};
use crate::store::AppStore;

pub const SCHEME: &str = "zorvo-media";
const URL_PREFIX: &str = "zorvo-media://localhost/";
const TOKEN_HEX_CHARS: usize = 32;
const MAX_TOKENS: usize = 500;
const TOKEN_LIFETIME: Duration = Duration::from_secs(12 * 60 * 60);
/// The most one answer carries; WebKit asks again for the rest.
pub const MAX_CHUNK: u64 = 4 * 1024 * 1024;
/// A request without a range gets the whole file only up to this size.
const MAX_WHOLE: u64 = 16 * 1024 * 1024;
pub const NOT_A_VIDEO: &str = "That file is not a video Zorvo can play.";
pub const NOT_RENDERED: &str = "That format has not been rendered yet.";

/// A video's type from its first bytes: MP4 and QuickTime (`ftyp` at offset 4, any brand but an
/// audio-only one). Never from the name.
pub fn sniff_video(header: &[u8]) -> Option<&'static str> {
    if header.len() < 12 || &header[4..8] != b"ftyp" {
        return None;
    }
    match &header[8..12] {
        b"M4A " | b"M4B " | b"M4P " | b"F4A " | b"F4B " => None,
        b"qt  " => Some("video/quicktime"),
        _ => Some("video/mp4"),
    }
}

/// The video type of the file at `path`, read from its first bytes. A folder, a pipe or a socket is
/// refused from its metadata first, so opening never blocks.
pub fn video_type(path: &Path) -> Option<&'static str> {
    if !fs::metadata(path).ok()?.is_file() {
        return None;
    }
    let mut header = [0u8; 12];
    fs::File::open(path).ok()?.read_exact(&mut header).ok()?;
    sniff_video(&header)
}

struct Target {
    path: PathBuf,
    mime: &'static str,
    made: Instant,
}

/// The tokens the scheme answers.
#[derive(Default)]
pub struct MediaTokens {
    tokens: Mutex<HashMap<String, Target>>,
}

fn random_token() -> Option<String> {
    let mut bytes = [0u8; TOKEN_HEX_CHARS / 2];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl MediaTokens {
    /// A URL for `path`, a video of type `mime`. The oldest token goes when there are too many.
    pub fn issue(&self, path: PathBuf, mime: &'static str) -> Result<String, String> {
        let token = random_token().ok_or_else(|| NOT_A_VIDEO.to_string())?;
        let mut tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        tokens.retain(|_, target| target.made.elapsed() < TOKEN_LIFETIME);
        if tokens.len() >= MAX_TOKENS {
            let oldest = tokens
                .iter()
                .min_by_key(|(_, target)| target.made)
                .map(|(token, _)| token.clone());
            if let Some(oldest) = oldest {
                tokens.remove(&oldest);
            }
        }
        tokens.insert(
            token.clone(),
            Target {
                path,
                mime,
                made: Instant::now(),
            },
        );
        Ok(format!("{URL_PREFIX}{token}"))
    }

    fn target(&self, token: &str) -> Option<(PathBuf, &'static str)> {
        let tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        tokens
            .get(token)
            .filter(|target| target.made.elapsed() < TOKEN_LIFETIME)
            .map(|target| (target.path.clone(), target.mime))
    }
}

/// A single byte range of a file `len` bytes long, inclusive, cut to `MAX_CHUNK`. `None` when the
/// header is not one range Zorvo reads, `Some(Err(()))` when it starts past the end.
pub fn parse_range(value: &str, len: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", "") => return None,
        ("", suffix) => {
            let suffix: u64 = suffix.parse().ok()?;
            if suffix == 0 {
                return Some(Err(()));
            }
            (len.saturating_sub(suffix), len.saturating_sub(1))
        }
        (start, "") => (start.parse().ok()?, len.saturating_sub(1)),
        (start, end) => (start.parse().ok()?, end.parse::<u64>().ok()?),
    };
    if len == 0 || start >= len || end < start {
        return Some(Err(()));
    }
    let end = end.min(len - 1).min(start + MAX_CHUNK - 1);
    Some(Ok((start, end)))
}

fn status_only(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn read_span(path: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(end - start + 1).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// The scheme's answer to `request`: only `GET` and `HEAD` of a token this run made.
pub fn respond(tokens: &MediaTokens, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let method = request.method().as_str();
    if method != "GET" && method != "HEAD" {
        return status_only(StatusCode::METHOD_NOT_ALLOWED);
    }
    let token = request.uri().path().trim_start_matches('/');
    let Some((path, mime)) = tokens.target(token) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let Ok(meta) = fs::metadata(&path) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    if !meta.is_file() {
        return status_only(StatusCode::NOT_FOUND);
    }
    let len = meta.len();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, len));
    let (status, start, end) = match range {
        Some(Err(())) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
        Some(Ok((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end),
        None if len == 0 => (StatusCode::OK, 0, 0),
        None if len <= MAX_WHOLE => (StatusCode::OK, 0, len - 1),
        None => (StatusCode::PARTIAL_CONTENT, 0, MAX_CHUNK - 1),
    };
    let body = if method == "HEAD" || len == 0 {
        Vec::new()
    } else {
        match read_span(&path, start, end) {
            Ok(bytes) => bytes,
            Err(_) => return status_only(StatusCode::NOT_FOUND),
        }
    };
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(
            header::CONTENT_LENGTH,
            if len == 0 { 0 } else { end - start + 1 },
        );
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// A URL for a workspace file the Files viewer shows, when its header is a video.
#[tauri::command(async)]
pub fn media_url_for_file(
    store: State<'_, AppStore>,
    tokens: State<'_, MediaTokens>,
    root: String,
    relative: String,
) -> Result<String, String> {
    ensure_known_workspace(&root, |r| store.is_known_workspace(r))?;
    let (_, target) = resolve_inside_root(&root, &relative)?;
    let mime = video_type(&target).ok_or_else(|| NOT_A_VIDEO.to_string())?;
    tokens.issue(target, mime)
}

/// A URL for a video an agent showed in `session_id`.
#[tauri::command(async)]
pub fn media_url_for_video(
    artifacts: State<'_, Arc<ArtifactStore>>,
    store: State<'_, AppStore>,
    tokens: State<'_, MediaTokens>,
    session_id: String,
    key: String,
) -> Result<String, String> {
    let entry = artifacts
        .video(&session_id, &key)
        .ok_or_else(|| NOT_A_VIDEO.to_string())?;
    let path = PathBuf::from(&entry.path);
    if !is_in_known_session_folder(&store, &path, &entry.relative) {
        return Err(NOT_A_VIDEO.to_string());
    }
    let mime = video_type(&path).ok_or_else(|| NOT_A_VIDEO.to_string())?;
    tokens.issue(path, mime)
}

/// A URL for a motion's rendered format, when it has been rendered.
#[tauri::command(async)]
pub fn media_url_for_render(
    served: State<'_, Arc<Served>>,
    tokens: State<'_, MediaTokens>,
    session_id: String,
    key: String,
    format: String,
) -> Result<String, String> {
    let root = motion_root(&served, &session_id, &key).ok_or_else(|| NOT_RENDERED.to_string())?;
    let motion = read_motion(&root)?;
    let format = motion
        .format(&format)
        .ok_or_else(|| NOT_RENDERED.to_string())?;
    let path = out_file(&root, &format.id);
    let mime = video_type(&path).ok_or_else(|| NOT_RENDERED.to_string())?;
    tokens.issue(path, mime)
}

/// Whether the file at `path` is still inside the session folder it was shown from (its path
/// minus `relative`), and that folder is one the user has open.
fn is_in_known_session_folder(store: &AppStore, path: &Path, relative: &str) -> bool {
    let Ok(file) = fs::canonicalize(path) else {
        return false;
    };
    let mut folder = file.clone();
    for _ in relative.split('/').filter(|part| !part.is_empty()) {
        if !folder.pop() {
            return false;
        }
    }
    file.starts_with(&folder) && store.is_known_workspace(&folder).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    fn mp4(brand: &[u8; 4]) -> Vec<u8> {
        let mut bytes = vec![0, 0, 0, 24];
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(brand);
        bytes.extend_from_slice(&[0; 12]);
        bytes
    }

    #[test]
    fn sniffs_videos_by_header_only() {
        assert_eq!(sniff_video(&mp4(b"isom")), Some("video/mp4"));
        assert_eq!(sniff_video(&mp4(b"qt  ")), Some("video/quicktime"));
        assert_eq!(sniff_video(&mp4(b"M4A ")), None);
        assert_eq!(sniff_video(b"\x89PNG\r\n\x1a\n0000"), None);
        assert_eq!(sniff_video(b"short"), None);
    }

    #[test]
    fn parses_one_range_and_caps_it() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some(Ok((0, 99))));
        assert_eq!(parse_range("bytes=900-", 1000), Some(Ok((900, 999))));
        assert_eq!(parse_range("bytes=-100", 1000), Some(Ok((900, 999))));
        assert_eq!(
            parse_range("bytes=0-", 100 * MAX_CHUNK),
            Some(Ok((0, MAX_CHUNK - 1)))
        );
        assert_eq!(parse_range("bytes=1000-", 1000), Some(Err(())));
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    fn get(tokens: &MediaTokens, url: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut builder = Request::builder().method("GET").uri(url);
        if let Some(range) = range {
            builder = builder.header(header::RANGE, range);
        }
        respond(tokens, &builder.body(Vec::new()).expect("request"))
    }

    #[test]
    fn answers_only_issued_tokens_with_ranges() {
        let dir = Temp::new("media-scheme");
        let file = dir.0.join("clip.mp4");
        let mut bytes = mp4(b"isom");
        bytes.extend((0..200u8).collect::<Vec<_>>());
        fs::write(&file, &bytes).expect("clip");
        let tokens = MediaTokens::default();
        let url = tokens.issue(file, "video/mp4").expect("token");
        assert!(url.starts_with(URL_PREFIX));

        let part = get(&tokens, &url, Some("bytes=4-7"));
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.body(), b"ftyp");
        assert_eq!(
            part.headers()[header::CONTENT_RANGE],
            format!("bytes 4-7/{}", bytes.len()).as_str()
        );

        let whole = get(&tokens, &url, None);
        assert_eq!(whole.status(), StatusCode::OK);
        assert_eq!(whole.body().len(), bytes.len());

        assert_eq!(
            get(&tokens, &url, Some("bytes=9999-")).status(),
            StatusCode::RANGE_NOT_SATISFIABLE
        );
        assert_eq!(
            get(&tokens, &format!("{URL_PREFIX}{}", "0".repeat(32)), None).status(),
            StatusCode::NOT_FOUND
        );
        let post = Request::builder()
            .method("POST")
            .uri(&url)
            .body(Vec::new())
            .expect("post");
        assert_eq!(
            respond(&tokens, &post).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[test]
    fn keeps_at_most_the_newest_tokens() {
        let tokens = MediaTokens::default();
        let first = tokens
            .issue(PathBuf::from("/a"), "video/mp4")
            .expect("first");
        for _ in 0..MAX_TOKENS {
            tokens
                .issue(PathBuf::from("/b"), "video/mp4")
                .expect("more");
        }
        let token = first.trim_start_matches(URL_PREFIX);
        assert!(tokens.target(token).is_none());
    }
}
