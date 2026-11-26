//! Lightweight per-turn snapshots of non-ignored repository files using a temporary
//! git index (`GIT_INDEX_FILE`). Taking one leaves the user's real index, HEAD and stash
//! untouched; restoring one touches only the files the caller names (the files the agent
//! reported changing), and changes the real index only for a file it deletes that HEAD lacks.

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::changes::{is_inside, remove_worktree_file, run_git, toplevel_of};
use crate::files::ensure_known_workspace;
use crate::git_info::git_binary;
use crate::store::AppStore;

static NEXT_INDEX_ID: AtomicU64 = AtomicU64::new(0);
const PATH_CHUNK_SIZE: usize = 200;
/// How long a checkpoint may take before a turn: past it, the turn goes ahead without one.
pub const CHECKPOINT_BUDGET: Duration = Duration::from_secs(4);
/// How long the snapshot a restore compares against may take.
const RESTORE_BUDGET: Duration = Duration::from_secs(60);
/// Untracked files larger than this are left out of every snapshot, so a turn never hashes
/// large media into the object store; they are never restored or deleted either.
pub const MAX_UNTRACKED_BYTES: u64 = 5 * 1024 * 1024;
/// At most this many untracked files are snapshotted (the first ones by path).
pub const MAX_UNTRACKED_FILES: usize = 5000;
/// At most this many paths one restore takes.
pub const MAX_RESTORE_PATHS: usize = 2000;
const GITLINK_MODE: &str = "160000";

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

/// Runs git with `index` as its index, killed when `deadline` passes. Its output is read on a
/// thread of its own, so a long listing never fills the pipe and stalls git.
fn git_with_index(
    git: &Path,
    dir: &Path,
    index: &Path,
    args: &[&str],
    deadline: Instant,
) -> Result<String, String> {
    let mut command = crate::spawn::command(git);
    command
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(dir)
        .env("GIT_INDEX_FILE", index)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not run git: {e}"))?;
    let read_all = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.read_to_end(&mut bytes);
            bytes
        })
    };
    let stdout = child.stdout.take().map(|pipe| read_all(Box::new(pipe)));
    let stderr = child.stderr.take().map(|pipe| read_all(Box::new(pipe)));
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The snapshot took too long".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(e) => return Err(format!("Could not run git: {e}")),
        }
    };
    let out = stdout.and_then(|t| t.join().ok()).unwrap_or_default();
    let err = stderr.and_then(|t| t.join().ok()).unwrap_or_default();
    if status.success() {
        Ok(String::from_utf8_lossy(&out).into_owned())
    } else {
        Err(String::from_utf8_lossy(&err).trim().to_string())
    }
}

/// The untracked, non-ignored files a snapshot takes: regular files and links up to
/// `MAX_UNTRACKED_BYTES`, at most `MAX_UNTRACKED_FILES` of them by path. Nested repositories
/// (listed as folders) are left out.
fn untracked_to_snapshot(
    git: &Path,
    toplevel: &Path,
    index: &Path,
    deadline: Instant,
) -> Result<Vec<String>, String> {
    let listed = git_with_index(
        git,
        toplevel,
        index,
        &["ls-files", "-z", "--others", "--exclude-standard"],
        deadline,
    )?;
    let mut paths: Vec<String> = listed
        .split('\0')
        .filter(|path| !path.is_empty() && !path.ends_with('/') && is_inside(path))
        .filter(|path| {
            fs::symlink_metadata(toplevel.join(path)).is_ok_and(|meta| {
                (meta.is_file() && meta.len() <= MAX_UNTRACKED_BYTES)
                    || meta.file_type().is_symlink()
            })
        })
        .map(str::to_string)
        .collect();
    paths.sort();
    paths.truncate(MAX_UNTRACKED_FILES);
    Ok(paths)
}

fn snapshot_tree(git: &Path, toplevel: &Path, budget: Duration) -> Result<String, String> {
    let deadline = Instant::now() + budget;
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
    // Tracked files as they are now (changed and deleted ones included), then the untracked
    // files the limits allow. Never `add -A`, which would hash every untracked file.
    git_with_index(git, toplevel, &temp.0, &["add", "-u"], deadline)?;
    let untracked = untracked_to_snapshot(git, toplevel, &temp.0, deadline)?;
    for chunk in untracked.chunks(PATH_CHUNK_SIZE) {
        let mut args = vec!["add", "--"];
        args.extend(chunk.iter().map(String::as_str));
        git_with_index(git, toplevel, &temp.0, &args, deadline)?;
    }
    let tree = git_with_index(git, toplevel, &temp.0, &["write-tree"], deadline)?;
    Ok(tree.trim().to_string())
}

