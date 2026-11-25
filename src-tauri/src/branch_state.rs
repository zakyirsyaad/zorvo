//! Where a session's branch stands against its upstream, for the next-step box:
//! the branch, its upstream, how many commits are not pushed, and whether it is the
//! repository's default branch. Read-only: it runs no git that changes anything.

use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::changes::{run_git, run_git_with};
use crate::files::ensure_known_workspace;
use crate::git_info::git_binary;
use crate::store::AppStore;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchState {
    /// `None` on a detached `HEAD`.
    pub branch: Option<String>,
    /// The upstream as git names it (`origin/main`), `None` when the branch tracks nothing.
    pub upstream: Option<String>,
    /// Commits on the branch that its upstream does not have; 0 without an upstream.
    pub ahead: u32,
    pub is_default_branch: bool,
}

/// Reads the branch state of the repository at `dir` with the git at `git`.
pub fn read_branch_state(git: &Path, dir: &Path) -> Result<BranchState, String> {
    let head = run_git(git, dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = Some(head.trim().to_string()).filter(|name| !name.is_empty() && name != "HEAD");
    // A branch with no upstream makes git exit 128: that is an answer, not a failure.
    let upstream = run_git_with(
        git,
        dir,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        &[0, 128],
    )
    .ok()
    .map(|out| out.trim().to_string())
    .filter(|name| !name.is_empty() && branch.is_some());
    let ahead = match &upstream {
        Some(_) => run_git(git, dir, &["rev-list", "--count", "@{upstream}..HEAD"])?
            .trim()
            .parse::<u32>()
            .unwrap_or(0),
        None => 0,
    };
    let default = default_branch(git, dir);
    let is_default_branch = match (&branch, &default) {
        (Some(name), Some(default)) => name == default,
        (Some(name), None) => name == "main" || name == "master",
        (None, _) => false,
    };
    Ok(BranchState {
        branch,
        upstream,
        ahead,
        is_default_branch,
    })
}

/// The branch `origin/HEAD` points at, when the clone recorded one.
fn default_branch(git: &Path, dir: &Path) -> Option<String> {
    let out = run_git_with(
        git,
        dir,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        &[0, 1, 128],
    )
    .ok()?;
    out.trim()
        .strip_prefix("refs/remotes/origin/")
        .map(str::to_string)
        .filter(|name| !name.is_empty())
}

/// The branch state of a session's folder. Never returns a path.
#[tauri::command(async)]
pub fn session_branch_state(
    store: State<'_, AppStore>,
    cwd: String,
) -> Result<BranchState, String> {
    ensure_known_workspace(&cwd, |p| store.is_known_workspace(p))?;
    read_branch_state(&git_binary(), Path::new(&cwd))
}
