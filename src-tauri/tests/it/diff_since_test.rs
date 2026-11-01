use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use zorvo_lib::changes::{file_diff, file_diff_since, ChangeKind};
use zorvo_lib::diff_stats::{diff_stats_since, diff_targets, DiffTarget};
use zorvo_lib::worktrees::create_worktree_from;

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

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("zorvo-since-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir.canonicalize().expect("canonicalize temp dir")
}

/// A repository whose `feature` branch is one commit ahead of `main`, with
/// `feature` checked out.
fn repo_on_a_feature_branch(tag: &str) -> (PathBuf, PathBuf) {
    let base = temp_dir(tag);
    let repo = base.join("my-app");
    fs::create_dir_all(&repo).expect("create repo");
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["config", "user.email", "test@example.com"]);
    git(&repo, &["config", "user.name", "Test"]);
    fs::write(repo.join("main.txt"), "main\n").expect("write");
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-q", "-m", "init"]);
    git(&repo, &["checkout", "-q", "-b", "feature"]);
    fs::write(repo.join("feature.txt"), "feature\n").expect("write");
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-q", "-m", "feature work"]);
    (base, repo)
}

fn git_path() -> PathBuf {
    PathBuf::from("git")
}

#[test]
fn counts_commits_and_uncommitted_changes_from_a_feature_branch() {
    let (base, repo) = repo_on_a_feature_branch("feature");
    let worktree = create_worktree_from(
        &git_path(),
        &repo,
        &base.join("worktrees"),
        "try it",
        Some("feature"),
    )
    .expect("create worktree");
    let dir = Path::new(&worktree.path);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    fs::write(dir.join("committed.txt"), "a\nb\n").expect("write");
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "agent commit"]);
    fs::write(dir.join("feature.txt"), "feature\nmore\n").expect("modify");

    let stats = diff_stats_since(&git_path(), dir, &worktree.start_commit).expect("stats");

    let found: Vec<(&str, u64, u64)> = stats
        .iter()
        .map(|s| (s.path.as_str(), s.added, s.removed))
        .collect();
    assert_eq!(found, [("committed.txt", 2, 0), ("feature.txt", 1, 0)]);
    assert_eq!(stats[0].kind, ChangeKind::Added);
    assert_eq!(stats[1].kind, ChangeKind::Modified);
    fs::remove_dir_all(&base).ok();
}

#[test]
fn counts_an_untracked_file() {
    let (base, repo) = repo_on_a_feature_branch("untracked");
    let start = git(&repo, &["rev-parse", "HEAD"]);
    fs::write(repo.join("new.txt"), "x\ny\nz\n").expect("write");

    let stats = diff_stats_since(&git_path(), &repo, &start).expect("stats");

    assert_eq!(stats.len(), 1, "an untracked file counts once: {stats:?}");
    assert_eq!(stats[0].path, "new.txt");
    assert_eq!(stats[0].kind, ChangeKind::Untracked);
    assert_eq!((stats[0].added, stats[0].removed), (3, 0));
    fs::remove_dir_all(&base).ok();
}

#[test]
fn refuses_a_commit_that_is_not_hex() {
    let (base, repo) = repo_on_a_feature_branch("not-hex");

    for bad in ["HEAD", "--all", "abc", ""] {
        let error = diff_stats_since(&git_path(), &repo, bad)
            .expect_err(&format!("{bad:?} must be refused"));
        assert!(error.contains("commit"), "{bad:?}: {error}");
    }
    fs::remove_dir_all(&base).ok();
}

