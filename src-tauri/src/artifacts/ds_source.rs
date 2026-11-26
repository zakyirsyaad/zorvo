//! Whether the code a design system was made from changed since: read-only git in the repository
//! that holds the system, with every path and commit from `tokens.json` checked first. A cloned
//! repository's `.git/config` is not trusted, so no call can run its fsmonitor, external diff or
//! textconv program. Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 5.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::ds_tokens::DsSource;
use crate::changes::{run_git, run_git_with};

/// At most this many changed paths are named.
const MAX_CHANGED_PATHS: usize = 5;
const NO_FSMONITOR: [&str; 2] = ["-c", "core.fsmonitor=false"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum SourceState {
    /// Not made from code, or no source recorded.
    None,
    /// The recorded source could not be checked: a bad path or commit, or git failed.
    Unreadable,
    Current {
        commit: String,
    },
    Changed {
        commit: String,
        paths: Vec<String>,
        commits: u32,
        uncommitted: bool,
    },
    UnknownCommit {
        commit: String,
    },
}

fn is_commit(text: &str) -> bool {
    (7..=40).contains(&text.len())
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn is_plain_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('-')
        && !path.starts_with(':')
        && !path.chars().any(char::is_control)
        && !path.split('/').any(|part| part == "..")
}

/// The commit and paths of a source made from code, when every one passes; `Err` otherwise.
fn checked_source(source: &DsSource) -> Result<Option<(String, Vec<String>)>, ()> {
    let DsSource::Code { paths, commit } = source else {
        return Ok(None);
    };
    let Some(commit) = commit else {
        return Ok(None);
    };
    if !is_commit(commit) || paths.is_empty() || !paths.iter().all(|p| is_plain_path(p)) {
        return Err(());
    }
    Ok(Some((commit.clone(), paths.clone())))
}

fn git_args<'a>(rest: &[&'a str]) -> Vec<&'a str> {
    let mut args: Vec<&str> = NO_FSMONITOR.to_vec();
    args.extend_from_slice(rest);
    args
}

