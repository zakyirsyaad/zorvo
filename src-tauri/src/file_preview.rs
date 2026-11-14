//! The bytes of an image or a PDF the Files viewer shows.
//!
//! `files::read_workspace_file` says a file is previewable (from its header, never its name);
//! this command then returns the bytes, raw over IPC, so the webview can show them from a Blob
//! URL (an image) or hand them to the bundled PDF renderer. The webview never loads the file
//! itself, so the asset protocol's scope stays as it is. The same path rules as every other
//! workspace read apply: a known workspace, a path that stays inside it, a regular file.

use std::io::Read;
use std::path::Path;

use tauri::ipc::Response;
use tauri::State;

use crate::attachments::{sniff_viewable, HEADER_BYTES, MAX_PREVIEW_BYTES};
use crate::files::{ensure_known_workspace, resolve_inside_root};
use crate::store::AppStore;

/// The previewable type of the file at `path` from its first bytes, or None for any other file.
pub fn viewable_type(path: &Path) -> Result<Option<&'static str>, String> {
    let mut header = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(HEADER_BYTES).read_to_end(&mut header))
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Ok(sniff_viewable(&header))
}

/// The bytes of `relative` inside `root`, when it is an image or a PDF no larger than
/// [`MAX_PREVIEW_BYTES`]. A folder, a pipe or a socket is refused from its metadata, since opening
/// a pipe with no writer would block.
pub fn read_preview_bytes(root: &str, relative: &str) -> Result<Vec<u8>, String> {
    let (_, target) = resolve_inside_root(root, relative)?;
    let metadata =
        std::fs::metadata(&target).map_err(|e| format!("Cannot read {relative:?}: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("{relative:?} is not a file"));
    }
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err(format!("{relative:?} is too large to preview"));
    }
    if viewable_type(&target)?.is_none() {
        return Err(format!("{relative:?} is not an image or a PDF"));
    }
    // One byte past the cap: a file that grew since the metadata was read is still bounded.
    let mut bytes = Vec::new();
    std::fs::File::open(&target)
        .and_then(|file| file.take(MAX_PREVIEW_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("Cannot read {relative:?}: {e}"))?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Err(format!("{relative:?} is too large to preview"));
    }
    Ok(bytes)
}

/// Returns an image's or a PDF's bytes for the viewer. The webview sends a workspace and a path
/// relative to it, never an absolute path of its own choosing.
#[tauri::command(async)]
pub fn read_workspace_preview(
    store: State<'_, AppStore>,
    root: String,
    relative: String,
) -> Result<Response, String> {
    ensure_known_workspace(&root, |r| store.is_known_workspace(r))?;
    read_preview_bytes(&root, &relative).map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Dir(PathBuf);

    impl Dir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "zorvo-preview-{tag}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create dir");
            Self(path)
        }

        fn root(&self) -> &str {
            self.0.to_str().expect("utf-8 path")
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn returns_the_bytes_of_an_image_and_of_a_pdf() {
        let dir = Dir::new("ok");
        fs::write(dir.0.join("a.png"), PNG).expect("write");
        fs::write(dir.0.join("b.pdf"), b"%PDF-1.7\n1 0 obj").expect("write");

        assert_eq!(read_preview_bytes(dir.root(), "a.png").expect("png"), PNG);
        assert_eq!(
            read_preview_bytes(dir.root(), "b.pdf").expect("pdf"),
            b"%PDF-1.7\n1 0 obj"
        );
    }

    #[test]
    fn sniffs_the_header_whatever_the_name() {
        let dir = Dir::new("name");
        fs::write(dir.0.join("doc.bin"), b"%PDF-1.7\n").expect("write");
        fs::write(dir.0.join("fake.png"), b"not an image").expect("write");

        assert!(read_preview_bytes(dir.root(), "doc.bin").is_ok());
        let error = read_preview_bytes(dir.root(), "fake.png").expect_err("not an image");
        assert!(error.contains("not an image or a PDF"), "{error}");
    }

    #[test]
    fn refuses_other_binaries_and_svg() {
        let dir = Dir::new("other");
        fs::write(dir.0.join("a.zip"), b"PK\x03\x04\0\0").expect("write");
        fs::write(dir.0.join("a.svg"), b"<svg xmlns=\"x\"/>").expect("write");

        assert!(read_preview_bytes(dir.root(), "a.zip").is_err());
        assert!(read_preview_bytes(dir.root(), "a.svg").is_err());
    }

    #[test]
    fn refuses_a_file_over_the_cap_from_its_size() {
        let dir = Dir::new("cap");
        let mut file = fs::File::create(dir.0.join("big.pdf")).expect("create");
        std::io::Write::write_all(&mut file, b"%PDF-1.7\n").expect("header");
        file.set_len(MAX_PREVIEW_BYTES + 1).expect("sparse");

        let error = read_preview_bytes(dir.root(), "big.pdf").expect_err("too large");
        assert!(error.contains("too large to preview"), "{error}");
    }

    #[test]
    fn accepts_a_file_exactly_at_the_cap() {
        let dir = Dir::new("at-cap");
        let mut file = fs::File::create(dir.0.join("edge.pdf")).expect("create");
        std::io::Write::write_all(&mut file, b"%PDF-1.7\n").expect("header");
        file.set_len(MAX_PREVIEW_BYTES).expect("sparse");

        let bytes = read_preview_bytes(dir.root(), "edge.pdf").expect("at the cap");
        assert_eq!(bytes.len() as u64, MAX_PREVIEW_BYTES);
    }

    #[test]
    fn refuses_a_folder_and_a_missing_file() {
        let dir = Dir::new("kinds");
        fs::create_dir(dir.0.join("sub")).expect("mkdir");

        let error = read_preview_bytes(dir.root(), "sub").expect_err("a folder");
        assert!(error.contains("is not a file"), "{error}");
        assert!(read_preview_bytes(dir.root(), "gone.png").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_named_pipe_without_opening_it() {
        let dir = Dir::new("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(dir.0.join("pipe.png"))
            .status()
            .expect("mkfifo");
        assert!(status.success());

        // Opening a pipe with no writer blocks, so returning at all shows it was not opened.
        let error = read_preview_bytes(dir.root(), "pipe.png").expect_err("a pipe");
        assert!(error.contains("is not a file"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_path_that_leaves_the_workspace() {
        let dir = Dir::new("outside");
        let outside = Dir::new("outside-target");
        fs::write(outside.0.join("secret.png"), PNG).expect("write");
        std::os::unix::fs::symlink(outside.0.join("secret.png"), dir.0.join("link.png"))
            .expect("symlink");
        fs::create_dir(dir.0.join("inner")).expect("mkdir");
        fs::write(dir.0.join("sibling.png"), PNG).expect("write");

        let error = read_preview_bytes(dir.root(), "link.png").expect_err("symlink out");
        assert!(error.contains("outside"), "{error}");
        let inner = format!("{}/inner", dir.root());
        let error = read_preview_bytes(&inner, "../sibling.png").expect_err("..");
        assert!(error.contains("outside"), "{error}");
    }
}
