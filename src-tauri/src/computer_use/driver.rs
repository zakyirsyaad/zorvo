//! Where the computer-use driver is, whether it is the pinned one, and how it
//! is started.
//!
//! The driver is trycua's `cua-driver`, shipped inside `Zorvo.app` with
//! trycua's own signature. It is the one process Zorvo starts without
//! disclaiming macOS responsibility, so it works with Zorvo's Screen Recording
//! and Accessibility grants.

use std::fs;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The bundle id the driver reports its grants under.
pub const HOST_BUNDLE_ID: &str = "xyz.zorvo.desktop";
/// Debug builds may point at another driver with this variable.
const DEBUG_PATH_VARIABLE: &str = "ZORVO_CUA_DRIVER_PATH";
/// The longest label a driver session gets; a badge that long still fits.
const MAX_LABEL_CHARS: usize = 40;

/// The driver release this build of Zorvo ships.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriverPin {
    pub version: String,
    /// SHA-256 of the `cua-driver` file itself, in lower-case hex.
    pub sha256: String,
    /// trycua's Developer ID team.
    pub team: String,
}

#[derive(Deserialize)]
struct PinFile {
    version: String,
    file: PinnedFile,
    team: String,
}

#[derive(Deserialize)]
struct PinnedFile {
    sha256: String,
}

/// The pin compiled into this build from `resources/cua-driver.json`.
pub fn pinned() -> &'static DriverPin {
    static PIN: OnceLock<DriverPin> = OnceLock::new();
    PIN.get_or_init(|| {
        let file: PinFile = serde_json::from_str(include_str!("../../resources/cua-driver.json"))
            .expect("resources/cua-driver.json is checked by its own test");
        DriverPin {
            version: file.version,
            sha256: file.file.sha256,
            team: file.team,
        }
    })
}

/// Why no driver can be started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriverUnavailable {
    /// No driver file where Zorvo ships it.
    Missing,
    /// The file is not the pinned one, or not signed by the pinned team.
    Changed,
    /// An update replaced the app on disk; this Zorvo has not restarted yet.
    UpdatePending,
}

/// Where this build looks for the driver. Release builds use only the file
/// beside Zorvo's own executable in `Zorvo.app/Contents/MacOS`.
pub fn locate() -> Result<PathBuf, DriverUnavailable> {
    let path = if cfg!(debug_assertions) {
        std::env::var_os(DEBUG_PATH_VARIABLE)
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/cua-driver"))
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("cua-driver")))
            .ok_or(DriverUnavailable::Missing)?
    };
    if path.is_file() {
        Ok(path)
    } else {
        Err(DriverUnavailable::Missing)
    }
}

/// `CFBundleShortVersionString` from the text of an XML `Info.plist`.
pub fn short_version(info_plist: &str) -> Option<String> {
    let after_key = info_plist
        .split_once("<key>CFBundleShortVersionString</key>")?
        .1;
    let value = after_key.split_once("<string>")?.1;
    Some(value.split_once("</string>")?.0.trim().to_string())
}

/// The version of the app bundle `driver` sits in, when it sits in one.
fn bundle_version(driver: &Path) -> Option<String> {
    // Only `<app>/Contents/MacOS/cua-driver`: a debug build's driver sits in
    // `src-tauri/binaries`, two levels under the `Info.plist` Tauri merges in.
    let macos = driver
        .parent()
        .filter(|dir| dir.ends_with("Contents/MacOS"))?;
    let info = macos.parent()?.join("Info.plist");
    short_version(&fs::read_to_string(info).ok()?)
}

