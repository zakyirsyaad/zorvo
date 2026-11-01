//! Points a worktree session's attachments into its worktree.
//!
//! The composer attaches absolute paths, so a file picked from the Files panel
//! names the main folder even when the agent runs in a worktree of it, and an
//! agent that edits that path changes the main checkout. [`worktree_attachment_paths`]
//! swaps the main folder's prefix for the worktree's. A file outside the main
//! folder, or one the worktree does not have (an untracked or ignored file),
//! keeps its path.

use std::path::{Path, PathBuf};

use tauri::State;

use crate::files::{canonical_root, ensure_known_workspace};
use crate::store::AppStore;

/// `path` inside `cwd` when it lies in `repo` and the worktree has that file,
/// else None. Compares path components, so `/w/repo-two/a` is not in `/w/repo`.
fn re_root(repo: &Path, cwd: &Path, path: &Path) -> Option<PathBuf> {
    let relative = path.strip_prefix(repo).ok()?;
    let in_worktree = cwd.join(relative);
    in_worktree.exists().then_some(in_worktree)
}

/// One attachment: a path that resolves is compared canonically (so `..` and
/// symlinks cannot slip a file into or out of the folder). Only a re-rooted
/// path changes; any other stays exactly as sent, name and spelling included.
fn re_root_one(repo: &Path, cwd: &Path, path: &str) -> String {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return path.to_string();
    }
    candidate
        .canonicalize()
        .ok()
        .and_then(|canonical| re_root(repo, cwd, &canonical))
        .map_or_else(
            || path.to_string(),
            |moved| moved.to_string_lossy().into_owned(),
        )
}

fn re_root_all(
    repo_path: &str,
    cwd: &str,
    paths: &[String],
    is_known: impl Fn(&Path) -> Result<bool, String>,
) -> Result<Vec<String>, String> {
    ensure_known_workspace(repo_path, &is_known)?;
    ensure_known_workspace(cwd, &is_known)?;
    let repo = canonical_root(repo_path)?;
    let cwd = canonical_root(cwd)?;
    Ok(paths
        .iter()
        .map(|path| re_root_one(&repo, &cwd, path))
        .collect())
}

/// `paths` with those inside the workspace `repo_path` pointed at the same file
/// in the worktree folder `cwd`. The UI sends only paths; both folders must be known workspaces.
#[tauri::command(async)]
pub fn worktree_attachment_paths(
    store: State<'_, AppStore>,
    repo_path: String,
    cwd: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    re_root_all(&repo_path, &cwd, &paths, |p| store.is_known_workspace(p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A temp folder removed when the test ends, even on panic.
    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zorvo-attach-{tag}-{}-{nanos}", std::process::id()));
            fs::create_dir_all(&path).expect("create temp folder");
            Self(path.canonicalize().expect("canonical temp folder"))
        }

        fn file(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().expect("parent")).expect("create dirs");
            fs::write(&path, "x").expect("write file");
            path
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn re_roots_a_file_inside_the_repository() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let in_repo = repo.file("src/a.txt");
        let in_tree = tree.file("src/a.txt");

        assert_eq!(re_root(&repo.0, &tree.0, &in_repo), Some(in_tree));
    }

    #[test]
    fn leaves_a_file_outside_the_repository() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let elsewhere = Temp::new("else");
        let outside = elsewhere.file("a.txt");
        tree.file("a.txt");

        assert_eq!(re_root(&repo.0, &tree.0, &outside), None);
    }

    #[test]
    fn leaves_a_file_the_worktree_does_not_have() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let untracked = repo.file("notes.txt");

        assert_eq!(re_root(&repo.0, &tree.0, &untracked), None);
    }

    #[test]
    fn re_roots_from_a_subfolder_workspace() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let workspace = repo.0.join("web");
        let in_repo = repo.file("web/src/a.txt");
        let tree_cwd = tree.0.join("web");
        let in_tree = tree.file("web/src/a.txt");

        assert_eq!(re_root(&workspace, &tree_cwd, &in_repo), Some(in_tree));
    }

    #[test]
    fn does_not_treat_a_sibling_folder_as_inside() {
        let base = Temp::new("base");
        let tree = Temp::new("tree");
        let repo = base.0.join("repo");
        let sibling = base.file("repo-two/a");
        // A string-prefix check would read the sibling as `repo` + `-two/a`.
        tree.file("-two/a");
        tree.file("a");

        assert_eq!(re_root(&repo, &tree.0, &sibling), None);
    }

    #[test]
    fn keeps_a_symlink_outside_the_repository_as_sent() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let elsewhere = Temp::new("else");
        let target = elsewhere.file("build-123.bin");
        let link = elsewhere.0.join("latest.bin");
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");
        let sent = link.to_string_lossy().into_owned();

        assert_eq!(re_root_one(&repo.0, &tree.0, &sent), sent);
    }

    #[test]
    fn keeps_a_non_canonical_untracked_file_in_the_repository_as_sent() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        repo.file("notes.txt");
        fs::create_dir_all(repo.0.join("sub")).expect("create dir");
        let sent = repo
            .0
            .join("sub/../notes.txt")
            .to_string_lossy()
            .into_owned();

        assert_eq!(re_root_one(&repo.0, &tree.0, &sent), sent);
    }

    #[test]
    fn refuses_an_unknown_folder() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let file = repo.file("a.txt");
        let known = repo.0.clone();
        let paths = vec![file.to_string_lossy().into_owned()];

        let result = re_root_all(
            repo.0.to_str().unwrap(),
            tree.0.to_str().unwrap(),
            &paths,
            |p| Ok(p == known),
        );

        assert!(result
            .unwrap_err()
            .contains("is not one of your workspaces"));
    }

    #[test]
    fn re_roots_every_path_of_a_known_pair() {
        let repo = Temp::new("repo");
        let tree = Temp::new("tree");
        let inside = repo.file("a.txt");
        let in_tree = tree.file("a.txt");
        let outside = "/nowhere/else.txt".to_string();
        let paths = vec![inside.to_string_lossy().into_owned(), outside.clone()];
        let (a, b) = (repo.0.clone(), tree.0.clone());

        let result = re_root_all(
            repo.0.to_str().unwrap(),
            tree.0.to_str().unwrap(),
            &paths,
            |p| Ok(p == a || p == b),
        )
        .expect("known folders");

        assert_eq!(
            result,
            vec![in_tree.to_string_lossy().into_owned(), outside]
        );
    }
}
