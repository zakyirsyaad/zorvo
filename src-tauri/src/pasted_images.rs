//! Images pasted into the composer.
//!
//! A pasted image has no file, and an attachment is a path, so the webview sends
//! the bytes and this module writes them to a file Zorvo owns under the app data
//! dir's `pasted-images/`. The path that comes back is an ordinary absolute
//! attachment path: the preview (`attachments::check_previewable`), the send path
//! and a compare run's per-worktree copy (`attachment_paths`, which leaves a file
//! outside the repository as it is) all take it unchanged.
//!
//! Nothing from the webview decides what lands on disk: the type is read from the
//! bytes' own magic number (never from a MIME type), the size is capped at what
//! the preview accepts, and the file name is made here.
//!
//! Cleanup: a paste is written when it is attached, so one removed from the
//! composer or never sent stays. [`sweep_old`] runs once at start and deletes
//! pasted files older than [`MAX_AGE`]; a sent image keeps its thumbnail in the
//! transcript for that long.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use tauri::State;

use crate::attachments::{sniff_mime, MAX_PREVIEW_BYTES};
use crate::store::AppStore;

/// The folder under the app data dir that holds pasted images.
pub const PASTED_DIR: &str = "pasted-images";

/// Pasted files older than this are deleted at start.
pub const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// A pasted image is previewed like any attachment, so it gets the same cap.
pub const MAX_PASTED_BYTES: usize = MAX_PREVIEW_BYTES as usize;

const NAME_PREFIX: &str = "paste-";

fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        _ => "webp",
    }
}

fn too_large() -> String {
    format!(
        "The image is larger than {} MB",
        MAX_PASTED_BYTES / (1024 * 1024)
    )
}

/// A name no other paste has: the time, then a counter for pastes in one millisecond.
fn next_name(extension: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{NAME_PREFIX}{millis}-{n}.{extension}")
}

/// Writes `bytes` as a new file in `dir` and returns its canonical path. Refuses
/// empty or oversized input and anything that is not a PNG, JPEG, GIF or WebP.
pub fn save_image(dir: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() {
        return Err("The clipboard image is empty".to_string());
    }
    if bytes.len() > MAX_PASTED_BYTES {
        return Err(too_large());
    }
    let mime = sniff_mime(bytes).ok_or_else(|| "The pasted data is not an image".to_string())?;
    fs::create_dir_all(dir)
        .map_err(|e| format!("Could not create the folder for pasted images: {e}"))?;
    let path = dir.join(next_name(extension_for(mime)));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("Could not save the image: {e}"))?;
    if let Err(error) = file.write_all(bytes) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("Could not save the image: {error}"));
    }
    path.canonicalize()
        .map_err(|e| format!("Could not save the image: {e}"))
}

/// Deletes the pasted files in `dir` that were last changed more than `max_age`
/// before `now`, and returns how many. Only regular files this module names are
/// touched; anything else in the folder is left alone, and a failure on one file
/// does not stop the rest.
pub fn sweep_old(dir: &Path, now: SystemTime, max_age: Duration) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(NAME_PREFIX))
        })
        .filter(|entry| {
            entry.metadata().is_ok_and(|meta| {
                meta.is_file()
                    && meta
                        .modified()
                        .ok()
                        .and_then(|modified| now.duration_since(modified).ok())
                        .is_some_and(|age| age > max_age)
            })
        })
        .filter(|entry| fs::remove_file(entry.path()).is_ok())
        .count()
}

/// Where pasted images are kept for `store`.
pub fn pasted_dir(store: &AppStore) -> PathBuf {
    store.root().join(PASTED_DIR)
}

/// Decodes the webview's base64 and saves it with [`save_image`]. The encoded
/// length is checked first, so an oversized paste is never decoded.
fn save_encoded(dir: &Path, data: &str) -> Result<PathBuf, String> {
    // Base64 is 4 characters per 3 bytes, with padding.
    if data.len() > MAX_PASTED_BYTES / 3 * 4 + 4 {
        return Err(too_large());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "The pasted data is not an image".to_string())?;
    save_image(dir, &bytes)
}

