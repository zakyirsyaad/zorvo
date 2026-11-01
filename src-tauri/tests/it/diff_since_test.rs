use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use zorvo_lib::changes::ChangeKind;
use zorvo_lib::diff_stats::diff_stats_since;
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