/// Captures a git tree SHA representing the non-ignored files in `dir`'s repository (within the
/// snapshot's limits), or `Ok(None)` when `dir` is not inside a git repository.
pub fn create_checkpoint(git: &Path, dir: &Path) -> Result<Option<String>, String> {
    create_checkpoint_within(git, dir, CHECKPOINT_BUDGET)
}

/// `create_checkpoint` with another time budget (tests use a tiny one).
pub fn create_checkpoint_within(
    git: &Path,
    dir: &Path,
    budget: Duration,
) -> Result<Option<String>, String> {
    let Ok(toplevel) = toplevel_of(git, dir) else {
        return Ok(None);
    };
    snapshot_tree(git, &toplevel, budget).map(Some)
}

/// A path the caller names, as a path from the repository's root, or `None` when it is outside
/// it. A relative path is taken from `dir`; an absolute one must be under `toplevel` (or under
/// `dir`, which may be a link to a folder under it).
fn repo_path(toplevel: &Path, dir: &Path, path: &str) -> Option<String> {
    let given = Path::new(path);
    let joined = if given.is_absolute() {
        given.to_path_buf()
    } else {
        dir.join(given)
    };
    let mut parts: Vec<String> = Vec::new();
    let relative = joined
        .strip_prefix(toplevel)
        .ok()
        .map(Path::to_path_buf)
        .or_else(|| {
            let canonical_dir = dir.canonicalize().ok()?;
            let canonical_top = toplevel.canonicalize().ok()?;
            let rest = joined.strip_prefix(dir).ok()?;
            canonical_dir
                .join(rest)
                .strip_prefix(&canonical_top)
                .ok()
                .map(Path::to_path_buf)
        })?;
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_str()?.to_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    let joined = parts.join("/");
    is_inside(&joined).then_some(joined)
}

/// One line of `diff-tree --raw -z`: whether the path is a nested repository, its status and path.
struct RawChange<'a> {
    is_gitlink: bool,
    status: &'a str,
    path: &'a str,
}

fn parse_raw(diff: &str) -> Vec<RawChange<'_>> {
    let mut changes = Vec::new();
    let mut tokens = diff.split('\0').filter(|entry| !entry.is_empty());
    while let Some(meta) = tokens.next() {
        let Some(path) = tokens.next() else {
            break;
        };
        // ":<old mode> <new mode> <old sha> <new sha> <status>"
        let fields: Vec<&str> = meta.trim_start_matches(':').split(' ').collect();
        let is_gitlink = fields.iter().take(2).any(|mode| *mode == GITLINK_MODE);
        let status = fields.get(4).copied().unwrap_or("");
        changes.push(RawChange {
            is_gitlink,
            status,
            path,
        });
    }
    changes
}

/// Restores the files `paths` names (relative to `dir`, or absolute inside the repository) to
/// their content in `tree_sha`: a file the checkpoint lacks is deleted, any other is rewritten.
/// Gitignored files, nested repositories and untracked files over the snapshot's limits are left
/// alone. Every path is tried; when some fail, the error names them after the others are done.
/// Returns how many files were deleted or rewritten.
pub fn restore_checkpoint(
    git: &Path,
    dir: &Path,
    tree_sha: &str,
    paths: &[String],
) -> Result<usize, String> {
    if !is_valid_tree_sha(tree_sha) {
        return Err("Invalid checkpoint identifier".to_string());
    }
    if paths.len() > MAX_RESTORE_PATHS {
        return Err(format!("A restore takes at most {MAX_RESTORE_PATHS} files"));
    }
    let toplevel = toplevel_of(git, dir)?;
    let kind = run_git(git, &toplevel, &["cat-file", "-t", tree_sha])
        .map_err(|_| "That checkpoint is no longer available in this repository".to_string())?;
    if kind.trim() != "tree" {
        return Err("That checkpoint is no longer available in this repository".to_string());
    }
    let wanted: BTreeSet<String> = paths
        .iter()
        .filter_map(|path| repo_path(&toplevel, dir, path))
        .collect();
    if wanted.is_empty() {
        return Ok(0);
    }

    let current_tree = snapshot_tree(git, &toplevel, RESTORE_BUDGET)?;
    if current_tree == tree_sha {
        return Ok(0);
    }

    let wanted: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let mut to_remove: Vec<String> = Vec::new();
    let mut to_restore: Vec<String> = Vec::new();
    for chunk in wanted.chunks(PATH_CHUNK_SIZE) {
        let mut args = vec![
            "diff-tree",
            "-r",
            "--no-renames",
            "--raw",
            "-z",
            tree_sha,
            &current_tree,
            "--",
        ];
        args.extend_from_slice(chunk);
        let diff = run_git(git, &toplevel, &args)?;
        for change in parse_raw(&diff) {
            if change.is_gitlink || !is_inside(change.path) {
                continue;
            }
            if change.status.starts_with('A') {
                to_remove.push(change.path.to_string());
            } else {
                to_restore.push(change.path.to_string());
            }
        }
    }

    let mut failed: Vec<String> = Vec::new();
    let mut done = 0usize;
    let mut removed: Vec<&str> = Vec::new();
    for path in &to_remove {
        match remove_worktree_file(&toplevel, path) {
            Ok(()) => {
                done += 1;
                removed.push(path);
            }
            Err(_) => failed.push(path.clone()),
        }
    }

    if !to_restore.is_empty() {
        let restore_idx = TempIndex::new();
        let deadline = Instant::now() + RESTORE_BUDGET;
        git_with_index(
            git,
            &toplevel,
            &restore_idx.0,
            &["read-tree", tree_sha],
            deadline,
        )?;
        for chunk in to_restore.chunks(PATH_CHUNK_SIZE) {
            let mut args = vec!["checkout-index", "-f", "--"];
            args.extend(chunk.iter().map(String::as_str));
            if git_with_index(git, &toplevel, &restore_idx.0, &args, deadline).is_ok() {
                done += chunk.len();
                continue;
            }
            // One file failed: try each, so the rest are still restored.
            for path in chunk {
                let args = ["checkout-index", "-f", "--", path.as_str()];
                match git_with_index(git, &toplevel, &restore_idx.0, &args, deadline) {
                    Ok(_) => done += 1,
                    Err(_) => failed.push(path.clone()),
                }
            }
        }
    }

    // A deleted file the user's index still stages as new (an agent's `git add`) is unstaged; a
    // file HEAD has keeps its index entry, and so does every rewritten file.
    unstage_new_files(git, &toplevel, &removed);

    if failed.is_empty() {
        Ok(done)
    } else {
        let named: Vec<&str> = failed.iter().take(5).map(String::as_str).collect();
        let more = failed.len().saturating_sub(named.len());
        Err(format!(
            "Restored {done} {}; could not restore {}{}",
            if done == 1 { "file" } else { "files" },
            named.join(", "),
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        ))
    }
}