fn sha256_of(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

/// Whether `codesign` accepts `path` as validly signed by `team`.
#[cfg(target_os = "macos")]
fn is_signed_by(path: &Path, team: &str) -> bool {
    // The team comes from Zorvo's own pin file, never from outside.
    let requirement =
        format!("-R=anchor apple generic and certificate leaf[subject.OU] = \"{team}\"");
    crate::spawn::command("/usr/bin/codesign")
        .args(["--verify", "--strict", &requirement])
        .arg(path)
        .output()
        .is_ok_and(|output| output.status.success())
}

#[cfg(not(target_os = "macos"))]
fn is_signed_by(_path: &Path, _team: &str) -> bool {
    false
}

/// The checks that need no `codesign`: the app on disk is this Zorvo, and the
/// file is the pinned one. `running` is this Zorvo's version.
pub fn check_file(
    path: &Path,
    pin: &DriverPin,
    bundle: Option<&str>,
    running: &str,
) -> Result<(), DriverUnavailable> {
    if bundle.is_some_and(|version| version != running) {
        return Err(DriverUnavailable::UpdatePending);
    }
    match sha256_of(path) {
        None => Err(DriverUnavailable::Missing),
        Some(hash) if hash != pin.sha256 => Err(DriverUnavailable::Changed),
        Some(_) => Ok(()),
    }
}

/// Checks the driver before a start: nothing starts unless it is the pinned
/// file, signed by the pinned team, in the app this Zorvo runs from. This is a
/// tripwire: what protects the driver is that macOS keeps other processes from
/// changing the app, which an ad-hoc signed Zorvo does not get.
pub fn check(path: &Path, pin: &DriverPin) -> Result<(), DriverUnavailable> {
    if cfg!(debug_assertions) && std::env::var_os(DEBUG_PATH_VARIABLE).is_some() {
        return Ok(());
    }
    check_file(
        path,
        pin,
        bundle_version(path).as_deref(),
        env!("CARGO_PKG_VERSION"),
    )?;
    if is_signed_by(path, &pin.team) {
        Ok(())
    } else {
        Err(DriverUnavailable::Changed)
    }
}

/// `check` for Settings' status line, which is read every time the window gets
/// focus: the answer for a file whose path, size and modification time have
/// not changed is reused, so the 52 MB file is not hashed and `codesign` is
/// not started each time. A start never uses this: it calls `check`.
pub fn check_for_status(path: &Path, pin: &DriverPin) -> Result<(), DriverUnavailable> {
    type Seen = (PathBuf, u64, Option<std::time::SystemTime>);
    static LAST: std::sync::Mutex<Option<(Seen, Result<(), DriverUnavailable>)>> =
        std::sync::Mutex::new(None);
    let Ok(meta) = fs::metadata(path) else {
        return Err(DriverUnavailable::Missing);
    };
    let seen: Seen = (path.to_path_buf(), meta.len(), meta.modified().ok());
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, verdict)) = last.as_ref().filter(|(key, _)| *key == seen) {
        // An update waiting for a restart changes the app's version, not this file.
        if bundle_version(path).is_none_or(|version| version == env!("CARGO_PKG_VERSION")) {
            return *verdict;
        }
    }
    let verdict = check(path, pin);
    *last = Some((seen, verdict));
    verdict
}

/// The driver's whole environment: what it needs and nothing of the user's.
/// `HOME` points into Zorvo's data folder, so the driver reads no
/// configuration an agent could have written to `~/.cua-driver`.
pub fn driver_env(data_dir: &Path) -> Vec<(String, String)> {
    let home = data_dir.join("computer-use").join("driver-home");
    if fs::create_dir_all(&home).is_ok() {
        let _ = fs::set_permissions(&home, fs::Permissions::from_mode(0o700));
    }
    [
        ("PATH", "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
        ("HOME", home.to_string_lossy().into_owned()),
        ("CUA_DRIVER_EMBEDDED", "1".to_string()),
        ("CUA_DRIVER_DISABLE_RUN_SCRIPT", "1".to_string()),
        ("CUA_DRIVER_RS_TELEMETRY_ENABLED", "0".to_string()),
        ("CUA_DRIVER_RS_UPDATE_CHECK", "0".to_string()),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value))
    .collect()
}

/// The command that starts the driver at `path`: not disclaimed, with only
/// `driver_env`. `DriverClient::start` adds the worker's arguments.
pub fn command(path: &Path, data_dir: &Path) -> Command {
    let mut command = crate::spawn::driver_command(path);
    command.env_clear().envs(driver_env(data_dir));
    command
}