/// The state of `source` for a system whose folder is `system_root`.
pub fn source_state(git: &Path, system_root: &Path, source: Option<&DsSource>) -> SourceState {
    let Some(source) = source else {
        return SourceState::None;
    };
    let (commit, paths) = match checked_source(source) {
        Ok(Some(checked)) => checked,
        Ok(None) => return SourceState::None,
        Err(()) => return SourceState::Unreadable,
    };
    let Ok(top) = run_git(
        git,
        system_root,
        &git_args(&["rev-parse", "--show-toplevel"]),
    ) else {
        return SourceState::Unreadable;
    };
    let top = PathBuf::from(top.trim());
    let object = format!("{commit}^{{commit}}");
    if run_git(git, &top, &git_args(&["cat-file", "-e", &object])).is_err() {
        return SourceState::UnknownCommit { commit };
    }
    let path_args: Vec<&str> = paths.iter().map(String::as_str).collect();
    let range = format!("{commit}..HEAD");
    let with_paths = |head: &[&str]| -> Vec<String> {
        let mut args: Vec<&str> = git_args(head);
        args.push("--");
        args.extend_from_slice(&path_args);
        args.into_iter().map(str::to_string).collect()
    };
    let run = |args: Vec<String>, ok: &[i32]| -> Result<(String, i32), ()> {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        // Exit 1 of `diff --quiet` means "differs"; tell it apart from 0 by running with [0] first.
        match run_git_with(git, &top, &refs, &[0]) {
            Ok(out) => Ok((out, 0)),
            Err(_) if ok.contains(&1) => run_git_with(git, &top, &refs, ok)
                .map(|out| (out, 1))
                .map_err(|_| ()),
            Err(_) => Err(()),
        }
    };
    let Ok((log, _)) = run(with_paths(&["log", "--format=%H", &range]), &[0]) else {
        return SourceState::Unreadable;
    };
    let commits = u32::try_from(log.lines().filter(|line| !line.trim().is_empty()).count())
        .unwrap_or(u32::MAX);
    let Ok((_, quiet)) = run(
        with_paths(&["diff", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD"]),
        &[0, 1],
    ) else {
        return SourceState::Unreadable;
    };
    let uncommitted = quiet == 1;
    if commits == 0 && !uncommitted {
        return SourceState::Current { commit };
    }
    let Ok((names, _)) = run(
        with_paths(&[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-only",
            &commit,
        ]),
        &[0],
    ) else {
        return SourceState::Unreadable;
    };
    let changed: Vec<String> = names
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(MAX_CHANGED_PATHS)
        .map(str::to_string)
        .collect();
    SourceState::Changed {
        commit,
        paths: if changed.is_empty() { paths } else { changed },
        commits,
        uncommitted,
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::Temp;
    use super::*;
    use crate::git_info::git_binary;
    use std::fs;

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = crate::spawn::command(git_binary())
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .output()
            .expect("git");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    /// A repository with `src/styles/globals.css` and a system folder `ds`, committed once.
    fn repo(name: &str) -> (Temp, String) {
        let temp = Temp::new(name);
        git(&temp.0, &["init", "-q"]);
        fs::create_dir_all(temp.0.join("src/styles")).unwrap();
        fs::create_dir_all(temp.0.join("ds")).unwrap();
        fs::write(temp.0.join("src/styles/globals.css"), ":root{--a:#111}").unwrap();
        fs::write(temp.0.join("ds/design-system.json"), "{}").unwrap();
        git(&temp.0, &["add", "-A"]);
        git(&temp.0, &["commit", "-q", "-m", "one"]);
        let commit = git(&temp.0, &["rev-parse", "--short", "HEAD"]);
        (temp, commit)
    }

    fn code(paths: &[&str], commit: &str) -> DsSource {
        DsSource::Code {
            paths: paths.iter().map(|p| p.to_string()).collect(),
            commit: Some(commit.to_string()),
        }
    }

    fn state(temp: &Temp, source: &DsSource) -> SourceState {
        source_state(&git_binary(), &temp.0.join("ds"), Some(source))
    }

    #[test]
    fn unchanged_is_current() {
        let (temp, commit) = repo("ds-src-current");
        assert_eq!(
            state(&temp, &code(&["src/styles/globals.css"], &commit)),
            SourceState::Current { commit }
        );
    }

    #[test]
    fn a_committed_change_is_counted() {
        let (temp, commit) = repo("ds-src-commit");
        fs::write(temp.0.join("src/styles/globals.css"), ":root{--a:#222}").unwrap();
        git(&temp.0, &["commit", "-q", "-am", "two"]);
        assert_eq!(
            state(&temp, &code(&["src/styles/globals.css"], &commit)),
            SourceState::Changed {
                commit,
                paths: vec!["src/styles/globals.css".into()],
                commits: 1,
                uncommitted: false,
            }
        );
    }

    #[test]
    fn an_uncommitted_change_is_noticed() {
        let (temp, commit) = repo("ds-src-dirty");
        fs::write(temp.0.join("src/styles/globals.css"), ":root{--a:#333}").unwrap();
        let SourceState::Changed {
            uncommitted,
            commits,
            ..
        } = state(&temp, &code(&["src/styles/globals.css"], &commit))
        else {
            panic!("changed");
        };
        assert!(uncommitted);
        assert_eq!(commits, 0);
    }

    #[test]
    fn a_folder_path_with_a_trailing_slash_is_compared() {
        let (temp, commit) = repo("ds-src-folder");
        fs::write(temp.0.join("src/styles/more.css"), "x").unwrap();
        git(&temp.0, &["add", "-A"]);
        git(&temp.0, &["commit", "-q", "-m", "two"]);
        let SourceState::Changed { commits, .. } = state(&temp, &code(&["src/styles/"], &commit))
        else {
            panic!("changed");
        };
        assert_eq!(commits, 1);
    }

    #[test]
    fn an_unknown_commit_is_said() {
        let (temp, _) = repo("ds-src-unknown");
        assert_eq!(
            state(&temp, &code(&["src/styles/globals.css"], "deadbee")),
            SourceState::UnknownCommit {
                commit: "deadbee".into()
            }
        );
    }

    #[test]
    fn bad_paths_and_commits_are_unreadable() {
        let (temp, commit) = repo("ds-src-bad");
        for path in ["-x", ":x", "../x", "/x", ""] {
            assert_eq!(
                state(&temp, &code(&[path], &commit)),
                SourceState::Unreadable,
                "{path}"
            );
        }
        for bad in ["HEAD", "a1b2c3", "A1B2C3D"] {
            assert_eq!(
                state(&temp, &code(&["src/styles/globals.css"], bad)),
                SourceState::Unreadable,
                "{bad}"
            );
        }
        let references = DsSource::References {
            files: vec!["logo.svg".into()],
        };
        assert_eq!(state(&temp, &references), SourceState::None);
        assert_eq!(
            source_state(&git_binary(), &temp.0, None),
            SourceState::None
        );
    }

    fn marker_script(temp: &Temp, name: &str) -> PathBuf {
        let marker = temp.0.join(format!("{name}.ran"));
        let script = temp.0.join(format!("{name}.sh"));
        fs::write(
            &script,
            format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        }
        git(&temp.0, &["add", "-A"]);
        git(&temp.0, &["commit", "-q", "-m", "script"]);
        marker
    }

    #[test]
    fn never_reads_core_fsmonitor() {
        let (temp, commit) = repo("ds-src-fsmonitor");
        let marker = marker_script(&temp, "monitor");
        git(
            &temp.0,
            &[
                "config",
                "core.fsmonitor",
                &temp.0.join("monitor.sh").to_string_lossy(),
            ],
        );
        fs::write(temp.0.join("src/styles/globals.css"), "changed").unwrap();
        let _ = state(&temp, &code(&["src/styles/globals.css"], &commit));
        assert!(!marker.exists());
    }

    #[test]
    fn never_runs_an_external_diff_or_textconv() {
        let (temp, commit) = repo("ds-src-extdiff");
        let external = marker_script(&temp, "external");
        let textconv = marker_script(&temp, "textconv");
        git(
            &temp.0,
            &[
                "config",
                "diff.external",
                &temp.0.join("external.sh").to_string_lossy(),
            ],
        );
        fs::write(temp.0.join(".gitattributes"), "* diff=x\n").unwrap();
        git(
            &temp.0,
            &[
                "config",
                "diff.x.textconv",
                &temp.0.join("textconv.sh").to_string_lossy(),
            ],
        );
        fs::write(temp.0.join("src/styles/globals.css"), "changed").unwrap();
        let _ = state(&temp, &code(&["src/styles/globals.css"], &commit));
        assert!(!external.exists());
        assert!(!textconv.exists());
    }
}
