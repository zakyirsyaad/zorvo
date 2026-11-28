//! Images on their way from the driver to an agent.
//!
//! The driver reads a pixel coordinate in the pixels of the image it
//! returned, so an image is never resized here: a PNG is only encoded again
//! as JPEG, at the same size. An agent on the command path prints text only,
//! so its images are written to a folder of its session and it gets the path.

use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use image::codecs::jpeg::JpegEncoder;
use image::ImageFormat;

const JPEG_QUALITY: u8 = 80;
/// The driver caps an image's long edge at 1366 px; this is far above it.
const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;
const SHOTS_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

static NEXT_SHOT: AtomicU64 = AtomicU64::new(1);

/// `png` as a JPEG of the same width and height.
pub fn to_jpeg_same_size(png: &[u8]) -> Result<Vec<u8>, String> {
    if png.len() > MAX_IMAGE_BYTES {
        return Err("The image is too large.".to_string());
    }
    let decoded = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|_| "The image could not be read.".to_string())?;
    // JPEG has no alpha.
    let rgb = decoded.to_rgb8();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|_| "The image could not be written.".to_string())?;
    Ok(jpeg)
}

/// An image block's bytes as a JPEG: a PNG is encoded again, a JPEG is kept.
/// `None` for anything else.
pub fn jpeg_of(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        to_jpeg_same_size(bytes).ok()
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.len() <= MAX_IMAGE_BYTES {
        Some(bytes.to_vec())
    } else {
        None
    }
}

fn shots_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("computer-use").join("shots")
}

/// A session id is Zorvo's own, but it becomes a folder name here.
fn is_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn private_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir)
        .and_then(|_| fs::set_permissions(dir, fs::Permissions::from_mode(0o700)))
        .map_err(|_| "The image could not be saved.".to_string())
}

/// Writes `jpeg` where only the user can read it and returns its path.
pub fn write_for_command_path(
    data_dir: &Path,
    session: &str,
    jpeg: &[u8],
) -> Result<PathBuf, String> {
    if !is_folder_name(session) {
        return Err("The image could not be saved.".to_string());
    }
    let shots = shots_dir(data_dir);
    private_dir(&shots)?;
    let folder = shots.join(session);
    private_dir(&folder)?;
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let path = folder.join(format!(
        "shot-{millis}-{}.jpg",
        NEXT_SHOT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|_| "The image could not be saved.".to_string())?;
    file.write_all(jpeg)
        .map_err(|_| "The image could not be saved.".to_string())?;
    Ok(path)
}

/// Deletes a session's images: it ended.
pub fn forget(data_dir: &Path, session: &str) {
    if is_folder_name(session) {
        let _ = fs::remove_dir_all(shots_dir(data_dir).join(session));
    }
}

/// Deletes the image folders no session touched for a day. Run once at start.
pub fn sweep_old(data_dir: &Path) {
    let Ok(entries) = fs::read_dir(shots_dir(data_dir)) else {
        return;
    };
    for entry in entries.flatten() {
        let is_old = entry
            .metadata()
            .ok()
            .filter(|meta| meta.is_dir())
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > SHOTS_MAX_AGE);
        if is_old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// A 4×4 PNG.
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGPQqDgBRwzEcQA/UhaB575xBAAAAABJRU5ErkJggg==";

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("zorvo-shots-{name}-{}", std::process::id()))
    }

    fn png() -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(PNG)
            .unwrap()
    }

    #[test]
    fn jpeg_keeps_the_size() {
        let jpeg = to_jpeg_same_size(&png()).unwrap();
        let decoded = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (4, 4));
    }

    #[test]
    fn only_a_png_or_a_jpeg_passes() {
        let jpeg = jpeg_of(&png()).unwrap();
        assert_eq!(jpeg_of(&jpeg), Some(jpeg));
        assert_eq!(jpeg_of(b"<svg onload=alert(1)>"), None);
        assert_eq!(jpeg_of(b"\x89PNG\r\n\x1a\nnot really"), None);
    }

    #[test]
    fn command_path_writes_a_0600_file() {
        let dir = scratch("write");
        let path = write_for_command_path(&dir, "session-1", b"jpeg").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"jpeg");
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
        assert!(path.starts_with(dir.join("computer-use/shots/session-1")));

        forget(&dir, "session-1");
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_session_id_that_is_not_a_folder_name_writes_nothing() {
        let dir = scratch("names");
        assert!(write_for_command_path(&dir, "../outside", b"x").is_err());
        assert!(write_for_command_path(&dir, "", b"x").is_err());
        assert!(!dir.exists());
    }
}
