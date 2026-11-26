use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use zorvo_lib::changes::{list_changes, ChangeKind};
use zorvo_lib::checkpoints::{create_checkpoint, restore_checkpoint};

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
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "zorvo-checkpoints-{tag}-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(dir.join("src")).expect("create repo");
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    fs::write(dir.join(".gitignore"), ".env\nignored/\n").expect("write gitignore");
    fs::write(dir.join("src/app.ts"), "v1\n").expect("write app");
    fs::write(dir.join("keep.txt"), "keep\n").expect("write keep");
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "init"]);
    dir
}

fn git_path() -> PathBuf {
    PathBuf::from("git")
}

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|path| path.to_string()).collect()
}

#[test]
fn returns_none_outside_a_git_repository() {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let plain = std::env::temp_dir().join(format!(
        "zorvo-checkpoints-nogit-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&plain).expect("create plain dir");

    let checkpoint = create_checkpoint(&git_path(), &plain).expect("non-git checkpoint");
    assert_eq!(checkpoint, None);

    fs::remove_dir_all(plain).ok();
}

#[test]
fn snapshots_pre_turn_edits_and_restores_across_modify_delete_create_and_stage() {
    let dir = repo("full");
    // Pre-existing uncommitted user edit before the turn starts.
    fs::write(dir.join("src/app.ts"), "user-pre-turn\n").expect("pre-turn modify");
    fs::write(dir.join("user-note.txt"), "keep-me\n").expect("pre-turn untracked");
    // Staged file the user already staged before the turn: index should remain clean after restore.
    fs::write(dir.join("pre-staged.txt"), "before\n").expect("pre-staged");
    git(&dir, &["add", "pre-staged.txt"]);

    let cp = create_checkpoint(&git_path(), &dir)
        .expect("checkpoint result")
        .expect("git checkpoint sha");
    // Real index still holds pre-staged.txt (unchanged by snapshot).
    assert_eq!(
        git(&dir, &["diff", "--cached", "--name-only"]),
        "pre-staged.txt"
    );

    // Simulate agent work during the turn.
    fs::write(dir.join("src/app.ts"), "agent-broke-this\n").expect("agent overwrite");
    fs::remove_file(dir.join("keep.txt")).expect("agent delete");
    fs::remove_file(dir.join("user-note.txt")).expect("agent delete untracked");
    fs::write(dir.join("agent-created.ts"), "new file\n").expect("agent create");
    fs::write(dir.join("agent-staged.ts"), "staged new\n").expect("agent stage");
    git(&dir, &["add", "agent-staged.ts"]);

    let changed = restore_checkpoint(
        &git_path(),
        &dir,
        &cp,
        &paths(&[
            "src/app.ts",
            "keep.txt",
            "user-note.txt",
            "agent-created.ts",
            "agent-staged.ts",
        ]),
    )
    .expect("restore checkpoint");

    assert_eq!(changed, 5);
    assert_eq!(
        fs::read_to_string(dir.join("src/app.ts")).expect("read app"),
        "user-pre-turn\n"
    );
    assert_eq!(
        fs::read_to_string(dir.join("keep.txt")).expect("read keep"),
        "keep\n"
    );
    assert_eq!(
        fs::read_to_string(dir.join("user-note.txt")).expect("read user-note"),
        "keep-me\n"
    );
    assert!(!dir.join("agent-created.ts").exists());
    assert!(!dir.join("agent-staged.ts").exists());
    // Staged addition from the agent was unstaged cleanly too.
    assert!(!list_changes(&git_path(), &dir)
        .expect("list changes")
        .iter()
        .any(|c| c.path == "agent-staged.ts"));

    fs::remove_dir_all(dir).ok();
}

#[test]
fn leaves_gitignored_files_untouched_and_reports_zero_when_unchanged() {
    let dir = repo("ignored");
    fs::write(dir.join(".env"), "SECRET=abc\n").expect("write .env");
    fs::create_dir_all(dir.join("ignored")).expect("mkdir");
    fs::write(dir.join("ignored/cache.bin"), "cached\n").expect("write ignored");

    let cp = create_checkpoint(&git_path(), &dir)
        .expect("cp")
        .expect("sha");

    // Nothing changed -> 0 restored.
    assert_eq!(
        restore_checkpoint(&git_path(), &dir, &cp, &paths(&["src/app.ts"])).expect("noop"),
        0
    );

    // Update .env and create a file inside ignored/ plus modify tracked file.
    fs::write(dir.join(".env"), "SECRET=updated\n").expect("update .env");
    fs::write(dir.join("ignored/more.bin"), "more\n").expect("write ignored more");
    fs::write(dir.join("src/app.ts"), "agent-edit\n").expect("edit tracked");

    let count = restore_checkpoint(
        &git_path(),
        &dir,
        &cp,
        &paths(&[".env", "ignored/more.bin", "src/app.ts"]),
    )
    .expect("restore");
    assert_eq!(count, 1);
    assert_eq!(
        fs::read_to_string(dir.join("src/app.ts")).expect("restored"),
        "v1\n"
    );
    assert_eq!(
        fs::read_to_string(dir.join(".env")).expect("env untouched"),
        "SECRET=updated\n"
    );
    assert!(dir.join("ignored/more.bin").exists());

    fs::remove_dir_all(dir).ok();
}

#[test]
fn works_before_first_commit_and_rejects_invalid_checkpoint() {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let unborn = std::env::temp_dir().join(format!(
        "zorvo-checkpoints-unborn-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&unborn).expect("create unborn");
    git(&unborn, &["init", "-q", "-b", "main"]);
    fs::write(unborn.join("draft.txt"), "before turn\n").expect("write draft");

    let cp = create_checkpoint(&git_path(), &unborn)
        .expect("cp")
        .expect("sha");

    fs::write(unborn.join("draft.txt"), "after turn\n").expect("modify");
    fs::write(unborn.join("extra.txt"), "extra\n").expect("create");
    git(&unborn, &["add", "extra.txt"]);

    let changed = restore_checkpoint(
        &git_path(),
        &unborn,
        &cp,
        &paths(&["draft.txt", "extra.txt"]),
    )
    .expect("restore unborn");
    assert_eq!(changed, 2);
    assert_eq!(
        fs::read_to_string(unborn.join("draft.txt")).expect("read draft"),
        "before turn\n"
    );
    assert!(!unborn.join("extra.txt").exists());
    assert_eq!(
        list_changes(&git_path(), &unborn).expect("changes"),
        vec![zorvo_lib::changes::FileChange {
            path: "draft.txt".to_string(),
            old_path: None,
            kind: ChangeKind::Untracked,
        }]
    );

    assert!(restore_checkpoint(&git_path(), &unborn, "not-a-sha", &paths(&["draft.txt"])).is_err());
    assert!(restore_checkpoint(
        &git_path(),
        &unborn,
        &"0".repeat(40),
        &paths(&["draft.txt"])
    )
    .is_err());

    fs::remove_dir_all(unborn).ok();
}

#[test]
fn restores_only_the_named_files_and_keeps_the_rest() {
    let dir = repo("scoped");
    let cp = create_checkpoint(&git_path(), &dir)
        .expect("cp")
        .expect("sha");

    // The agent's turn changes app.ts; meanwhile the user (or another session) adds a note,
    // edits keep.txt and un-ignores .env by editing .gitignore.
    fs::write(dir.join("src/app.ts"), "agent\n").expect("agent edit");
    fs::write(dir.join("notes.md"), "mine\n").expect("user note");
    fs::write(dir.join("keep.txt"), "user edit\n").expect("user edit");

    let changed =
        restore_checkpoint(&git_path(), &dir, &cp, &paths(&["src/app.ts"])).expect("restore");

    assert_eq!(changed, 1);
    assert_eq!(
        fs::read_to_string(dir.join("src/app.ts")).expect("app"),
        "v1\n"
    );
    assert!(dir.join("notes.md").exists());
    assert_eq!(
        fs::read_to_string(dir.join("keep.txt")).expect("keep"),
        "user edit\n"
    );
    // Nothing named that the repository holds: nothing done.
    assert_eq!(
        restore_checkpoint(
            &git_path(),
            &dir,
            &cp,
            &paths(&["/etc/passwd", "../outside"])
        )
        .expect("outside"),
        0
    );

    fs::remove_dir_all(dir).ok();
}

#[test]
fn skips_nested_repositories_and_large_untracked_files() {
    let dir = repo("nested");
    let cp = create_checkpoint(&git_path(), &dir)
        .expect("cp")
        .expect("sha");

    // A nested repository appears (a worktree folder) and a large untracked render.
    let nested = dir.join("worktrees/x");
    fs::create_dir_all(&nested).expect("nested");
    git(&nested, &["init", "-q", "-b", "main"]);
    fs::write(nested.join("f.txt"), "nested\n").expect("nested file");
    let big = vec![b'x'; (zorvo_lib::checkpoints::MAX_UNTRACKED_BYTES + 1) as usize];
    fs::write(dir.join("render.mp4"), &big).expect("big file");
    fs::write(dir.join("src/app.ts"), "agent\n").expect("agent edit");

    let changed = restore_checkpoint(
        &git_path(),
        &dir,
        &cp,
        &paths(&["worktrees/x", "render.mp4", "src/app.ts"]),
    )
    .expect("restore despite the nested repository");

    assert_eq!(changed, 1);
    assert!(nested.join("f.txt").exists());
    assert!(dir.join("render.mp4").exists());
    assert_eq!(
        fs::read_to_string(dir.join("src/app.ts")).expect("app"),
        "v1\n"
    );

    fs::remove_dir_all(dir).ok();
}

#[test]
fn gives_up_a_checkpoint_that_runs_over_its_budget() {
    let dir = repo("budget");
    let checkpoint = zorvo_lib::checkpoints::create_checkpoint_within(
        &git_path(),
        &dir,
        std::time::Duration::ZERO,
    );
    assert!(checkpoint.is_err());

    fs::remove_dir_all(dir).ok();
}

#[test]
fn restores_file_replaced_by_a_directory_during_turn() {
    let dir = repo("file-to-dir");
    let cp = create_checkpoint(&git_path(), &dir)
        .expect("cp")
        .expect("sha");

    // Agent replaces `keep.txt` file with a directory `keep.txt/child.ts`.
    fs::remove_file(dir.join("keep.txt")).expect("remove keep.txt");
    fs::create_dir_all(dir.join("keep.txt")).expect("mkdir keep.txt");
    fs::write(dir.join("keep.txt/child.ts"), "new child\n").expect("write child");

    let changed = restore_checkpoint(
        &git_path(),
        &dir,
        &cp,
        &paths(&["keep.txt", "keep.txt/child.ts"]),
    )
    .expect("restore file replaced by dir");

    assert_eq!(changed, 2);
    assert!(dir.join("keep.txt").is_file());
    assert_eq!(
        fs::read_to_string(dir.join("keep.txt")).expect("read restored keep.txt"),
        "keep\n"
    );

    fs::remove_dir_all(dir).ok();
}