/// Saves a pasted image (`data` is its bytes, base64) and returns the path to
/// attach. The UI sends only the bytes; the folder and the name are the backend's.
#[tauri::command(async)]
pub fn save_pasted_image(store: State<'_, AppStore>, data: String) -> Result<String, String> {
    save_encoded(&pasted_dir(&store), &data).map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1×1 transparent PNG.
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    /// A temp folder removed when the test ends, even on panic.
    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zorvo-paste-{tag}-{}-{nanos}", std::process::id()));
            fs::create_dir_all(&path).expect("create temp folder");
            Self(path)
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn png_bytes() -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(PNG)
            .expect("decode png")
    }

    #[test]
    fn saves_a_png_under_a_generated_name() {
        let temp = Temp::new("png");
        let dir = temp.0.join(PASTED_DIR);

        let path = save_image(&dir, &png_bytes()).expect("a real png saves");

        assert!(path.is_absolute());
        assert_eq!(path.parent(), dir.canonicalize().ok().as_deref());
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(
            name.starts_with("paste-") && name.ends_with(".png"),
            "{name}"
        );
        assert_eq!(fs::read(&path).unwrap(), png_bytes());
    }

    #[test]
    fn the_saved_file_is_accepted_by_the_preview_check() {
        let temp = Temp::new("preview");

        let path = save_image(&temp.0, &png_bytes()).expect("saves");

        assert_eq!(
            crate::attachments::check_previewable(&path),
            Ok("image/png")
        );
    }

    #[test]
    fn names_the_extension_from_the_bytes() {
        let temp = Temp::new("types");
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
        let gif = b"GIF89a\x01\x00".to_vec();
        let mut webp = b"RIFF\x00\x00\x00\x00WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0; 8]);

        let jpeg = save_image(&temp.0, &jpeg).unwrap();
        let gif = save_image(&temp.0, &gif).unwrap();
        let webp = save_image(&temp.0, &webp).unwrap();

        assert_eq!(jpeg.extension().unwrap(), "jpg");
        assert_eq!(gif.extension().unwrap(), "gif");
        assert_eq!(webp.extension().unwrap(), "webp");
    }

    #[test]
    fn two_pastes_never_share_a_file() {
        let temp = Temp::new("unique");

        let a = save_image(&temp.0, &png_bytes()).unwrap();
        let b = save_image(&temp.0, &png_bytes()).unwrap();

        assert_ne!(a, b);
    }

    #[test]
    fn refuses_bytes_that_are_not_an_image() {
        let temp = Temp::new("text");

        let error = save_image(&temp.0, b"just some notes").expect_err("not an image");

        assert!(error.contains("not an image"), "{error}");
        assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 0, "nothing written");
    }

    #[test]
    fn refuses_html_that_mentions_a_mime_type() {
        // The webview's MIME type is never read: only the bytes count.
        let temp = Temp::new("html");

        let error = save_image(&temp.0, b"<html>image/png</html>").expect_err("html");

        assert!(error.contains("not an image"), "{error}");
    }

    #[test]
    fn refuses_empty_data() {
        let temp = Temp::new("empty");

        let error = save_image(&temp.0, &[]).expect_err("empty");

        assert!(error.contains("empty"), "{error}");
    }

    #[test]
    fn refuses_an_image_over_the_cap() {
        let temp = Temp::new("big");
        let mut bytes = png_bytes();
        bytes.resize(MAX_PASTED_BYTES + 1, 0);

        let error = save_image(&temp.0, &bytes).expect_err("too large");

        assert!(error.contains("larger than 10 MB"), "{error}");
        assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 0, "nothing written");
    }

    #[test]
    fn accepts_an_image_exactly_at_the_cap() {
        let temp = Temp::new("cap");
        let mut bytes = png_bytes();
        bytes.resize(MAX_PASTED_BYTES, 0);

        assert!(save_image(&temp.0, &bytes).is_ok());
    }

    #[test]
    fn decodes_the_base64_the_webview_sends() {
        let temp = Temp::new("b64");

        let path = save_encoded(&temp.0, PNG).expect("saves");

        assert_eq!(fs::read(path).unwrap(), png_bytes());
    }

    #[test]
    fn refuses_base64_that_is_not_valid() {
        let temp = Temp::new("badb64");

        let error = save_encoded(&temp.0, "***not base64***").expect_err("invalid");

        assert!(error.contains("not an image"), "{error}");
    }

    #[test]
    fn refuses_an_oversized_encoding_before_decoding_it() {
        let temp = Temp::new("hugeb64");
        let data = "A".repeat(MAX_PASTED_BYTES / 3 * 4 + 8);

        let error = save_encoded(&temp.0, &data).expect_err("too large");

        assert!(error.contains("larger than 10 MB"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let temp = Temp::new("mode");

        let path = save_image(&temp.0, &png_bytes()).unwrap();

        let mode = fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn sweeps_old_pasted_files_and_leaves_other_files() {
        let temp = Temp::new("sweep");
        let old = temp.0.join("paste-1-0.png");
        let other = temp.0.join("notes.txt");
        for path in [&old, &other] {
            fs::write(path, "x").unwrap();
        }
        let in_thirty_one_days = SystemTime::now() + Duration::from_secs(31 * 24 * 60 * 60);

        assert_eq!(sweep_old(&temp.0, in_thirty_one_days, MAX_AGE), 1);

        assert!(!old.exists());
        assert!(other.exists(), "a file this module did not name stays");
    }

    #[test]
    fn keeps_a_recent_pasted_file() {
        let temp = Temp::new("keep");
        let recent = temp.0.join("paste-3-0.png");
        fs::write(&recent, "x").unwrap();

        assert_eq!(sweep_old(&temp.0, SystemTime::now(), MAX_AGE), 0);
        assert!(recent.exists());
    }

    #[test]
    fn sweeping_a_missing_folder_does_nothing() {
        let temp = Temp::new("nofolder");

        assert_eq!(
            sweep_old(&temp.0.join("absent"), SystemTime::now(), MAX_AGE),
            0
        );
    }
}
