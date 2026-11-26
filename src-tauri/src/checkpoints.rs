//! Lightweight per-turn snapshots of non-ignored repository files using a temporary
//! git index (`GIT_INDEX_FILE`), leaving the user's real index, HEAD, and stash untouched.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::changes::{is_inside, remove_worktree_file, run_git, toplevel_of};
use crate::files::ensure_known_workspace;
use crate::git_info::git_binary;
use crate::store::AppStore;

static NEXT_INDEX_ID: AtomicU64 = AtomicU64::new(0);
const PATH_CHUNK_SIZE: usize = 200;

/// RAII guard for a temporary git index file stored outside the repository.
struct TempIndex(PathBuf);

impl TempIndex {
    fn new() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let id = NEXT_INDEX_ID.fetch_add(1, Ordering::Relaxed);
        let name = format!("zorvo-checkpoint-{}-{}-{id}.idx", std::process::id(), nanos);
        Self(std::env::temp_dir().join(name))
    }
}

impl Drop for TempIndex {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn is_valid_tree_sha(sha: &str) -> bool {
    (40..=64).contains(&sha.len()) && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn git_with_index(git: &Path, dir: &Path, index: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = crate::spawn::command(git);
    command
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(dir)
        .env("GIT_INDEX_FILE", index)
        .args(args);
    let output = command
        .output()
        .map_err(|e| format!("Could not run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn snapshot_tree(git: &Path, toplevel: &Path) -> Result<String, String> {
    let real_index_raw = run_git(git, toplevel, &["rev-parse", "--git-path", "index"])?;
    let real_index_rel = Path::new(real_index_raw.trim());
    let real_index = if real_index_rel.is_absolute() {
        real_index_rel.to_path_buf()
    } else {
        toplevel.join(real_index_rel)
    };

    let temp = TempIndex::new();
    if real_index.exists() {
        let _ = fs::copy(&real_index, &temp.0);
    }
    git_with_index(git, toplevel, &temp.0, &["add", "-A"])?;
    let tree = git_with_index(git, toplevel, &temp.0, &["write-tree"])?;
    Ok(tree.trim().to_string())
}

/// Captures a git tree SHA representing every non-ignored file in `dir`'s repository,
/// or `Ok(None)` when `dir` is not inside a git repository.
pub fn create_checkpoint(git: &Path, dir: &Path) -> Result<Option<String>, String> {
    let Ok(toplevel) = toplevel_of(git, dir) else {
        return Ok(None);
    };
    snapshot_tree(git, &toplevel).map(Some)
}

/// Restores all non-ignored files in `dir`'s repository to `tree_sha`, returning the
/// number of paths removed or restored while leaving gitignored files untouched.
pub fn restore_checkpoint(git: &Path, dir: &Path, tree_sha: &str) -> Result<usize, String> {
    if !is_valid_tree_sha(tree_sha) {
        return Err("Invalid checkpoint identifier".to_string());
    }
    let toplevel = toplevel_of(git, dir)?;
    let kind = run_git(git, &toplevel, &["cat-file", "-t", tree_sha])
        .map_err(|_| "That checkpoint is no longer available in this repository".to_string())?;
    if kind.trim() != "tree" {
        return Err("That checkpoint is no longer available in this repository".to_string());
    }

    let current_tree = snapshot_tree(git, &toplevel)?;
    if current_tree == tree_sha {
        return Ok(0);
    }

    let diff = run_git(
        git,
        &toplevel,
        &[
            "diff-tree",
            "-r",
            "--no-renames",
            "--name-status",
            "-z",
            tree_sha,
            &current_tree,
        ],
    )?;

    let mut to_remove: Vec<&str> = Vec::new();
    let mut to_restore: Vec<&str> = Vec::new();
    let mut tokens = diff.split('\0').filter(|entry| !entry.is_empty());
    while let Some(status) = tokens.next() {
        let Some(path) = tokens.next() else {
            break;
        };
        if !is_inside(path) {
            return Err(format!("{path} is not a file in this repository"));
        }
        if status.starts_with('A') {
            to_remove.push(path);
        } else {
            to_restore.push(path);
        }
    }

    for path in &to_remove {
        remove_worktree_file(&toplevel, path)?;
    }

    if !to_restore.is_empty() {
        let restore_idx = TempIndex::new();
        git_with_index(git, &toplevel, &restore_idx.0, &["read-tree", tree_sha])?;
        for chunk in to_restore.chunks(PATH_CHUNK_SIZE) {
            let mut args = vec!["checkout-index", "-f", "--"];
            args.extend_from_slice(chunk);
            git_with_index(git, &toplevel, &restore_idx.0, &args)?;
        }
    }

    let mut all_changed: Vec<&str> = Vec::with_capacity(to_remove.len() + to_restore.len());
    all_changed.extend_from_slice(&to_remove);
    all_changed.extend_from_slice(&to_restore);
    if !all_changed.is_empty() {
        let has_head = run_git(
            git,
            &toplevel,
            &["rev-parse", "--verify", "--quiet", "HEAD"],
        )
        .is_ok();
        for chunk in all_changed.chunks(PATH_CHUNK_SIZE) {
            if has_head {
                let mut args = vec!["reset", "-q", "HEAD", "--"];
                args.extend_from_slice(chunk);
                let _ = run_git(git, &toplevel, &args);
            } else {
                let mut args = vec!["rm", "--cached", "-q", "--ignore-unmatch", "--"];
                args.extend_from_slice(chunk);
                let _ = run_git(git, &toplevel, &args);
            }
        }
    }

    Ok(to_remove.len() + to_restore.len())
}

/// Captures a per-turn snapshot of non-ignored repository files for optional rewind restore.
#[tauri::command(async)]
pub fn create_turn_checkpoint(
    store: State<'_, AppStore>,
    path: String,
) -> Result<Option<String>, String> {
    ensure_known_workspace(&path, |p| store.is_known_workspace(p))?;
    create_checkpoint(&git_binary(), Path::new(&path))
}

/// Restores repository files to a captured turn checkpoint, returning how many paths changed.
#[tauri::command(async)]
pub fn restore_turn_checkpoint(
    store: State<'_, AppStore>,
    path: String,
    checkpoint: String,
) -> Result<usize, String> {
    ensure_known_workspace(&path, |p| store.is_known_workspace(p))?;
    restore_checkpoint(&git_binary(), Path::new(&path), &checkpoint)
}
