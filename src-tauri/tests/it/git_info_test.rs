use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use zorvo_lib::git_info::{
    branch_of, display_location, has_github_remote, remotes_include_github, WorkspaceDetails,
};

fn unique_temp_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "zorvo-git-{}-{}-{}",
        tag,
        std::process::id(),
        nanos
    ))
}

fn write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    fs::write(path, content).expect("write file");
}

#[test]
fn reads_the_branch_from_head() {
    let root = unique_temp_root("branch");
    write(&root.join(".git/HEAD"), "ref: refs/heads/feat/sidebar\n");

    assert_eq!(branch_of(&root), Some("feat/sidebar".to_string()));
    fs::remove_dir_all(&root).ok();
}

#[test]
fn finds_the_repository_from_a_subfolder() {
    let root = unique_temp_root("subfolder");
    write(&root.join(".git/HEAD"), "ref: refs/heads/main\n");
    fs::create_dir_all(root.join("packages/app")).expect("create subfolder");

    assert_eq!(
        branch_of(&root.join("packages/app")),
        Some("main".to_string())
    );
    fs::remove_dir_all(&root).ok();
}

#[test]
fn shows_a_short_commit_when_head_is_detached() {
    let root = unique_temp_root("detached");
    write(
        &root.join(".git/HEAD"),
        "0123456789abcdef0123456789abcdef01234567\n",
    );

    assert_eq!(branch_of(&root), Some("0123456".to_string()));
    fs::remove_dir_all(&root).ok();
}

#[test]
fn follows_a_worktree_git_file_to_its_head() {
    let root = unique_temp_root("worktree");
    let gitdir = root.join("main/.git/worktrees/wt");
    write(&gitdir.join("HEAD"), "ref: refs/heads/claude/wt\n");
    write(
        &root.join("wt/.git"),
        &format!("gitdir: {}\n", gitdir.display()),
    );

    assert_eq!(branch_of(&root.join("wt")), Some("claude/wt".to_string()));
    fs::remove_dir_all(&root).ok();
}

#[test]
fn has_no_branch_outside_a_repository_or_with_an_unreadable_head() {
    let root = unique_temp_root("none");
    fs::create_dir_all(&root).expect("create root");
    assert_eq!(branch_of(&root), None);

    write(&root.join("repo/.git/HEAD"), "garbage");
    assert_eq!(branch_of(&root.join("repo")), None);
    fs::remove_dir_all(&root).ok();
}

fn config_with_url(url: &str) -> String {
    format!("[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]\n\turl = {url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n")
}

#[test]
fn a_remote_on_github_com_is_found_in_every_url_form() {
    for url in [
        "https://github.com/o/r.git",
        "http://github.com/o/r",
        "git://github.com/o/r.git",
        "ssh://git@github.com/o/r.git",
        "ssh://git@github.com:22/o/r.git",
        "https://user:pass@github.com/o/r",
        "git@github.com:o/r.git",
        "github.com:o/r",
        "https://GitHub.com/o/r",
    ] {
        assert!(remotes_include_github(&config_with_url(url)), "{url}");
    }
}

#[test]
fn other_hosts_and_other_config_lines_are_not_github() {
    for url in [
        "https://gitlab.com/o/r.git",
        "git@bitbucket.org:o/r.git",
        "https://github.com.example.org/o/r",
        "https://notgithub.com/o/r",
        "https://example.com/github.com/o/r",
        "git@example.com:github.com/r.git",
        "/srv/git/r.git",
    ] {
        assert!(!remotes_include_github(&config_with_url(url)), "{url}");
    }
    // A url outside a remote section, a comment and no remote at all.
    assert!(!remotes_include_github(
        "[submodule \"x\"]\n\turl = https://github.com/o/r\n"
    ));
    assert!(!remotes_include_github(
        "[remote \"origin\"]\n\t# url = https://github.com/o/r\n"
    ));
    assert!(!remotes_include_github("[core]\n\tbare = false\n"));
    assert!(!remotes_include_github(""));
}