#[test]
fn refuses_a_commit_the_repository_does_not_have() {
    let (base, repo) = repo_on_a_feature_branch("missing");
    let missing = "0123456789abcdef0123456789abcdef01234567";

    let error = diff_stats_since(&git_path(), &repo, missing).expect_err("must be refused");

    assert!(error.contains("commit"), "{error}");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn create_worktree_reports_the_commit_it_started_from() {
    let (base, repo) = repo_on_a_feature_branch("start");
    let feature_tip = git(&repo, &["rev-parse", "feature"]);
    let main_tip = git(&repo, &["rev-parse", "main"]);

    let from_branch = create_worktree_from(
        &git_path(),
        &repo,
        &base.join("worktrees"),
        "from main",
        Some("main"),
    )
    .expect("worktree from main");
    let from_head = create_worktree_from(
        &git_path(),
        &repo,
        &base.join("worktrees"),
        "from head",
        None,
    )
    .expect("worktree from head");

    assert_eq!(from_branch.start_commit, main_tip);
    assert_eq!(from_head.start_commit, feature_tip);
    assert_eq!(from_head.start_commit.len(), 40);
    fs::remove_dir_all(&base).ok();
}

/// A repository with a start commit, one more commit after it that changes
/// `main.txt`, and an uncommitted edit plus an untracked file.
fn repo_with_work_after_the_start() -> (PathBuf, PathBuf, String) {
    let (base, repo) = repo_on_a_feature_branch("since-work");
    let start = git(&repo, &["rev-parse", "HEAD"]);
    fs::write(repo.join("main.txt"), "main\nCOMMITTED\n").expect("write");
    git(&repo, &["commit", "-q", "-am", "agent commit"]);
    fs::write(repo.join("feature.txt"), "feature\nUNCOMMITTED\n").expect("write");
    fs::write(repo.join("new.txt"), "UNTRACKED\n").expect("write");
    (base, repo, start)
}

#[test]
fn file_diff_since_shows_a_committed_change() {
    let (base, repo, start) = repo_with_work_after_the_start();

    let diff = file_diff_since(&git_path(), &repo, "main.txt", &start).expect("diff since");

    assert!(diff.contains("+COMMITTED"), "{diff}");
    let error = file_diff(&git_path(), &repo, "main.txt", DiffTarget::Head)
        .expect_err("HEAD does not list a committed file");
    assert!(error.contains("not a changed file"), "{error}");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn file_diff_since_shows_uncommitted_and_untracked_files() {
    let (base, repo, start) = repo_with_work_after_the_start();

    let modified = file_diff_since(&git_path(), &repo, "feature.txt", &start).expect("modified");
    let untracked = file_diff_since(&git_path(), &repo, "new.txt", &start).expect("untracked");

    assert!(modified.contains("+UNCOMMITTED"), "{modified}");
    assert!(untracked.contains("+UNTRACKED"), "{untracked}");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn file_diff_since_lists_what_diff_stats_since_lists() {
    let (base, repo, start) = repo_with_work_after_the_start();

    let stats = diff_stats_since(&git_path(), &repo, &start).expect("stats");

    assert_eq!(stats.len(), 3, "{stats:?}");
    for stat in &stats {
        file_diff_since(&git_path(), &repo, &stat.path, &start)
            .unwrap_or_else(|e| panic!("{} must read: {e}", stat.path));
    }
    let error = file_diff_since(&git_path(), &repo, "nowhere.txt", &start)
        .expect_err("an unchanged path is refused");
    assert!(error.contains("not a changed file"), "{error}");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn file_diff_since_refuses_a_bad_commit() {
    let (base, repo, _) = repo_with_work_after_the_start();

    for bad in ["HEAD", "--output=x"] {
        let error = file_diff_since(&git_path(), &repo, "main.txt", bad)
            .expect_err(&format!("{bad:?} must be refused"));
        assert_eq!(
            error, "The start commit must be a full commit id",
            "{bad:?}"
        );
    }
    assert!(!repo.join("x").exists());
    let missing = "0123456789abcdef0123456789abcdef01234567";
    let error = file_diff_since(&git_path(), &repo, "main.txt", missing).expect_err("missing");
    assert_eq!(error, "This repository does not have the start commit");
    fs::remove_dir_all(&base).ok();
}

#[test]
fn diff_targets_reports_root_and_prefix_from_a_subfolder() {
    let (base, repo) = repo_on_a_feature_branch("prefix");
    fs::create_dir_all(repo.join("sub")).expect("create sub");

    let from_sub = diff_targets(&git_path(), &repo.join("sub")).expect("targets");
    let from_root = diff_targets(&git_path(), &repo).expect("targets");

    assert_eq!(from_sub.prefix, "sub/");
    assert_eq!(Path::new(&from_sub.root), repo);
    assert_eq!(from_root.prefix, "");
    assert_eq!(Path::new(&from_root.root), repo);
    fs::remove_dir_all(&base).ok();
}
