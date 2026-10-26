//! Zorvo's own updates. The backend asks the `latest.json` named in
//! `tauri.conf.json` (`plugins.updater.endpoints`, the public releases
//! repository) whether a newer version exists, and installs it only after the
//! user clicks **Update & restart**. The UI sends no URL or argument: the
//! endpoint, the public key that must have signed the download and the update
//! to install all live here.
//!
//! Installing and restarting are two commands. The restart ends the process
//! without closing the window, so the page's `pagehide` handlers never run: it
//! writes what it still holds between the two calls.

use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use url::Url;

/// Progress of an install, sent while `app_update_install` runs.
pub const APP_UPDATE_PROGRESS: &str = "app-update-progress";

/// Emit at most this often when the download size is unknown.
const UNKNOWN_SIZE_STEP: u64 = 256 * 1024;

/// Whole-request limit for the check (`latest.json` is a few KB). It applies to the check only:
/// the `Update` it returns carries no timeout of its own.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// DNS, TCP and TLS handshake together.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Longest silence while waiting for the answer's headers or between two pieces of its body. It
/// starts over with every piece, so a slow connection still finishes, while one that stops
/// sending fails instead of leaving the banner on "Updating…" until Zorvo is quit.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Limit for the whole download, for a server that keeps sending a few bytes at a time (the
/// package is about 13 MB, so this still allows a connection of about 11 KB/s).
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Where a Zorvo update may be downloaded from: this project's releases repository, on GitHub's
/// two hosts. `tauri-action` writes `https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>`
/// into `latest.json`; a hand-written manifest would use
/// `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`. GitHub sends either on to
/// its own download host. The signature, not the host, is what makes the bytes trustworthy: this
/// only keeps a doctored manifest from pointing Zorvo at some other server. Renaming or moving
/// the repository needs a release that accepts both names first, since installed copies carry
/// this list.
const ALLOWED_DOWNLOADS: [(&str, &str); 2] = [
    ("api.github.com", "/repos/zakyirsyaad/zorvo-releases/"),
    ("github.com", "/zakyirsyaad/zorvo-releases/"),
];

/// What the UI is told about a newer version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppUpdateInfo {
    pub version: String,
}

impl AppUpdateInfo {
    fn from_update(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
        }
    }
}

/// The payload of an `app-update-progress` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum AppUpdateProgress {
    /// Bytes received so far; `total` is unknown when the server sent no length.
    Downloading { downloaded: u64, total: Option<u64> },
    /// The download is complete; its signature is checked and the update put in place next.
    Installing,
}

/// The update `app_update_check` found, kept for `app_update_install`.
#[derive(Default)]
pub struct PendingAppUpdate {
    update: Mutex<Option<Update>>,
    /// Held for as long as an install runs. A second call, from a page that was reloaded
    /// meanwhile, waits for the first instead of starting another download, and the lock is
    /// given back on every path, so an install that failed or was abandoned can be tried again.
    install: tokio::sync::Mutex<()>,
    installed: AtomicBool,
}

impl PendingAppUpdate {
    /// Keeps what a check found. While an install runs and once it is done, the update it works
    /// on is not swapped or cleared by a later check.
    fn remember(&self, update: Option<Update>) {
        if self.is_installing() || self.is_installed() {
            return;
        }
        if let Ok(mut slot) = self.update.lock() {
            *slot = update;
        }
    }

    fn pending(&self) -> Option<Update> {
        self.update.lock().ok().and_then(|slot| slot.clone())
    }

    /// Waits for any install in progress, then takes its place until the guard is dropped.
    async fn begin_install(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.install.lock().await
    }

    fn is_installing(&self) -> bool {
        self.install.try_lock().is_err()
    }

    fn mark_installed(&self) {
        self.installed.store(true, Ordering::SeqCst);
    }

