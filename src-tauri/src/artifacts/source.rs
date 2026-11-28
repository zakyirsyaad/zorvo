//! Reading the file an agent hands to `show_artifact`.
//!
//! The agent names any path it likes, so only an `.html` or `.htm` regular
//! file inside the session's folder or a temporary folder is ever read, and a
//! refusal never repeats the path.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const MAX_PAGE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_PATH_CHARS: usize = 4096;
pub const NOT_ALLOWED: &str =
    "That is not an HTML file in this session's folder or the temporary folder.";
pub const TOO_LARGE: &str = "The page is over 16 MB.";
pub const NOT_TEXT: &str = "The page is not valid UTF-8 text.";

/// The temporary folders a page may be written to: the system's own and `/tmp`.
pub fn temp_roots() -> Vec<PathBuf> {
    [std::env::temp_dir(), PathBuf::from("/tmp")]
        .into_iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .fold(Vec::new(), |mut roots, root| {
            if !roots.contains(&root) {
                roots.push(root);
            }
            roots
        })
}

fn has_html_name(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
        })
}

/// Reads the regular file at `path`, which must already be canonical.
///
/// The file is opened first and judged afterwards, from the open file itself:
/// a path can name another thing between a check and the open that follows it.
/// A link in the last place is not followed, and the open does not wait, since
/// a pipe nobody writes to would otherwise hold the call forever.
pub(crate) fn read_checked(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = read_bytes_checked(path)?;
    if std::str::from_utf8(&bytes).is_err() {
        return Err(NOT_TEXT.to_string());
    }
    Ok(bytes)
}

/// `read_checked` without the text check: a canvas serves pictures and fonts too.
pub(crate) fn read_bytes_checked(path: &Path) -> Result<Vec<u8>, String> {
    use std::os::unix::fs::OpenOptionsExt;
    let refused = || NOT_ALLOWED.to_string();
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| refused())?;
    let metadata = file.metadata().map_err(|_| refused())?;
    if !metadata.is_file() {
        return Err(refused());
    }
    if metadata.len() > MAX_PAGE_BYTES {
        return Err(TOO_LARGE.to_string());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| refused())?;
    if bytes.len() as u64 > MAX_PAGE_BYTES {
        return Err(TOO_LARGE.to_string());
    }
    Ok(bytes)
}

/// Reads the page at `path`, relative to `session_folder` (already canonical)
/// when it is not absolute. Returns the canonical path, which is the artifact's
/// identity, and the bytes.
pub fn read_source(
    session_folder: &Path,
    temp_roots: &[PathBuf],
    path: &str,
) -> Result<(String, Vec<u8>), String> {
    let refused = || NOT_ALLOWED.to_string();
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS {
        return Err(refused());
    }
    let canonical = fs::canonicalize(session_folder.join(path)).map_err(|_| refused())?;
    let is_inside = canonical.starts_with(session_folder)
        || temp_roots.iter().any(|root| canonical.starts_with(root));
    if !is_inside || !has_html_name(&canonical) {
        return Err(refused());
    }
    let bytes = read_checked(&canonical)?;
    let canonical = canonical.to_str().ok_or_else(refused)?.to_string();
    Ok((canonical, bytes))
}

fn has_visual_name(path: &Path) -> bool {
    has_html_name(path)
        || path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
}

