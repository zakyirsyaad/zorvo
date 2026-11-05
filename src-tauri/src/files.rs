//! Read-only browsing of a workspace folder for the Files panel.
//!
//! The webview sends a workspace root plus a path relative to it. The root must
//! be one of the user's workspaces as the app state records them, and every
//! path is canonicalized and must stay inside the canonical root, so `..`
//! segments and symlinks pointing elsewhere cannot list or open files outside
//! the workspace.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::store::AppStore;

#[cfg(target_os = "macos")]
use std::process::Command;

/// Most entries returned for one directory, after sorting.
pub const MAX_ENTRIES: usize = 2000;

/// The largest file the viewer reads; a larger one is refused from its size, before it is read.
pub const MAX_VIEW_BYTES: u64 = 1_048_576;

/// How much of a file's start is searched for a NUL byte to tell it is binary.
pub const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// A workspace file as the read-only viewer gets it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileContent {
    /// UTF-8 text, exactly as it is on disk (line endings included).
    Text { text: String, size: u64 },
    /// A NUL near the start, or bytes that are not UTF-8: shown as a message, never decoded lossily.
    Binary { size: u64 },
    /// Over `MAX_VIEW_BYTES`; not read at all.
    TooLarge { size: u64, limit: u64 },
}

/// Reads `relative` inside `root` for the viewer. Only a regular file is read: a folder, a named
/// pipe or a socket is refused from its metadata, since opening a pipe with no writer would block.
pub fn read_view_file(root: &str, relative: &str) -> Result<FileContent, String> {
    let (_, target) = resolve_inside_root(root, relative)?;
    let metadata =
        std::fs::metadata(&target).map_err(|e| format!("Cannot read {relative:?}: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("{relative:?} is not a file"));
    }
    let size = metadata.len();
    if size > MAX_VIEW_BYTES {
        return Ok(FileContent::TooLarge {
            size,
            limit: MAX_VIEW_BYTES,
        });
    }
    let bytes = std::fs::read(&target).map_err(|e| format!("Cannot read {relative:?}: {e}"))?;
    let size = bytes.len() as u64;
    if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return Ok(FileContent::Binary { size });
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(FileContent::Text { text, size }),
        Err(_) => Ok(FileContent::Binary { size }),
    }
}

/// One child of a listed directory, as the Files panel shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    /// Path from the workspace root, `/`-separated, without a leading slash.
    pub relative_path: String,
    pub is_dir: bool,
}

/// Canonicalizes `root`, which must be an absolute path to an existing directory.
pub fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(root);
    if !candidate.is_absolute() {
        return Err(format!("Workspace root {root:?} is not absolute"));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("Workspace root {root:?} is not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("Workspace root {root:?} is not a directory"));
    }
    Ok(canonical)
}

/// Resolves `relative` under `root` and returns `(canonical_root, canonical_target)`.
///
/// Canonicalizing the target resolves `..` and every symlink along the way, so
/// the containment check below sees where the path really points.
pub fn resolve_inside_root(root: &str, relative: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = canonical_root(root)?;
    let target = root
        .join(relative)
        .canonicalize()
        .map_err(|e| format!("Path {relative:?} is not accessible: {e}"))?;
    if !target.starts_with(&root) {
        return Err(format!("Path {relative:?} is outside the workspace"));
    }
    Ok((root, target))
}

/// Lists one directory of the workspace: folders first, then files, by name.
pub fn list_entries(root: &str, relative: &str) -> Result<Vec<DirEntryInfo>, String> {
    let (root, dir) = resolve_inside_root(root, relative)?;
    if !dir.is_dir() {
        return Err(format!("Path {relative:?} is not a directory"));
    }
    let read_dir = std::fs::read_dir(&dir).map_err(|e| format!("Cannot read {relative:?}: {e}"))?;

    let mut entries: Vec<DirEntryInfo> = read_dir
        .filter_map(Result::ok)
        .map(|entry| describe_entry(&root, &dir, &entry))
        .collect();
    entries.sort_by(compare_entries);
    entries.truncate(MAX_ENTRIES);
    Ok(entries)
}