/// A fresh id for one start of the worker: 32 hex characters.
pub fn new_generation() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        // The generation only tells one start's lines from another's.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        bytes = nanos.to_le_bytes();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The name of an agent's driver session, which the cursor's badge shows when
/// two or more cursors are on screen. The driver refuses an empty label and a
/// label another live session has, so a second session of one agent gets the
/// lowest free number from 2 ("Qwen Code", "Qwen Code 2").
pub fn session_label(agent_name: &str, taken: &[String]) -> String {
    let cleaned: String = agent_name
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let base: String = if cleaned.is_empty() {
        "Agent".to_string()
    } else {
        cleaned.chars().take(MAX_LABEL_CHARS).collect()
    };
    if !taken.contains(&base) {
        return base;
    }
    (2u32..)
        .map(|number| format!("{base} {number}"))
        .find(|label| !taken.contains(label))
        .unwrap_or(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin_for(path: &Path) -> DriverPin {
        DriverPin {
            version: "0.52.13".into(),
            sha256: sha256_of(path).unwrap(),
            team: "TEAM".into(),
        }
    }

    fn temp_file(name: &str, content: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zorvo-driver-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cua-driver");
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn pin_file_parses_and_is_not_below_the_minimum() {
        let pin = pinned();
        assert_eq!(pin.sha256.len(), 64);
        assert_eq!(pin.team, "YCK386LBJ7");
        let numbers: Vec<u32> = pin.version.split('.').map(|n| n.parse().unwrap()).collect();
        assert!(numbers >= vec![0, 52, 1], "the pin is {}", pin.version);
    }

    #[test]
    fn check_accepts_the_pinned_file() {
        let path = temp_file("same", "driver");
        assert_eq!(check_file(&path, &pin_for(&path), None, "1.0.0"), Ok(()));
    }

    #[test]
    fn check_reports_changed_for_a_different_file() {
        let path = temp_file("changed", "driver");
        let pin = pin_for(&path);
        fs::write(&path, "another driver").unwrap();
        assert_eq!(
            check_file(&path, &pin, None, "1.0.0"),
            Err(DriverUnavailable::Changed)
        );
    }

    #[test]
    fn check_reports_missing_for_no_file() {
        let path = temp_file("missing", "driver");
        let pin = pin_for(&path);
        fs::remove_file(&path).unwrap();
        assert_eq!(
            check_file(&path, &pin, None, "1.0.0"),
            Err(DriverUnavailable::Missing)
        );
    }

    #[test]
    fn check_reports_update_pending_for_another_version() {
        let path = temp_file("pending", "driver");
        let pin = pin_for(&path);
        assert_eq!(
            check_file(&path, &pin, Some("1.0.1"), "1.0.0"),
            Err(DriverUnavailable::UpdatePending)
        );
        assert_eq!(check_file(&path, &pin, Some("1.0.0"), "1.0.0"), Ok(()));
    }

    #[test]
    fn only_a_driver_inside_an_app_bundle_has_a_bundle_version() {
        let root = std::env::temp_dir().join(format!("zorvo-bundle-{}", std::process::id()));
        let plist = "<dict><key>CFBundleShortVersionString</key><string>9.9.9</string></dict>";
        // A debug build's layout: src-tauri/Info.plist and src-tauri/binaries/cua-driver.
        let binaries = root.join("src-tauri/binaries");
        fs::create_dir_all(&binaries).unwrap();
        fs::write(root.join("src-tauri/Info.plist"), plist).unwrap();
        assert_eq!(bundle_version(&binaries.join("cua-driver")), None);
        // An app bundle's layout.
        let macos = root.join("Zorvo.app/Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        fs::write(root.join("Zorvo.app/Contents/Info.plist"), plist).unwrap();
        assert_eq!(
            bundle_version(&macos.join("cua-driver")).as_deref(),
            Some("9.9.9")
        );
    }

    #[test]
    fn the_status_check_reuses_its_answer_until_the_file_changes() {
        let path = temp_file("status", "driver");
        let pin = pin_for(&path);
        // Not signed by the pinned team, so the full check says changed, twice.
        assert_eq!(
            check_for_status(&path, &pin),
            Err(DriverUnavailable::Changed)
        );
        assert_eq!(
            check_for_status(&path, &pin),
            Err(DriverUnavailable::Changed)
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(
            check_for_status(&path, &pin),
            Err(DriverUnavailable::Missing)
        );
    }

    #[test]
    fn short_version_reads_an_info_plist() {
        let plist = "<dict>\n<key>CFBundleShortVersionString</key>\n\t<string>0.14.1</string>\n\
                     <key>CFBundleVersion</key><string>7</string></dict>";
        assert_eq!(short_version(plist).as_deref(), Some("0.14.1"));
        assert_eq!(short_version("<dict></dict>"), None);
    }

    #[test]
    fn driver_env_holds_exactly_the_listed_variables() {
        let data = std::env::temp_dir().join(format!("zorvo-driver-env-{}", std::process::id()));
        let env = driver_env(&data);
        let names: Vec<&str> = env.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            [
                "PATH",
                "HOME",
                "CUA_DRIVER_EMBEDDED",
                "CUA_DRIVER_DISABLE_RUN_SCRIPT",
                "CUA_DRIVER_RS_TELEMETRY_ENABLED",
                "CUA_DRIVER_RS_UPDATE_CHECK",
            ]
        );
        let home = data.join("computer-use/driver-home");
        assert_eq!(env[1].1, home.to_string_lossy());
        assert_eq!(
            fs::metadata(&home).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn session_label_numbers_a_second_session_of_one_agent() {
        assert_eq!(session_label("Qwen Code", &[]), "Qwen Code");
        let taken = vec!["Qwen Code".to_string()];
        assert_eq!(session_label("Qwen Code", &taken), "Qwen Code 2");
        let taken = vec!["Qwen Code".to_string(), "Qwen Code 2".to_string()];
        assert_eq!(session_label("Qwen Code", &taken), "Qwen Code 3");
        let taken = vec!["Qwen Code 2".to_string()];
        assert_eq!(session_label("Qwen Code", &taken), "Qwen Code");
    }

    #[test]
    fn session_label_is_never_empty_and_holds_no_control_characters() {
        assert_eq!(session_label("  ", &[]), "Agent");
        assert_eq!(session_label("Qwen\u{7}\n Code", &[]), "Qwen Code");
        assert_eq!(session_label(&"x".repeat(90), &[]).chars().count(), 40);
    }

    #[test]
    fn generations_differ_and_fit_the_workers_rule() {
        let (first, second) = (new_generation(), new_generation());
        assert_ne!(first, second);
        assert!(first.len() <= 128 && first.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
