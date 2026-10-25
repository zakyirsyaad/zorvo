//! Zorvo's own updates. The backend asks the `latest.json` named in
//! `tauri.conf.json` (`plugins.updater.endpoints`, the public releases
//! repository) whether a newer version exists, and installs it only after the
//! user clicks **Update & restart**. The UI sends no URL or argument: the
//! endpoint, the public key that must have signed the download and the update
//! to install all live here.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Progress of an install, sent while `app_update_install` runs.
pub const APP_UPDATE_PROGRESS: &str = "app-update-progress";

/// Emit at most this often when the download size is unknown.
const UNKNOWN_SIZE_STEP: u64 = 256 * 1024;

/// What the UI is told about a newer version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppUpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

impl AppUpdateInfo {
    fn from_update(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
            date: update.date.map(|date| date.to_string()),
        }
    }
}

/// The payload of an `app-update-progress` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum AppUpdateProgress {
    /// Bytes received so far; `total` is unknown when the server sent no length.
    Downloading { downloaded: u64, total: Option<u64> },
    /// The download is verified and being put in place; the app restarts next.
    Installing,
}

/// The update `app_update_check` found, kept for `app_update_install`.
#[derive(Default)]
pub struct PendingAppUpdate {
    update: Mutex<Option<Update>>,
    installing: AtomicBool,
}

impl PendingAppUpdate {
    fn remember(&self, update: Option<Update>) {
        if let Ok(mut slot) = self.update.lock() {
            *slot = update;
        }
    }

    fn pending(&self) -> Option<Update> {
        self.update.lock().ok().and_then(|slot| slot.clone())
    }

    /// Claims the install; false when one is already running.
    fn begin_install(&self) -> bool {
        self.installing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn end_install(&self) {
        self.installing.store(false, Ordering::SeqCst);
    }
}

/// Decides which chunks of a download are worth an event: one per percent when
/// the size is known, one per `UNKNOWN_SIZE_STEP` otherwise.
#[derive(Default)]
struct ProgressThrottle {
    downloaded: u64,
    last_reported: Option<u64>,
}

impl ProgressThrottle {
    /// Adds a chunk; returns the progress to report, if it moved enough.
    fn add(&mut self, chunk: u64, total: Option<u64>) -> Option<AppUpdateProgress> {
        self.downloaded += chunk;
        let bucket = match total {
            Some(total) if total > 0 => self.downloaded.saturating_mul(100) / total,
            _ => self.downloaded / UNKNOWN_SIZE_STEP,
        };
        if self.last_reported == Some(bucket) {
            return None;
        }
        self.last_reported = Some(bucket);
        Some(AppUpdateProgress::Downloading {
            downloaded: self.downloaded,
            total,
        })
    }
}

/// Asks the releases repository for a newer version and remembers it. Returns
/// `None` when this version is the newest.
#[tauri::command(async)]
pub async fn app_update_check(
    app: AppHandle,
    pending: State<'_, PendingAppUpdate>,
) -> Result<Option<AppUpdateInfo>, String> {
    let updater = app
        .updater()
        .map_err(|error| format!("Could not set up the update check: {error}"))?;
    let found = updater
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))?;
    let info = found.as_ref().map(AppUpdateInfo::from_update);
    pending.remember(found);
    Ok(info)
}

/// Downloads the update `app_update_check` found, checks its signature against
/// the public key in the app's config, installs it and restarts Zorvo.
#[tauri::command(async)]
pub async fn app_update_install(
    app: AppHandle,
    pending: State<'_, PendingAppUpdate>,
) -> Result<(), String> {
    let Some(update) = pending.pending() else {
        return Err("There is no update to install. Check again.".to_string());
    };
    if !pending.begin_install() {
        return Err("An update is already being installed.".to_string());
    }
    let result = download_and_install(&app, &update).await;
    pending.end_install();
    result?;
    // Runs from a worker thread, so this asks the event loop to exit (which
    // ends the workspace shells in `RunEvent::Exit`) and then relaunches.
    app.restart()
}

async fn download_and_install(app: &AppHandle, update: &Update) -> Result<(), String> {
    let mut throttle = ProgressThrottle::default();
    let progress_app = app.clone();
    let finished_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                if let Some(progress) = throttle.add(chunk as u64, total) {
                    let _ = progress_app.emit(APP_UPDATE_PROGRESS, progress);
                }
            },
            move || {
                let _ = finished_app.emit(APP_UPDATE_PROGRESS, AppUpdateProgress::Installing);
            },
        )
        .await
        .map_err(|error| format!("Could not install the update: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_reports_once_per_percent_when_the_size_is_known() {
        // The first chunk (0 %) and then each percent up to 100 %.
        let mut throttle = ProgressThrottle::default();
        let reported = (0..1000)
            .filter_map(|_| throttle.add(10, Some(10_000)))
            .count();
        assert_eq!(reported, 101);
    }

    #[test]
    fn throttle_reports_the_running_total() {
        let mut throttle = ProgressThrottle::default();
        throttle.add(50, Some(100));
        assert_eq!(
            throttle.add(25, Some(100)),
            Some(AppUpdateProgress::Downloading {
                downloaded: 75,
                total: Some(100)
            })
        );
    }

    #[test]
    fn throttle_steps_by_size_when_the_total_is_unknown() {
        let mut throttle = ProgressThrottle::default();
        assert!(throttle.add(UNKNOWN_SIZE_STEP / 2, None).is_some());
        assert!(throttle.add(UNKNOWN_SIZE_STEP / 4, None).is_none());
        assert!(throttle.add(UNKNOWN_SIZE_STEP, None).is_some());
    }

    #[test]
    fn throttle_treats_a_zero_total_as_unknown() {
        let mut throttle = ProgressThrottle::default();
        assert!(throttle.add(10, Some(0)).is_some());
    }

    #[test]
    fn only_one_install_can_start_until_it_ends() {
        let pending = PendingAppUpdate::default();
        assert!(pending.begin_install());
        assert!(!pending.begin_install());
        pending.end_install();
        assert!(pending.begin_install());
    }

    #[test]
    fn nothing_is_pending_before_a_check_finds_an_update() {
        assert!(PendingAppUpdate::default().pending().is_none());
    }

    #[test]
    fn progress_payloads_carry_their_phase() {
        let downloading = serde_json::to_value(AppUpdateProgress::Downloading {
            downloaded: 5,
            total: None,
        })
        .unwrap();
        assert_eq!(
            downloading,
            serde_json::json!({ "phase": "downloading", "downloaded": 5, "total": null })
        );
        let installing = serde_json::to_value(AppUpdateProgress::Installing).unwrap();
        assert_eq!(installing, serde_json::json!({ "phase": "installing" }));
    }
}
