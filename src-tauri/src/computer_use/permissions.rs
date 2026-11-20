//! Zorvo's own macOS permissions for computer use, and what Settings shows.
//!
//! Zorvo holds Screen Recording and Accessibility; the driver it starts works
//! with them. Zorvo asks macOS only from the user's action in Settings, never
//! from an agent's call and never at launch.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::driver::{self, DriverUnavailable};

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CString};

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: *const c_void;
        static kCFTypeDictionaryKeyCallBacks: [u8; 0];
        static kCFTypeDictionaryValueCallBacks: [u8; 0];
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            text: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(object: *const c_void);
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    const UTF8: u32 = 0x0800_0100;

    pub fn accessibility() -> bool {
        // SAFETY: takes no arguments and only reads this process's trust.
        unsafe { AXIsProcessTrusted() }
    }

    pub fn screen_recording() -> bool {
        // SAFETY: takes no arguments and shows nothing.
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    /// Asks macOS for both, which may show its prompts.
    pub fn request() {
        let Ok(key) = CString::new("AXTrustedCheckOptionPrompt") else {
            return;
        };
        // SAFETY: a one-entry dictionary of the documented prompt option; the
        // key and the dictionary are released after the call, and the value is
        // a constant CoreFoundation owns.
        unsafe {
            let key = CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), UTF8);
            if !key.is_null() {
                let keys = [key];
                let values = [kCFBooleanTrue];
                let options = CFDictionaryCreate(
                    std::ptr::null(),
                    keys.as_ptr(),
                    values.as_ptr(),
                    1,
                    kCFTypeDictionaryKeyCallBacks.as_ptr().cast(),
                    kCFTypeDictionaryValueCallBacks.as_ptr().cast(),
                );
                if !options.is_null() {
                    AXIsProcessTrustedWithOptions(options);
                    CFRelease(options);
                }
                CFRelease(key);
            }
            CGRequestScreenCaptureAccess();
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn accessibility() -> bool {
        false
    }
    pub fn screen_recording() -> bool {
        false
    }
    pub fn request() {}
}

pub use macos::{accessibility, request, screen_recording};

/// The System Settings pane for one permission; `None` for any other name.
pub fn pane_url(pane: &str) -> Option<&'static str> {
    match pane {
        "screen" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        }
        "accessibility" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        }
        _ => None,
    }
}

/// Opens `pane` of System Settings. Refuses a pane it does not know.
pub fn open_pane(pane: &str) -> Result<(), String> {
    let url = pane_url(pane).ok_or("Zorvo does not know that settings pane.")?;
    crate::spawn::command("/usr/bin/open")
        .arg(url)
        .status()
        .ok()
        .filter(|status| status.success())
        .map(|_| ())
        .ok_or_else(|| "System Settings did not open.".to_string())
}

/// Forgets macOS's record of both permissions for `bundle_id`, so macOS asks
/// again. Needed after an update: Zorvo is signed ad hoc, so macOS ties its
/// permissions to the exact build and keeps a stale entry for the old one.
pub fn reset(bundle_id: &str) {
    for service in ["ScreenCapture", "Accessibility"] {
        let _ = crate::spawn::command("/usr/bin/tccutil")
            .args(["reset", service, bundle_id])
            .output();
    }
}

fn allowed_version_file(data_dir: &Path) -> PathBuf {
    data_dir.join("computer-use").join("allowed-version")
}

/// Remembers that this version of Zorvo had both permissions.
pub fn remember_allowed(data_dir: &Path, version: &str) {
    let file = allowed_version_file(data_dir);
    if fs::read_to_string(&file).is_ok_and(|saved| saved.trim() == version) {
        return;
    }
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(file, version);
}

/// The version of Zorvo that last had both permissions, if any did.
pub fn last_allowed_version(data_dir: &Path) -> Option<String> {
    let saved = fs::read_to_string(allowed_version_file(data_dir)).ok()?;
    Some(saved.trim().to_string()).filter(|version| !version.is_empty())
}

/// What Settings shows for computer use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseStatus {
    /// False off macOS: the group is hidden.
    pub available: bool,
    /// macOS lists Zorvo for these permissions only when it runs from Applications.
    pub in_applications: bool,
    /// "ready", "missing", "changed" or "update-pending".
    pub driver: &'static str,
    /// "allowed" or "not-allowed".
    pub screen_recording: &'static str,
    /// "allowed" or "not-allowed".
    pub accessibility: &'static str,
    /// Both permissions were lost to an update: offer "Allow again". Settings
    /// shows it only while its switch is on.
    pub after_update: bool,
    /// Screen Recording was asked for in this run and still reads not allowed:
    /// macOS applies it to Zorvo only after a restart.
    pub restart_hint: bool,
}

/// Everything `status_of` decides from.
#[derive(Debug, Clone, Default)]
pub struct StatusFacts {
    pub in_applications: bool,
    pub driver: Option<DriverUnavailable>,
    pub screen_recording: bool,
    pub accessibility: bool,
    pub asked_screen_recording: bool,
    /// The version that last had both permissions.
    pub last_allowed: Option<String>,
    pub running: String,
}

fn word(allowed: bool) -> &'static str {
    if allowed {
        "allowed"
    } else {
        "not-allowed"
    }
}

