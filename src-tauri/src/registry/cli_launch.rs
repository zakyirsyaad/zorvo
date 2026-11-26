//! Registry agents Zorvo runs through the user's own CLI instead of the
//! registry's program, when a new enough one is on `PATH`.
//!
//! Google Antigravity's registry build (`agy_acp_server.par`) lags behind the
//! `agy` CLI and ignores the user's own subagents and plugin skills, while
//! `agy acp` reads them. The program and its arguments are fixed here, so the
//! webview still names only the agent id.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use crate::env_resolver::cached_user_env;
use crate::installer::runtimes::version_output;
use crate::registry::history::compare_versions;

/// One agent that runs through a CLI of the user's.
#[derive(Debug, PartialEq, Eq)]
pub struct CliLaunch {
    pub agent_id: &'static str,
    /// The program's name on `PATH`.
    pub program: &'static str,
    /// The arguments that start its ACP server.
    pub args: &'static [&'static str],
    /// The oldest version that serves ACP the way Zorvo was tested with.
    pub min_version: &'static str,
}

impl CliLaunch {
    pub fn args(&self) -> Vec<String> {
        self.args.iter().map(|arg| (*arg).to_string()).collect()
    }
}

/// `--app-data-dir antigravity-acp` keeps the registry server's session store
/// (`~/.gemini/antigravity-acp`), so sessions started before stay resumable and
/// the registry build can still read them if `agy` goes away.
const ANTIGRAVITY: CliLaunch = CliLaunch {
    agent_id: "antigravity-acp",
    program: "agy",
    args: &["acp", "--app-data-dir", "antigravity-acp"],
    min_version: "1.5.17",
};

const CLI_LAUNCHES: &[CliLaunch] = &[ANTIGRAVITY];

/// How long `--version` may take.
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

/// A program whose `--version` gave no version is asked again after this.
const FAILED_PROBE_RETRY: Duration = Duration::from_secs(60);

/// The CLI that runs `agent_id`, if any.
pub fn cli_launch_for(agent_id: &str) -> Option<&'static CliLaunch> {
    CLI_LAUNCHES
        .iter()
        .find(|launch| launch.agent_id == agent_id)
}

/// Every agent that can run through a CLI of the user's.
pub fn all_cli_launches() -> impl Iterator<Item = &'static CliLaunch> {
    CLI_LAUNCHES.iter()
}

/// The first `x.y.z` word of `--version` output (`1.5.17`, `agy 1.5.17`,
/// `v1.5.17`), without a leading `v`.
pub fn parse_cli_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .map(|word| word.strip_prefix('v').unwrap_or(word))
        .find(|word| is_version(word))
        .map(str::to_string)
}

fn is_version(word: &str) -> bool {
    let core = word.split(['-', '+']).next().unwrap_or(word);
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() >= 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}

/// True when `version` is `min` or newer.
pub fn is_new_enough(version: &str, min: &str) -> bool {
    compare_versions(version, min) != std::cmp::Ordering::Less
}

/// What identifies one build of a file: its size and modification time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Fingerprint {
    size: u64,
    modified: SystemTime,
}

fn fingerprint(path: &Path) -> Option<Fingerprint> {
    // Follows a symlink, so an update behind `~/.local/bin/agy` is seen.
    let metadata = std::fs::metadata(path).ok()?;
    Some(Fingerprint {
        size: metadata.len(),
        modified: metadata.modified().ok()?,
    })
}

#[derive(Debug, Clone)]
struct Probed {
    fingerprint: Fingerprint,
    version: Option<String>,
    at: Instant,
}

type VersionCache = Mutex<HashMap<PathBuf, Probed>>;

static VERSIONS: std::sync::LazyLock<VersionCache> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// The version `path` reports, asking it only when the file changed since the
/// last answer, or a failed answer is over [`FAILED_PROBE_RETRY`] old. The
/// cache is not held while the program runs, so other callers never wait on it.
fn version_with(
    cache: &VersionCache,
    path: &Path,
    now: Instant,
    probe: impl FnOnce(&Path) -> Option<String>,
) -> Option<String> {
    let current = fingerprint(path)?;
    let lock = || {
        cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    };
    if let Some(known) = lock().get(path) {
        let is_fresh =
            known.version.is_some() || now.saturating_duration_since(known.at) < FAILED_PROBE_RETRY;
        if known.fingerprint == current && is_fresh {
            return known.version.clone();
        }
    }
    let version = probe(path);
    lock().insert(
        path.to_path_buf(),
        Probed {
            fingerprint: current,
            version: version.clone(),
            at: now,
        },
    );
    version
}

/// `program --version` with the user's login environment, parsed.
fn probe_version(program: &Path) -> Option<String> {
    let env = cached_user_env().unwrap_or_else(|_| std::env::vars().collect());
    version_output(program, &env, VERSION_TIMEOUT).and_then(|output| parse_cli_version(&output))
}