#[test]
fn any_one_of_several_remotes_on_github_counts() {
    let config = "[remote \"origin\"]\n\turl = https://gitlab.com/o/r\n[remote \"mirror\"]\n\turl = git@github.com:o/r.git\n";

    assert!(remotes_include_github(config));
}

#[test]
fn reads_the_remote_from_the_repositorys_config_file() {
    let root = unique_temp_root("remote");
    write(&root.join(".git/HEAD"), "ref: refs/heads/main\n");
    write(
        &root.join(".git/config"),
        &config_with_url("git@github.com:o/r.git"),
    );
    fs::create_dir_all(root.join("packages/app")).expect("create subfolder");

    assert!(has_github_remote(&root));
    assert!(has_github_remote(&root.join("packages/app")));
    fs::remove_dir_all(&root).ok();
}

#[test]
fn a_repository_without_a_github_remote_has_none() {
    let none = unique_temp_root("no-remote");
    write(&none.join(".git/HEAD"), "ref: refs/heads/main\n");
    let elsewhere = unique_temp_root("other-remote");
    write(&elsewhere.join(".git/HEAD"), "ref: refs/heads/main\n");
    write(
        &elsewhere.join(".git/config"),
        &config_with_url("https://gitlab.com/o/r"),
    );
    let not_a_repository = unique_temp_root("plain");
    fs::create_dir_all(&not_a_repository).expect("create folder");

    assert!(!has_github_remote(&none));
    assert!(!has_github_remote(&elsewhere));
    assert!(!has_github_remote(&not_a_repository));
    for root in [none, elsewhere, not_a_repository] {
        fs::remove_dir_all(&root).ok();
    }
}

#[test]
fn the_workspace_details_tell_the_ui_about_a_github_remote_under_the_key_it_reads() {
    let json = serde_json::to_value(WorkspaceDetails {
        location: "~/developer".to_string(),
        branch: Some("main".to_string()),
        has_github_remote: true,
    })
    .expect("serialize");

    assert_eq!(
        json,
        serde_json::json!({
            "location": "~/developer", "branch": "main", "hasGithubRemote": true
        })
    );
}

#[test]
fn a_linked_worktree_reads_the_main_repositorys_remote() {
    let main = unique_temp_root("worktree-main");
    write(&main.join(".git/HEAD"), "ref: refs/heads/main\n");
    write(
        &main.join(".git/config"),
        &config_with_url("https://github.com/o/r.git"),
    );
    // `git worktree add` leaves a `.git` file in the worktree, which names a
    // folder under the main repository's `.git/worktrees` that has a `commondir`.
    let admin = main.join(".git/worktrees/feature");
    write(&admin.join("HEAD"), "ref: refs/heads/feature\n");
    write(&admin.join("commondir"), "../..\n");
    let worktree = unique_temp_root("worktree-checkout");
    write(
        &worktree.join(".git"),
        &format!("gitdir: {}\n", admin.display()),
    );

    assert!(has_github_remote(&worktree));
    fs::remove_dir_all(&main).ok();
    fs::remove_dir_all(&worktree).ok();
}

#[test]
fn shows_the_parent_folder_relative_to_home() {
    let home = Path::new("/Users/mac");
    assert_eq!(
        display_location(Path::new("/Users/mac/developer/zorvo"), Some(home)),
        "~/developer"
    );
    assert_eq!(
        display_location(Path::new("/Users/mac/project"), Some(home)),
        "~"
    );
    assert_eq!(
        display_location(Path::new("/opt/work/app"), Some(home)),
        "/opt/work"
    );
    assert_eq!(
        display_location(Path::new("/Users/macbook/app"), Some(home)),
        "/Users/macbook"
    );
    assert_eq!(
        display_location(Path::new("/opt/work/app"), None),
        "/opt/work"
    );
}