fn describe_entry(root: &Path, dir: &Path, entry: &std::fs::DirEntry) -> DirEntryInfo {
    let name = entry.file_name().to_string_lossy().into_owned();
    // `Path::is_dir` follows symlinks, so a linked folder still gets a chevron;
    // expanding one that points outside the root is rejected by the listing.
    let is_dir = entry.path().is_dir();
    let relative_dir = dir.strip_prefix(root).unwrap_or(Path::new(""));
    DirEntryInfo {
        relative_path: to_slash_path(&relative_dir.join(&name)),
        name,
        is_dir,
    }
}

fn to_slash_path(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn compare_entries(a: &DirEntryInfo, b: &DirEntryInfo) -> std::cmp::Ordering {
    b.is_dir
        .cmp(&a.is_dir)
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.name.cmp(&b.name))
}

/// Accepts `root` only when it is one of the user's workspaces (compared
/// canonically), so a caller cannot widen the browsable area to any folder.
pub fn ensure_known_workspace(
    root: &str,
    is_known: impl FnOnce(&Path) -> Result<bool, String>,
) -> Result<(), String> {
    let root = canonical_root(root)?;
    if is_known(&root)? {
        Ok(())
    } else {
        Err(format!("{} is not one of your workspaces", root.display()))
    }
}

/// Records a folder the user just opened as a workspace. Synchronous on
/// purpose: it runs before any async listing the webview sends after it.
#[tauri::command]
pub fn remember_workspace(store: State<'_, AppStore>, path: String) -> Result<(), String> {
    store.remember_workspace(&path)
}

/// Lists the children of `relative` inside the workspace `root`.
#[tauri::command(async)]
pub fn list_directory(
    store: State<'_, AppStore>,
    root: String,
    relative: String,
) -> Result<Vec<DirEntryInfo>, String> {
    ensure_known_workspace(&root, |r| store.is_known_workspace(r))?;
    list_entries(&root, &relative)
}

/// Reads a workspace file for the read-only viewer. The webview sends a workspace and a path
/// relative to it, never an absolute path of its own choosing.
#[tauri::command(async)]
pub fn read_workspace_file(
    store: State<'_, AppStore>,
    root: String,
    relative: String,
) -> Result<FileContent, String> {
    ensure_known_workspace(&root, |r| store.is_known_workspace(r))?;
    read_view_file(&root, &relative)
}

/// Opens a workspace file with its default application.
#[tauri::command(async)]
pub fn open_path(store: State<'_, AppStore>, root: String, relative: String) -> Result<(), String> {
    ensure_known_workspace(&root, |r| store.is_known_workspace(r))?;
    let (_, target) = resolve_inside_root(&root, &relative)?;
    open_with_default_app(&target)
}

#[cfg(target_os = "macos")]
fn open_with_default_app(path: &Path) -> Result<(), String> {
    let status = Command::new("open")
        .arg(path)
        .status()
        .map_err(|e| format!("Failed to run `open {}`: {}", path.display(), e))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("`open {}` exited with {status}", path.display()))
    }
}