/// Unstages those of `removed` that HEAD does not have, from the user's real index.
fn unstage_new_files(git: &Path, toplevel: &Path, removed: &[&str]) {
    if removed.is_empty() {
        return;
    }
    let has_head = run_git(git, toplevel, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok();
    for chunk in removed.chunks(PATH_CHUNK_SIZE) {
        let in_head: BTreeSet<String> = if has_head {
            let mut args = vec!["ls-tree", "-z", "--name-only", "HEAD", "--"];
            args.extend_from_slice(chunk);
            run_git(git, toplevel, &args)
                .map(|listed| {
                    listed
                        .split('\0')
                        .filter(|path| !path.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        } else {
            BTreeSet::new()
        };
        let new_files: Vec<&str> = chunk
            .iter()
            .copied()
            .filter(|path| !in_head.contains(*path))
            .collect();
        if new_files.is_empty() {
            continue;
        }
        let mut args = vec!["rm", "--cached", "-q", "--ignore-unmatch", "--"];
        args.extend_from_slice(&new_files);
        let _ = run_git(git, toplevel, &args);
    }
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

/// Restores the files the agent reported changing to a captured turn checkpoint, returning how
/// many files changed.
#[tauri::command(async)]
pub fn restore_turn_checkpoint(
    store: State<'_, AppStore>,
    path: String,
    checkpoint: String,
    files: Vec<String>,
) -> Result<usize, String> {
    ensure_known_workspace(&path, |p| store.is_known_workspace(p))?;
    restore_checkpoint(&git_binary(), Path::new(&path), &checkpoint, &files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_raw_lines_and_marks_nested_repositories() {
        let raw =
            ":000000 100644 0000 abcd A\0new.ts\0:160000 000000 abcd 0000 D\0.claude/worktrees/x\0";
        let changes = parse_raw(raw);
        assert_eq!(changes.len(), 2);
        assert_eq!(
            (changes[0].status, changes[0].path, changes[0].is_gitlink),
            ("A", "new.ts", false)
        );
        assert!(changes[1].is_gitlink);
    }

    #[test]
    fn keeps_only_paths_inside_the_repository() {
        let top = Path::new("/w/repo");
        let dir = Path::new("/w/repo/app");
        assert_eq!(
            repo_path(top, dir, "src/a.ts").as_deref(),
            Some("app/src/a.ts")
        );
        assert_eq!(
            repo_path(top, dir, "/w/repo/README.md").as_deref(),
            Some("README.md")
        );
        assert_eq!(repo_path(top, dir, "../b.ts").as_deref(), Some("b.ts"));
        assert_eq!(repo_path(top, dir, "../../etc/passwd"), None);
        assert_eq!(repo_path(top, dir, "/etc/passwd"), None);
    }
}