/// Reads an inline visual's file under the page rules: inside the session's folder or a
/// temporary one, a regular `.html`, `.htm` or `.svg` file of valid UTF-8, within the visual cap.
pub fn read_visual_source(
    session_folder: &Path,
    temp_roots: &[PathBuf],
    path: &str,
    max_bytes: usize,
    too_large: &str,
) -> Result<Vec<u8>, String> {
    let refused = || NOT_ALLOWED.to_string();
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS {
        return Err(refused());
    }
    let canonical = fs::canonicalize(session_folder.join(path)).map_err(|_| refused())?;
    let is_inside = canonical.starts_with(session_folder)
        || temp_roots.iter().any(|root| canonical.starts_with(root));
    if !is_inside || !has_visual_name(&canonical) {
        return Err(refused());
    }
    let bytes = read_bytes_checked(&canonical)?;
    if bytes.len() > max_bytes {
        return Err(too_large.to_string());
    }
    Ok(bytes)
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)] // the tests make FIFOs with mkfifo directly
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A canonical temp folder removed when the test ends, even on panic.
    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zorvo-source-{tag}-{}-{nanos}", std::process::id()));
            fs::create_dir_all(&path).expect("create temp folder");
            Self(fs::canonicalize(path).expect("canonical temp folder"))
        }

        fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parent");
            }
            fs::write(&path, contents).expect("write file");
            path
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn text(path: &Path) -> &str {
        path.to_str().expect("utf-8 path")
    }

    #[test]
    fn accepts_a_file_in_the_session_folder() {
        let session = Temp::new("in");
        let page = session.file("out/report.html", b"<p>hi</p>");

        let (canonical, bytes) = read_source(&session.0, &[], text(&page)).unwrap();

        assert_eq!(canonical, text(&page));
        assert_eq!(bytes, b"<p>hi</p>");
    }

    #[test]
    fn accepts_a_relative_path_and_an_htm_file_in_any_case() {
        let session = Temp::new("rel");
        let page = session.file("Report.HTM", b"x");

        let (canonical, _) = read_source(&session.0, &[], "Report.HTM").unwrap();

        assert_eq!(canonical, text(&page));
    }

    #[test]
    fn accepts_a_file_in_a_temp_root() {
        let session = Temp::new("session");
        let temp_root = Temp::new("root");
        let page = temp_root.file("page.html", b"x");

        let read = read_source(&session.0, std::slice::from_ref(&temp_root.0), text(&page));

        assert!(read.is_ok());
    }

    #[test]
    fn refuses_what_is_not_an_html_file_in_an_allowed_folder() {
        let session = Temp::new("refuse");
        let outside = Temp::new("outside");
        let stray = outside.file("stray.html", b"x");
        session.file("notes.txt", b"x");
        fs::create_dir_all(session.0.join("folder.html")).unwrap();
        std::os::unix::fs::symlink(&stray, session.0.join("link.html")).unwrap();
        let fifo = session.0.join("pipe.html");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(made.success());
        let long = format!("{}.html", "a".repeat(MAX_PATH_CHARS));
        let leaving = format!(
            "../{}/stray.html",
            outside.0.file_name().unwrap().to_str().unwrap()
        );

        for path in [
            text(&stray),
            leaving.as_str(),
            "link.html",
            "folder.html",
            "pipe.html",
            "notes.txt",
            "missing.html",
            "~/page.html",
            "",
            long.as_str(),
        ] {
            let refused = read_source(&session.0, &[], path).unwrap_err();
            assert_eq!(refused, NOT_ALLOWED, "path: {path}");
        }
    }

    #[test]
    fn a_link_inside_the_folder_to_a_file_of_another_kind_is_refused() {
        let session = Temp::new("kind");
        let secret = session.file("secret.env", b"KEY=1");
        std::os::unix::fs::symlink(&secret, session.0.join("page.html")).unwrap();

        assert_eq!(
            read_source(&session.0, &[], "page.html").unwrap_err(),
            NOT_ALLOWED
        );
    }

    #[test]
    fn a_file_swapped_for_a_link_or_a_pipe_after_the_check_is_not_read() {
        let session = Temp::new("swap");
        let outside = Temp::new("swap-out");
        let secret = outside.file("secret.html", b"secret");
        let link = session.0.join("page.html");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let fifo = session.0.join("pipe.html");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(made.success());

        // What is opened is judged, not what the path named a moment earlier.
        assert_eq!(read_checked(&link).unwrap_err(), NOT_ALLOWED);
        // Returns at once: a pipe nobody writes to would otherwise hold the call forever.
        assert_eq!(read_checked(&fifo).unwrap_err(), NOT_ALLOWED);
        assert_eq!(read_checked(&session.0).unwrap_err(), NOT_ALLOWED);
    }

    #[test]
    fn refuses_a_page_over_16_mib_and_accepts_one_exactly_at_it() {
        let session = Temp::new("size");
        session.file("at.html", &vec![b'a'; MAX_PAGE_BYTES as usize]);
        session.file("over.html", &vec![b'a'; MAX_PAGE_BYTES as usize + 1]);

        assert!(read_source(&session.0, &[], "at.html").is_ok());
        assert_eq!(
            read_source(&session.0, &[], "over.html").unwrap_err(),
            TOO_LARGE
        );
    }

    #[test]
    fn refuses_invalid_utf8() {
        let session = Temp::new("utf8");
        session.file("bad.html", &[0xff, 0xfe, 0x00, 0x41]);

        assert_eq!(
            read_source(&session.0, &[], "bad.html").unwrap_err(),
            NOT_TEXT
        );
    }

    #[test]
    fn no_refusal_repeats_the_path() {
        for refusal in [NOT_ALLOWED, TOO_LARGE, NOT_TEXT] {
            assert!(!refusal.contains('/'));
            assert!(!refusal.contains("{"));
        }
    }

    #[test]
    fn temp_roots_are_canonical_and_hold_the_system_temp_folder() {
        let roots = temp_roots();

        assert!(roots.contains(&fs::canonicalize(std::env::temp_dir()).unwrap()));
        assert!(roots.contains(&PathBuf::from("/private/tmp")));
        let unique: std::collections::HashSet<_> = roots.iter().collect();
        assert_eq!(unique.len(), roots.len());
    }
}