pub fn status_of(facts: &StatusFacts) -> ComputerUseStatus {
    let neither = !facts.screen_recording && !facts.accessibility;
    let after_update = neither
        && facts
            .last_allowed
            .as_deref()
            .is_some_and(|version| version != facts.running);
    ComputerUseStatus {
        available: cfg!(target_os = "macos"),
        in_applications: facts.in_applications,
        driver: match facts.driver {
            None => "ready",
            Some(DriverUnavailable::Missing) => "missing",
            Some(DriverUnavailable::Changed) => "changed",
            Some(DriverUnavailable::UpdatePending) => "update-pending",
        },
        screen_recording: word(facts.screen_recording),
        accessibility: word(facts.accessibility),
        after_update,
        restart_hint: facts.asked_screen_recording && !facts.screen_recording && !after_update,
    }
}

/// Whether macOS will list this Zorvo under Screen Recording and
/// Accessibility. Debug builds count: under `pnpm tauri dev` the permissions
/// attach to the terminal that started it.
pub fn runs_from_applications(exe: Option<&Path>) -> bool {
    cfg!(debug_assertions) || exe.is_some_and(|path| path.starts_with("/Applications/"))
}

/// Reads the facts from this process and this Mac.
pub fn read_status(data_dir: &Path, asked_screen_recording: bool) -> ComputerUseStatus {
    let running = env!("CARGO_PKG_VERSION");
    let (screen, accessible) = (screen_recording(), accessibility());
    if screen && accessible {
        remember_allowed(data_dir, running);
    }
    let driver = driver::locate()
        .and_then(|path| driver::check_for_status(&path, driver::pinned()))
        .err();
    status_of(&StatusFacts {
        in_applications: runs_from_applications(std::env::current_exe().ok().as_deref()),
        driver,
        screen_recording: screen,
        accessibility: accessible,
        asked_screen_recording,
        last_allowed: last_allowed_version(data_dir),
        running: running.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> StatusFacts {
        StatusFacts {
            in_applications: true,
            driver: None,
            screen_recording: true,
            accessibility: true,
            asked_screen_recording: false,
            last_allowed: Some("1.0.0".into()),
            running: "1.0.0".into(),
        }
    }

    #[test]
    fn status_reads_ready_with_both_permissions() {
        let status = status_of(&facts());
        assert_eq!(status.driver, "ready");
        assert_eq!(status.screen_recording, "allowed");
        assert_eq!(status.accessibility, "allowed");
        assert!(!status.after_update && !status.restart_hint);
    }

    #[test]
    fn status_reads_update_pending() {
        let status = status_of(&StatusFacts {
            driver: Some(DriverUnavailable::UpdatePending),
            ..facts()
        });
        assert_eq!(status.driver, "update-pending");
    }

    #[test]
    fn status_names_a_changed_and_a_missing_driver() {
        let changed = StatusFacts {
            driver: Some(DriverUnavailable::Changed),
            ..facts()
        };
        assert_eq!(status_of(&changed).driver, "changed");
        let missing = StatusFacts {
            driver: Some(DriverUnavailable::Missing),
            ..facts()
        };
        assert_eq!(status_of(&missing).driver, "missing");
    }

    #[test]
    fn both_permissions_lost_after_another_version_had_them_reads_after_update() {
        let lost = StatusFacts {
            screen_recording: false,
            accessibility: false,
            running: "1.0.1".into(),
            ..facts()
        };
        assert!(status_of(&lost).after_update);
        // The same version never had them taken by an update.
        let same = StatusFacts {
            running: "1.0.0".into(),
            ..lost.clone()
        };
        assert!(!status_of(&same).after_update);
        // Never allowed before: a first setup, not an update.
        let first = StatusFacts {
            last_allowed: None,
            ..lost
        };
        assert!(!status_of(&first).after_update);
    }

    #[test]
    fn restart_hint_shows_only_after_asking_while_still_not_allowed() {
        let asked = StatusFacts {
            screen_recording: false,
            asked_screen_recording: true,
            ..facts()
        };
        assert!(status_of(&asked).restart_hint);
        let not_asked = StatusFacts {
            asked_screen_recording: false,
            ..asked.clone()
        };
        assert!(!status_of(&not_asked).restart_hint);
        let allowed = StatusFacts {
            screen_recording: true,
            ..asked
        };
        assert!(!status_of(&allowed).restart_hint);
    }

    #[test]
    fn only_the_two_known_panes_open() {
        assert!(pane_url("screen").is_some_and(|url| url.ends_with("Privacy_ScreenCapture")));
        assert!(pane_url("accessibility").is_some_and(|url| url.ends_with("Privacy_Accessibility")));
        assert_eq!(pane_url("x-apple.systempreferences:anything"), None);
        assert!(open_pane("../etc").is_err());
    }

    #[test]
    fn allowed_version_is_remembered_per_data_dir() {
        let dir = std::env::temp_dir().join(format!("zorvo-allowed-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(last_allowed_version(&dir), None);
        remember_allowed(&dir, "0.14.1");
        assert_eq!(last_allowed_version(&dir).as_deref(), Some("0.14.1"));
        remember_allowed(&dir, "0.15.0");
        assert_eq!(last_allowed_version(&dir).as_deref(), Some("0.15.0"));
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn a_release_build_outside_applications_is_refused() {
        assert!(!runs_from_applications(Some(Path::new(
            "/Users/me/Downloads/Zorvo.app/Contents/MacOS/zorvo"
        ))));
        assert!(runs_from_applications(Some(Path::new(
            "/Applications/Zorvo.app/Contents/MacOS/zorvo"
        ))));
    }
}