/// The version of each listed CLI found by `locate`, keyed by the path it was
/// found at. A CLI that gives no version is left out.
pub fn user_cli_versions(locate: impl Fn(&str) -> Option<String>) -> BTreeMap<String, String> {
    all_cli_launches()
        .filter_map(|launch| {
            let path = locate(launch.program)?;
            let version = version_with(&VERSIONS, Path::new(&path), Instant::now(), probe_version)?;
            Some((path, version))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::os::unix::fs::PermissionsExt;

    struct Scratch(PathBuf);

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch(name: &str) -> Scratch {
        let dir =
            std::env::temp_dir().join(format!("zorvo-cli-launch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        Scratch(dir)
    }

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    #[test]
    fn antigravity_runs_through_agy_acp_on_its_old_session_store() {
        let launch = cli_launch_for("antigravity-acp").expect("antigravity is listed");

        assert_eq!(launch.program, "agy");
        assert_eq!(
            launch.args(),
            vec!["acp", "--app-data-dir", "antigravity-acp"]
        );
        assert_eq!(launch.min_version, "1.5.17");
    }

    #[test]
    fn other_agents_have_no_cli_launch() {
        for id in ["qwen-code", "claude-acp", "codex-acp", "gemini", ""] {
            assert_eq!(cli_launch_for(id), None, "{id}");
        }
    }

    #[test]
    fn reads_the_first_version_word() {
        assert_eq!(parse_cli_version("1.5.17\n").as_deref(), Some("1.5.17"));
        assert_eq!(parse_cli_version("agy 1.5.17").as_deref(), Some("1.5.17"));
        assert_eq!(parse_cli_version("v1.6.0").as_deref(), Some("1.6.0"));
        assert_eq!(
            parse_cli_version("agy version 2.0.0-beta.1 (abc)").as_deref(),
            Some("2.0.0-beta.1")
        );
    }

    #[test]
    fn output_without_a_version_gives_none() {
        for output in ["", "agy", "1.5", "version one", "1..2", "1.5.x"] {
            assert_eq!(parse_cli_version(output), None, "{output:?}");
        }
    }

    #[test]
    fn a_version_is_new_enough_from_the_minimum_on() {
        assert!(is_new_enough("1.5.17", "1.5.17"));
        assert!(is_new_enough("1.5.18", "1.5.17"));
        assert!(is_new_enough("1.10.0", "1.5.17"));
        assert!(is_new_enough("2.0.0", "1.5.17"));
        assert!(!is_new_enough("1.5.16", "1.5.17"));
        assert!(!is_new_enough("1.5.2", "1.5.17"));
        assert!(!is_new_enough("1.5.17-beta", "1.5.17"));
    }

    #[test]
    fn a_program_is_asked_once_while_it_does_not_change() {
        let dir = scratch("once");
        let agy = script(&dir.0, "agy", "echo 1.5.17");
        let cache = VersionCache::default();
        let probes = Cell::new(0);
        let probe = |_: &Path| {
            probes.set(probes.get() + 1);
            Some("1.5.17".to_string())
        };
        let now = Instant::now();

        assert_eq!(
            version_with(&cache, &agy, now, probe).as_deref(),
            Some("1.5.17")
        );
        assert_eq!(
            version_with(&cache, &agy, now, probe).as_deref(),
            Some("1.5.17")
        );
        assert_eq!(probes.get(), 1);
    }

    #[test]
    fn a_changed_program_is_asked_again() {
        let dir = scratch("changed");
        let agy = script(&dir.0, "agy", "echo 1.5.17");
        let cache = VersionCache::default();
        let now = Instant::now();
        version_with(&cache, &agy, now, |_| Some("1.5.17".to_string()));

        script(&dir.0, "agy", "echo 1.5.18 # a longer build");

        let again = version_with(&cache, &agy, now, |_| Some("1.5.18".to_string()));
        assert_eq!(again.as_deref(), Some("1.5.18"));
    }

    #[test]
    fn a_failed_answer_is_retried_only_after_a_while() {
        let dir = scratch("failed");
        let agy = script(&dir.0, "agy", "exit 1");
        let cache = VersionCache::default();
        let start = Instant::now();
        version_with(&cache, &agy, start, |_| None);

        let soon = version_with(&cache, &agy, start, |_| Some("1.5.17".to_string()));
        let later = version_with(&cache, &agy, start + FAILED_PROBE_RETRY, |_| {
            Some("1.5.17".to_string())
        });

        assert_eq!(soon, None);
        assert_eq!(later.as_deref(), Some("1.5.17"));
    }

    #[test]
    fn a_missing_program_has_no_version_and_is_not_asked() {
        let dir = scratch("missing");
        let cache = VersionCache::default();

        let version = version_with(&cache, &dir.0.join("agy"), Instant::now(), |_| {
            panic!("a missing file is never run")
        });

        assert_eq!(version, None);
    }

    #[test]
    fn the_version_comes_from_running_the_program() {
        let dir = scratch("probe");
        let agy = script(&dir.0, "agy", "echo 'agy 1.5.17'");
        let no_version = script(&dir.0, "no-version", "echo nothing useful");

        assert_eq!(probe_version(&agy).as_deref(), Some("1.5.17"));
        assert_eq!(probe_version(&no_version), None);
    }

    #[test]
    fn versions_are_keyed_by_where_each_cli_was_found() {
        let dir = scratch("keyed");
        let agy = script(&dir.0, "agy", "echo 1.6.0");
        let found = agy.to_string_lossy().to_string();

        let versions = user_cli_versions(|program| (program == "agy").then(|| found.clone()));

        assert_eq!(versions, BTreeMap::from([(found, "1.6.0".to_string())]));
        assert!(user_cli_versions(|_| None).is_empty());
    }
}
