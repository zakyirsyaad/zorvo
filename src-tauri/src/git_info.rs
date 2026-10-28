//! What the UI shows about a workspace: its git branch and where it lives.
//!
//! The branch is read from the repository's `HEAD` file rather than by
//! running git, so showing it costs one small file read and needs no git.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::env_resolver;
use crate::files::ensure_known_workspace;
use crate::store::AppStore;

/// Locates git, preferring the login shell's `PATH`.
///
/// An app launched from Finder or the Dock does not inherit the user's shell
/// `PATH`, so a Homebrew-installed git would be invisible without this. The
/// bare name is kept as a fallback so the process `PATH` still gets a chance.
pub(crate) fn git_binary() -> PathBuf {
    env_resolver::find_binary_in_user_path("git").unwrap_or_else(|| PathBuf::from("git"))
}

/// How many characters of a commit a detached `HEAD` is shown with.
const SHORT_COMMIT_LEN: usize = 7;

/// A workspace's folder line ("~/developer") and its branch, if it is a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDetails {
    pub location: String,
    pub branch: Option<String>,
    /// Whether the repository has a remote on github.com, which is where pull
    /// requests and the GitHub CLI matter.
    pub has_github_remote: bool,
}

/// The `.git` directory of the repository `dir` is in, following the `.git`
/// file a worktree or submodule has in place of a directory.
fn git_dir_of(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().find_map(|folder| {
        let dot_git = folder.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        let pointer = fs::read_to_string(&dot_git).ok()?;
        let target = pointer.trim().strip_prefix("gitdir:")?.trim();
        Some(folder.join(target))
    })
}

/// The checked-out branch of the repository `dir` is in, or a short commit
/// when `HEAD` is detached; `None` outside a repository.
pub fn branch_of(dir: &Path) -> Option<String> {
    let head = fs::read_to_string(git_dir_of(dir)?.join("HEAD")).ok()?;
    let head = head.trim();
    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        return Some(
            reference
                .strip_prefix("refs/heads/")
                .unwrap_or(reference)
                .to_string(),
        );
    }
    let is_commit = head.len() >= SHORT_COMMIT_LEN && head.chars().all(|c| c.is_ascii_hexdigit());
    is_commit.then(|| head[..SHORT_COMMIT_LEN].to_string())
}

/// The host of a git remote URL: `https://github.com/o/r`, `ssh://git@github.com:22/o/r`,
/// `git@github.com:o/r` and `github.com:o/r` all give `github.com`.
fn remote_host(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split('/').next().unwrap_or("");
    let host_and_port = authority.rsplit('@').next().unwrap_or("");
    host_and_port.split(':').next().unwrap_or("")
}

/// Whether a git `config` file has a remote whose URL is on github.com.
pub fn remotes_include_github(config: &str) -> bool {
    let mut in_remote = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            in_remote = line.starts_with("[remote ");
        } else if in_remote && !line.starts_with(['#', ';']) {
            let is_github_url = line.split_once('=').is_some_and(|(key, value)| {
                key.trim().eq_ignore_ascii_case("url")
                    && remote_host(value.trim().trim_matches('"'))
                        .eq_ignore_ascii_case("github.com")
            });
            if is_github_url {
                return true;
            }
        }
    }
    false
}

/// The `config` file of the repository whose `.git` directory is `git_dir`: a
/// linked worktree's `.git/worktrees/<name>` points to the main one's through
/// its `commondir` file.
fn config_path_of(git_dir: &Path) -> PathBuf {
    let common_dir = fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map_or_else(
            || git_dir.to_path_buf(),
            |relative| git_dir.join(relative.trim()),
        );
    common_dir.join("config")
}

/// Whether the repository `dir` is in has a remote on github.com; false outside
/// a repository. Read from git's `config` file, without running git.
pub fn has_github_remote(dir: &Path) -> bool {
    git_dir_of(dir)
        .and_then(|git_dir| fs::read_to_string(config_path_of(&git_dir)).ok())
        .is_some_and(|config| remotes_include_github(&config))
}

/// The folder that holds `path`, with the home folder shown as `~`.
pub fn display_location(path: &Path, home: Option<&Path>) -> String {
    let parent = path.parent().unwrap_or(path);
    match home.and_then(|home| parent.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => format!("~/{}", rest.display()),
        None => parent.display().to_string(),
    }
}

/// The folder line and branch shown for one of the user's workspaces.
#[tauri::command(async)]
pub fn workspace_details(
    store: State<'_, AppStore>,
    path: String,
) -> Result<WorkspaceDetails, String> {
    ensure_known_workspace(&path, |p| store.is_known_workspace(p))?;
    let path = Path::new(&path);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    Ok(WorkspaceDetails {
        location: display_location(path, home.as_deref()),
        branch: branch_of(path),
        has_github_remote: has_github_remote(path),
    })
}