#[cfg(not(target_os = "macos"))]
fn open_with_default_app(_path: &Path) -> Result<(), String> {
    Err("not supported".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A temp workspace removed when the test ends, even on panic.
    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "zorvo-files-{}-{}-{}",
                tag,
                std::process::id(),
                nanos
            ));
            fs::create_dir_all(&path).expect("create temp workspace");
            Self { path }
        }

        fn root(&self) -> &str {
            self.path.to_str().expect("utf-8 temp path")
        }

        fn mkdir(&self, relative: &str) {
            fs::create_dir_all(self.path.join(relative)).expect("create dir");
        }

        fn touch(&self, relative: &str) {
            fs::write(self.path.join(relative), b"").expect("create file");
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn names(entries: &[DirEntryInfo]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_folders_first_then_files_alphabetically_including_hidden_entries() {
        let ws = TempWorkspace::new("order");
        ws.mkdir("src");
        ws.mkdir(".claude");
        ws.mkdir("Docs");
        ws.touch("zeta.txt");
        ws.touch("README.md");
        ws.touch(".gitignore");
        ws.touch("alpha.rs");

        let entries = list_entries(ws.root(), "").expect("list root");

        assert_eq!(
            names(&entries),
            vec![
                ".claude",
                "Docs",
                "src",
                ".gitignore",
                "alpha.rs",
                "README.md",
                "zeta.txt"
            ]
        );
        assert!(entries[..3].iter().all(|e| e.is_dir));
        assert!(entries[3..].iter().all(|e| !e.is_dir));
    }

    #[test]
    fn reports_paths_relative_to_the_root_for_nested_folders() {
        let ws = TempWorkspace::new("nested");
        ws.mkdir("src/components");
        ws.touch("src/main.ts");

        let entries = list_entries(ws.root(), "src").expect("list src");

        assert_eq!(
            entries,
            vec![
                DirEntryInfo {
                    name: "components".to_string(),
                    relative_path: "src/components".to_string(),
                    is_dir: true,
                },
                DirEntryInfo {
                    name: "main.ts".to_string(),
                    relative_path: "src/main.ts".to_string(),
                    is_dir: false,
                },
            ]
        );
    }

    #[test]
    fn caps_a_directory_at_max_entries_after_sorting() {
        let ws = TempWorkspace::new("cap");
        for index in 0..=MAX_ENTRIES {
            ws.touch(&format!("file-{index:05}.txt"));
        }
        ws.mkdir("zz-folder");

        let entries = list_entries(ws.root(), "").expect("list root");

        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].name, "zz-folder", "folders sort before the cap");
    }

    #[test]
    fn rejects_a_relative_path_that_climbs_out_of_the_root() {
        let ws = TempWorkspace::new("dotdot");
        ws.mkdir("inner");

        let err = list_entries(&format!("{}/inner", ws.root()), "..").expect_err("must reject");

        assert!(err.contains("outside"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_an_absolute_relative_path_outside_the_root() {
        let ws = TempWorkspace::new("absolute");

        assert!(list_entries(ws.root(), "/").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_points_outside_the_root() {
        let ws = TempWorkspace::new("symlink");
        let outside = TempWorkspace::new("symlink-target");
        outside.touch("secret.txt");
        std::os::unix::fs::symlink(&outside.path, ws.path.join("escape")).expect("create symlink");

        let err = list_entries(ws.root(), "escape").expect_err("must reject");
        assert!(err.contains("outside"), "unexpected error: {err}");

        let err = resolve_inside_root(ws.root(), "escape/secret.txt").expect_err("must reject");
        assert!(err.contains("outside"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_missing_root() {
        let ws = TempWorkspace::new("missing");
        let missing = ws.path.join("no-such-folder");

        assert!(list_entries(missing.to_str().expect("utf-8"), "").is_err());
    }

    #[test]
    fn accepts_only_a_root_that_is_a_known_workspace() {
        let ws = TempWorkspace::new("known");
        ws.mkdir("inner");
        let known = canonical_root(ws.root()).expect("canonical root");
        let is_known = |r: &Path| Ok(r == known);

        assert!(ensure_known_workspace(ws.root(), is_known).is_ok());
        // Another spelling of the same folder is the same workspace.
        assert!(ensure_known_workspace(&format!("{}/inner/..", ws.root()), is_known).is_ok());
        let err = ensure_known_workspace("/", is_known).expect_err("must reject");
        assert!(
            err.contains("not one of your workspaces"),
            "unexpected error: {err}"
        );
        assert!(ensure_known_workspace(&format!("{}/inner", ws.root()), is_known).is_err());
    }

    #[test]
    fn rejects_a_relative_root() {
        assert!(canonical_root("relative/folder").is_err());
        assert!(canonical_root("").is_err());
    }

    #[test]
    fn rejects_a_root_that_is_a_file() {
        let ws = TempWorkspace::new("file-root");
        ws.touch("file.txt");

        assert!(canonical_root(ws.path.join("file.txt").to_str().expect("utf-8")).is_err());
    }

    #[test]
    fn resolves_a_file_inside_the_root() {
        let ws = TempWorkspace::new("resolve");
        ws.mkdir("src");
        ws.touch("src/lib.rs");

        let (root, target) = resolve_inside_root(ws.root(), "src/lib.rs").expect("inside root");

        assert_eq!(target, root.join("src").join("lib.rs"));
    }

    #[test]
    fn serializes_entries_in_camel_case() {
        let entry = DirEntryInfo {
            name: "a".to_string(),
            relative_path: "dir/a".to_string(),
            is_dir: false,
        };

        let json = serde_json::to_value(&entry).expect("serialize");

        assert_eq!(
            json,
            serde_json::json!({ "name": "a", "relativePath": "dir/a", "isDir": false })
        );
    }

    #[test]
    fn reads_a_text_file_with_its_size() {
        let ws = TempWorkspace::new("view-text");
        fs::write(ws.path.join("a.txt"), "a\r\nb\n").expect("write");

        let content = read_view_file(ws.root(), "a.txt").expect("read");

        assert_eq!(
            content,
            FileContent::Text {
                text: "a\r\nb\n".to_string(),
                size: 5
            }
        );
    }

    #[test]
    fn calls_a_file_with_a_nul_binary() {
        let ws = TempWorkspace::new("view-nul");
        fs::write(ws.path.join("img.png"), b"PNG\0data").expect("write");

        assert_eq!(
            read_view_file(ws.root(), "img.png").expect("read"),
            FileContent::Binary { size: 8 }
        );
    }

    #[test]
    fn calls_invalid_utf8_binary() {
        let ws = TempWorkspace::new("view-utf8");
        fs::write(ws.path.join("latin1.txt"), [0xff, 0xfe, 0x41]).expect("write");

        assert_eq!(
            read_view_file(ws.root(), "latin1.txt").expect("read"),
            FileContent::Binary { size: 3 }
        );
    }

    #[test]
    fn refuses_a_file_over_the_cap_without_reading_it() {
        let ws = TempWorkspace::new("view-large");
        let file = fs::File::create(ws.path.join("big.log")).expect("create");
        file.set_len(MAX_VIEW_BYTES + 1).expect("grow sparse file");

        assert_eq!(
            read_view_file(ws.root(), "big.log").expect("read"),
            FileContent::TooLarge {
                size: MAX_VIEW_BYTES + 1,
                limit: MAX_VIEW_BYTES
            }
        );
    }

    #[test]
    fn refuses_a_folder() {
        let ws = TempWorkspace::new("view-dir");
        ws.mkdir("src");

        let err = read_view_file(ws.root(), "src").expect_err("must reject");
        assert!(err.contains("is not a file"), "unexpected error: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_named_pipe_without_opening_it() {
        let ws = TempWorkspace::new("view-pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(ws.path.join("pipe"))
            .status()
            .expect("run mkfifo");
        assert!(status.success(), "mkfifo failed");

        // Opening a pipe with no writer blocks, so returning at all shows it was not opened.
        let err = read_view_file(ws.root(), "pipe").expect_err("must reject");
        assert!(err.contains("is not a file"), "unexpected error: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_path_outside_the_workspace() {
        let ws = TempWorkspace::new("view-outside");
        ws.mkdir("inner");
        let outside = TempWorkspace::new("view-outside-target");
        fs::write(outside.path.join("secret.txt"), "secret").expect("write");
        std::os::unix::fs::symlink(outside.path.join("secret.txt"), ws.path.join("link.txt"))
            .expect("create symlink");

        let err = read_view_file(ws.root(), "link.txt").expect_err("must reject the symlink");
        assert!(err.contains("outside"), "unexpected error: {err}");

        let inner = format!("{}/inner", ws.root());
        fs::write(ws.path.join("sibling.txt"), "x").expect("write");
        let err = read_view_file(&inner, "../sibling.txt").expect_err("must reject ..");
        assert!(err.contains("outside"), "unexpected error: {err}");
    }

    #[test]
    fn serializes_file_content_tagged_by_kind_in_camel_case() {
        let json =
            serde_json::to_value(FileContent::TooLarge { size: 2, limit: 1 }).expect("serialize");

        assert_eq!(
            json,
            serde_json::json!({ "kind": "tooLarge", "size": 2, "limit": 1 })
        );
    }
}