    fn is_installed(&self) -> bool {
        self.installed.load(Ordering::SeqCst)
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
    /// Adds a chunk; returns the progress to report, if it moved enough. A total of zero counts
    /// as unknown, in the payload too.
    fn add(&mut self, chunk: u64, total: Option<u64>) -> Option<AppUpdateProgress> {
        let total = total.filter(|total| *total > 0);
        self.downloaded += chunk;
        let bucket = match total {
            Some(total) => self.downloaded.saturating_mul(100) / total,
            None => self.downloaded / UNKNOWN_SIZE_STEP,
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

/// Whether `exe` sits inside an app bundle: `<name>.app/Contents/MacOS/<exe>`. The updater swaps
/// out the bundle it finds that way, or else the folder holding the executable, which for
/// `pnpm tauri dev` or a bare `target/release/zorvo` is a cargo build folder (shared by every
/// worktree on the maintainer's Mac) that the install would delete.
fn runs_from_app_bundle(exe: &Path) -> bool {
    let mut up = exe.ancestors().skip(1); // MacOS, Contents, <name>.app
    matches!(
        (up.next(), up.next(), up.next()),
        (Some(macos), Some(contents), Some(bundle))
            if macos.file_name().is_some_and(|name| name == "MacOS")
                && contents.file_name().is_some_and(|name| name == "Contents")
                && bundle.extension().is_some_and(|extension| extension == "app")
    )
}

/// The same executable path the updater uses to choose what to replace. Tauri does not give one
/// when a folder above the executable is a symlink (Zorvo started through `/usr/local/bin/zorvo`,
/// say); the updater cannot work then either, so this says why on stderr and answers no.
fn is_installed_app() -> bool {
    match tauri::utils::platform::current_exe() {
        Ok(exe) => runs_from_app_bundle(&exe),
        Err(error) => {
            eprintln!(
                "Zorvo cannot tell where it runs from, so it will not update itself: {error}"
            );
            false
        }
    }
}

const NOT_AN_APP_BUNDLE: &str = "Zorvo can only update itself when it runs from its app bundle.";

/// True for an https URL on `api.github.com` or `github.com` whose path starts inside the
/// releases repository. GitHub ignores the case of owner and repository names, so this does too.
fn is_allowed_download_url(url: &Url) -> bool {
    if url.scheme() != "https" || url.port().is_some() {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let path = url.path().to_ascii_lowercase();
    ALLOWED_DOWNLOADS
        .iter()
        .any(|(host, prefix)| url.host_str() == Some(*host) && path.starts_with(prefix))
}

/// The updater from `tauri.conf.json`, with a bounded wait on the network: the plugin sets no
/// timeout of its own and the check and the download both use this client.
fn updater(app: &AppHandle) -> Result<Updater, String> {
    app.updater_builder()
        .timeout(CHECK_TIMEOUT)
        // Kept in the updater and handed on to every `Update`, so the download uses it too.
        .configure_client(|client| {
            client
                .https_only(true)
                .connect_timeout(CONNECT_TIMEOUT)
                .read_timeout(READ_TIMEOUT)
        })
        .build()
        .map_err(|error| format!("Could not set up the update check: {error}"))
}

/// Asks the releases repository for a newer version and remembers it. Returns `None` when this
/// version is the newest, when the update would download from outside the releases repository,
/// and always outside an app bundle.
#[tauri::command]
pub async fn app_update_check(
    app: AppHandle,
    pending: State<'_, PendingAppUpdate>,
) -> Result<Option<AppUpdateInfo>, String> {
    if !is_installed_app() {
        return Ok(None);
    }
    let found = updater(&app)?.check().await.map_err(|error| {
        // The page keeps quiet about this (being offline is normal). Run from a terminal, Zorvo
        // says here why a feed that stopped working offers nothing; a Finder launch discards stderr.
        eprintln!("Could not check for a newer Zorvo: {error}");
        format!("Could not check for updates: {error}")
    })?;
    // The manifest is not signed, only the package is: an update that downloads from anywhere but
    // the releases repository is not offered and not remembered for the install. It counts as no
    // update, not as a failed check: the page drops an earlier banner and waits a day to ask
    // again, instead of retrying every few minutes for something that will not change.
    if let Some(update) = found
        .as_ref()
        .filter(|update| !is_allowed_download_url(&update.download_url))
    {
        eprintln!(
            "Refused a Zorvo update that downloads from {}",
            update.download_url
        );
        pending.remember(None);
        return Ok(None);
    }
    let info = found.as_ref().map(AppUpdateInfo::from_update);
    pending.remember(found);
    Ok(info)
}

/// Downloads the update `app_update_check` found, checks its signature against
/// the public key in the app's config and puts it in place. It does not restart:
/// the page writes what it still holds first, then calls `app_update_restart`.
/// Calling it again after a successful install does nothing.
#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    pending: State<'_, PendingAppUpdate>,
) -> Result<(), String> {
    if !is_installed_app() {
        return Err(NOT_AN_APP_BUNDLE.to_string());
    }
    if pending.is_installed() {
        return Ok(());
    }
    // A second call, from a page that was reloaded while the first runs, waits for it and then
    // finds the update installed.
    let _install = pending.begin_install().await;
    if pending.is_installed() {
        return Ok(());
    }
    let Some(mut update) = pending.pending() else {
        return Err("There is no update to install. Check again.".to_string());
    };
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    download_and_install(&app, &update).await?;
    pending.mark_installed();
    Ok(())
}

/// Restarts Zorvo into the update `app_update_install` put in place.
#[tauri::command]
pub async fn app_update_restart(
    app: AppHandle,
    pending: State<'_, PendingAppUpdate>,
) -> Result<(), String> {
    if !pending.is_installed() {
        return Err("There is no installed update to restart into.".to_string());
    }
    // Runs from a worker thread, so this asks the event loop to exit (which ends the workspace
    // shells in `RunEvent::Exit`) and then relaunches.
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
        .map_err(|error| {
            eprintln!("Could not install a Zorvo update: {error}");
            install_error(&error)
        })
}

/// The text the user sees when the install fails; the whole error goes to stderr.
fn install_error(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        // A copy run from a mounted disk image: the package is downloaded and verified, then
        // there is nowhere to write it.
        Error::Io(io) if io.kind() == ErrorKind::ReadOnlyFilesystem => {
            "Zorvo is running from a disk image or another read-only place, so it cannot update \
             itself. Drag Zorvo into Applications, open it from there and try again."
                .to_string()
        }
        Error::Reqwest(request) if request.is_timeout() => {
            "The download stopped or took too long. Check your connection and try again."
                .to_string()
        }
        Error::Reqwest(request) => format!(
            "Could not download the update: {}. Check your connection and try again.",
            without_url(&request.to_string())
        ),
        // The plugin wraps this one in backticks.
        other => format!(
            "Could not install the update: {}",
            other.to_string().trim_matches('`')
        ),
    }
}

/// A network error's text without its trailing " for url (…)": the address is a pre-signed
/// download link, which means nothing to the user.
fn without_url(text: &str) -> &str {
    text.split(" for url (").next().unwrap_or(text)
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
        // Reported as unknown, and then throttled by size like any unknown total.
        let mut throttle = ProgressThrottle::default();
        assert_eq!(
            throttle.add(10, Some(0)),
            Some(AppUpdateProgress::Downloading {
                downloaded: 10,
                total: None
            })
        );
        assert!(throttle.add(10, Some(0)).is_none());
        assert!(throttle.add(UNKNOWN_SIZE_STEP, Some(0)).is_some());
    }

    #[tokio::test]
    async fn a_second_install_waits_until_the_first_has_ended() {
        let pending = PendingAppUpdate::default();
        let first = pending.begin_install().await;
        assert!(pending.is_installing());
        let waits =
            |millis| tokio::time::timeout(Duration::from_millis(millis), pending.begin_install());
        assert!(waits(50).await.is_err());

        drop(first);
        assert!(!pending.is_installing());
        assert!(waits(500).await.is_ok());
    }

    #[tokio::test]
    async fn an_install_that_failed_leaves_nothing_installed() {
        // The lock goes back when its guard is dropped, whatever ended the install, and only a
        // finished install marks the update as installed.
        let pending = PendingAppUpdate::default();
        drop(pending.begin_install().await);
        assert!(!pending.is_installed());
        assert!(!pending.is_installing());
    }

    #[tokio::test]
    async fn a_panic_during_an_install_does_not_leave_the_lock_held() {
        let pending = std::sync::Arc::new(PendingAppUpdate::default());
        let worker = {
            let pending = pending.clone();
            tokio::spawn(async move {
                let _install = pending.begin_install().await;
                panic!("the plugin panicked");
            })
        };
        assert!(worker.await.is_err());
        assert!(!pending.is_installing());
    }

    #[test]
    fn an_installed_update_is_remembered_until_the_process_ends() {
        let pending = PendingAppUpdate::default();
        assert!(!pending.is_installed());
        pending.mark_installed();
        assert!(pending.is_installed());
    }

    #[test]
    fn nothing_is_pending_before_a_check_finds_an_update() {
        assert!(PendingAppUpdate::default().pending().is_none());
    }

    #[test]
    fn only_a_binary_inside_an_app_bundle_may_update_itself() {
        let installed = [
            "/Applications/Zorvo.app/Contents/MacOS/zorvo",
            "/Users/mac/Applications/Zorvo.app/Contents/MacOS/zorvo",
            "/t/debug/bundle/macos/Zorvo.app/Contents/MacOS/zorvo",
        ];
        for path in installed {
            assert!(runs_from_app_bundle(Path::new(path)), "{path}");
        }
        let not_installed = [
            // `pnpm tauri dev` and `cargo run`: the cargo build folder would be swapped out.
            "/Users/mac/Library/Caches/zorvo-target/debug/zorvo",
            "/repo/src-tauri/target/release/zorvo",
            "/Users/mac/Downloads/zorvo",
            "/usr/local/bin/zorvo",
            // Close, but not a bundle layout.
            "/Applications/Zorvo.app/zorvo",
            "/Applications/Zorvo.app/Contents/zorvo",
            "/Applications/Zorvo/Contents/MacOS/zorvo",
            "zorvo",
            "",
        ];
        for path in not_installed {
            assert!(!runs_from_app_bundle(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn a_read_only_volume_gets_an_actionable_message() {
        let read_only =
            tauri_plugin_updater::Error::Io(std::io::Error::from(ErrorKind::ReadOnlyFilesystem));
        let message = install_error(&read_only);
        assert!(message.contains("disk image"), "{message}");
        assert!(message.contains("Applications"), "{message}");
    }

    #[test]
    fn other_install_errors_keep_their_cause() {
        let other = tauri_plugin_updater::Error::Io(std::io::Error::from(ErrorKind::NotFound));
        let message = install_error(&other);
        assert!(
            message.starts_with("Could not install the update: "),
            "{message}"
        );
    }

    #[test]
    fn a_failed_download_shows_its_cause_without_the_plugins_backticks() {
        let status = tauri_plugin_updater::Error::Network(
            "Download request failed with status: 403 Forbidden".to_string(),
        );
        assert_eq!(
            install_error(&status),
            "Could not install the update: Download request failed with status: 403 Forbidden"
        );
    }

    #[test]
    fn a_network_error_loses_its_pre_signed_address() {
        assert_eq!(
            without_url("error sending request for url (https://x.example/a?sig=1)"),
            "error sending request"
        );
        assert_eq!(
            without_url("request or response body error"),
            "request or response body error"
        );
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

    #[test]
    fn the_update_info_names_only_the_version() {
        let info = AppUpdateInfo {
            version: "0.6.0".to_string(),
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "version": "0.6.0" })
        );
    }

    fn allowed(url: &str) -> bool {
        is_allowed_download_url(&Url::parse(url).unwrap())
    }

    #[test]
    fn a_download_from_the_releases_repository_is_allowed() {
        // The asset URL `tauri-action` writes into `latest.json`, and the website form.
        assert!(allowed(
            "https://api.github.com/repos/zakyirsyaad/zorvo-releases/releases/assets/674789428"
        ));
        assert!(allowed(
            "https://github.com/zakyirsyaad/zorvo-releases/releases/download/v0.6.0/Zorvo_0.6.0_universal.app.tar.gz"
        ));
        assert!(allowed(
            "https://github.com/zakyirsyaad/zorvo-releases/releases/latest/download/Zorvo.app.tar.gz"
        ));
    }

    #[test]
    fn the_case_of_the_owner_and_the_repository_does_not_matter() {
        assert!(allowed(
            "https://api.github.com/repos/Zakyirsyaad/Zorvo-Releases/releases/assets/1"
        ));
        assert!(allowed(
            "HTTPS://GitHub.com/zakyirsyaad/zorvo-releases/releases/download/v1/a"
        ));
    }

    #[test]
    fn a_download_that_is_not_https_is_refused() {
        assert!(!allowed(
            "http://github.com/zakyirsyaad/zorvo-releases/releases/download/v1/a"
        ));
        assert!(!allowed(
            "http://api.github.com/repos/zakyirsyaad/zorvo-releases/releases/assets/1"
        ));
        assert!(!allowed("ftp://github.com/zakyirsyaad/zorvo-releases/a"));
    }

    #[test]
    fn a_download_from_another_host_is_refused_whatever_its_path() {
        for url in [
            "https://evil.example/zakyirsyaad/zorvo-releases/releases/download/v1/a",
            "https://github.com.evil.example/zakyirsyaad/zorvo-releases/releases/download/v1/a",
            "https://evil.example/https://github.com/zakyirsyaad/zorvo-releases/a",
            "https://uploads.github.com/zakyirsyaad/zorvo-releases/a",
            "https://raw.githubusercontent.com/zakyirsyaad/zorvo-releases/main/a",
            "https://release-assets.githubusercontent.com/zakyirsyaad/zorvo-releases/a",
            "https://github.com./zakyirsyaad/zorvo-releases/releases/download/v1/a",
        ] {
            assert!(!allowed(url), "{url}");
        }
    }

    #[test]
    fn a_download_with_user_info_or_a_port_is_refused() {
        for url in [
            "https://github.com@evil.example/zakyirsyaad/zorvo-releases/releases/download/v1/a",
            "https://user:pw@github.com/zakyirsyaad/zorvo-releases/releases/download/v1/a",
            "https://github.com:8443/zakyirsyaad/zorvo-releases/releases/download/v1/a",
        ] {
            assert!(!allowed(url), "{url}");
        }
    }

    #[test]
    fn a_download_from_another_owner_or_repository_is_refused() {
        for url in [
            // A plain "path contains zakyirsyaad/zorvo-releases/" test would accept this one.
            "https://github.com/evil-zakyirsyaad/zorvo-releases/releases/download/v1/a",
            "https://github.com/zakyirsyaad/zorvo-releases-fork/releases/download/v1/a",
            "https://github.com/evil/x/zakyirsyaad/zorvo-releases/releases/download/v1/a",
            "https://github.com/zakyirsyaad/zorvo/releases/download/v1/a",
            "https://api.github.com/repos/zakyirsyaad/zorvo/releases/assets/1",
            "https://api.github.com/repos/evil/zorvo-releases/releases/assets/1",
            // "/repos/" belongs to the API host only.
            "https://api.github.com/zakyirsyaad/zorvo-releases/releases/assets/1",
            "https://github.com/repos/zakyirsyaad/zorvo-releases/releases/assets/1",
            // The repository itself, with nothing after it.
            "https://api.github.com/repos/zakyirsyaad/zorvo-releases",
        ] {
            assert!(!allowed(url), "{url}");
        }
    }

    #[test]
    fn a_path_that_climbs_out_of_the_repository_is_refused() {
        for url in [
            "https://github.com/zakyirsyaad/zorvo-releases/../evil/repo/releases/download/v1/a",
            "https://github.com/zakyirsyaad/zorvo-releases/%2e%2e/evil/repo/a",
            "https://github.com/zakyirsyaad/zorvo-releases/%2E%2E/%2E%2E/evil/repo/a",
            "https://github.com/zakyirsyaad/zorvo-releases\\..\\evil\\repo\\a",
            "https://github.com/zakyirsyaad/zorvo-releases%2Fa",
        ] {
            assert!(!allowed(url), "{url}");
        }
    }

    #[test]
    fn the_configured_endpoint_is_in_the_allowed_repository() {
        // The list above and the endpoint in the app's config must name the same repository: if
        // one is changed without the other, no update would ever be offered.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let endpoint = config["plugins"]["updater"]["endpoints"][0]
            .as_str()
            .expect("an updater endpoint in tauri.conf.json");
        assert!(allowed(endpoint), "{endpoint}");
    }
}
