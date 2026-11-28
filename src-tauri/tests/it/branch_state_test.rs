use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use zorvo_lib::branch_state::read_branch_state;

fn scratch(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the unix epoch")
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("zorvo-bs-{}-{}-{}", tag, std::process::id(), nanos));
    fs::create_dir_all(&dir).expect("create dir");
    dir.canonicalize().expect("canonicalize dir")
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn repo(tag: &str) -> PathBuf {
    let dir = scratch(tag);
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    commit(&dir, "a.txt", "a");
    dir
}

fn commit(dir: &Path, file: &str, content: &str) {
    fs::write(dir.join(file), content).expect("write file");
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", file]);
}

fn read(dir: &Path) -> zorvo_lib::branch_state::BranchState {
    read_branch_state(Path::new("git"), dir).expect("branch state")
}

#[test]
fn no_upstream_reads_none_and_zero_ahead() {
    let dir = repo("noup");
    let state = read(&dir);
    assert_eq!(state.branch.as_deref(), Some("main"));
    assert_eq!(state.upstream, None);
    assert_eq!(state.ahead, 0);
}

#[test]
fn counts_commits_not_pushed() {
    let dir = repo("ahead");
    let remote = scratch("ahead-remote");
    git(&remote, &["init", "-q", "--bare"]);
    git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
    git(&dir, &["push", "-q", "-u", "origin", "main"]);
    commit(&dir, "b.txt", "b");
    commit(&dir, "c.txt", "c");
    let state = read(&dir);
    assert_eq!(state.upstream.as_deref(), Some("origin/main"));
    assert_eq!(state.ahead, 2);
}

#[test]
fn main_is_the_default_branch() {
    let dir = repo("main");
    assert!(read(&dir).is_default_branch);
}

#[test]
fn a_feature_branch_is_not() {
    let dir = repo("feature");
    git(&dir, &["switch", "-q", "-c", "feat/status-words"]);
    let state = read(&dir);
    assert_eq!(state.branch.as_deref(), Some("feat/status-words"));
    assert!(!state.is_default_branch);
}

#[test]
fn detached_head_has_no_branch() {
    let dir = repo("detached");
    commit(&dir, "b.txt", "b");
    git(&dir, &["switch", "-q", "--detach", "HEAD~1"]);
    let state = read(&dir);
    assert_eq!(state.branch, None);
    assert!(!state.is_default_branch);
}

#[test]
fn a_branch_never_pushed_counts_the_commits_no_remote_has() {
    let dir = repo("unpushed");
    let remote = scratch("unpushed-remote");
    git(&remote, &["init", "-q", "--bare"]);
    git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
    git(&dir, &["push", "-q", "origin", "main"]);
    git(&dir, &["switch", "-q", "-c", "feat/new"]);
    commit(&dir, "b.txt", "b");
    commit(&dir, "c.txt", "c");
    let state = read(&dir);
    assert_eq!(state.upstream, None);
    assert_eq!(state.ahead, 2);
}

#[test]
fn a_repository_with_no_remote_has_nothing_to_push() {
    let dir = repo("noremote");
    git(&dir, &["switch", "-q", "-c", "feat/local"]);
    commit(&dir, "b.txt", "b");
    assert_eq!(read(&dir).ahead, 0);
}
