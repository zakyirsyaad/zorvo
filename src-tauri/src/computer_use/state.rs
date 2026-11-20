//! What the backend holds for computer use: whether it is on, and the one
//! driver every session shares.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use super::driver::{self, DriverUnavailable};
use super::worker::{DriverClient, DriverError, StartOptions};

/// Why a driver could not be handed out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoDriver {
    /// The switch in Settings is off.
    Off,
    /// The driver file cannot be used (missing, changed, update pending).
    Unavailable(DriverUnavailable),
    /// The driver did not start or does not speak Zorvo's protocol.
    Failed(DriverError),
}

/// Starts a driver. The real one checks the pinned file first; tests start the
/// fake driver.
pub type DriverStarter = Box<dyn Fn() -> Result<Arc<DriverClient>, NoDriver> + Send + Sync>;

pub struct ComputerUse {
    data_dir: PathBuf,
    /// The saved switch, kept in memory because every call reads it.
    enabled: Arc<AtomicBool>,
    /// Shared, so a switch-off that finds the lock held can finish from a thread.
    driver: Arc<Mutex<Option<Arc<DriverClient>>>>,
    starter: DriverStarter,
    /// The user asked macOS for Screen Recording in this run of Zorvo.
    asked_screen_recording: AtomicBool,
}

fn start_pinned(data_dir: &Path) -> Result<Arc<DriverClient>, NoDriver> {
    let path = driver::locate().map_err(NoDriver::Unavailable)?;
    let pin = driver::pinned();
    driver::check(&path, pin).map_err(NoDriver::Unavailable)?;
    DriverClient::start(
        driver::command(&path, data_dir),
        StartOptions {
            generation: driver::new_generation(),
            host_bundle_id: driver::HOST_BUNDLE_ID,
            driver_version: Some(&pin.version),
        },
    )
    .map_err(NoDriver::Failed)
}

impl ComputerUse {
    pub fn new(data_dir: PathBuf, enabled: bool) -> Self {
        let for_starter = data_dir.clone();
        Self::with_starter(
            data_dir,
            enabled,
            Box::new(move || start_pinned(&for_starter)),
        )
    }

    pub fn with_starter(data_dir: PathBuf, enabled: bool, starter: DriverStarter) -> Self {
        Self {
            data_dir,
            enabled: Arc::new(AtomicBool::new(enabled)),
            driver: Arc::new(Mutex::new(None)),
            starter,
            asked_screen_recording: AtomicBool::new(false),
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    /// Follows the saved switch. Turning it off stops computer use at once:
    /// the driver is killed, which ends every call in flight.
    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Release);
        if on {
            return;
        }
        // Never wait here: this runs inside every state save, and a driver
        // that is starting holds the lock for up to its startup timeout.
        let running = match self.driver.try_lock() {
            Ok(mut slot) => slot.take(),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner().take(),
            Err(std::sync::TryLockError::WouldBlock) => {
                // `driver()` holds the lock and may be about to hand out a
                // driver it checked the switch for a moment ago. Finish once
                // it lets go, unless the switch is back on by then.
                let slot = Arc::clone(&self.driver);
                let enabled = Arc::clone(&self.enabled);
                std::thread::spawn(move || {
                    let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
                    if enabled.load(Ordering::Acquire) {
                        return;
                    }
                    if let Some(client) = slot.take() {
                        client.kill();
                    }
                });
                None
            }
        };
        if let Some(client) = running {
            client.kill();
        }
    }

    fn slot(&self) -> MutexGuard<'_, Option<Arc<DriverClient>>> {
        self.driver.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The running driver, started when there is none or the last one ended.
    pub fn driver(&self) -> Result<Arc<DriverClient>, NoDriver> {
        if !self.is_enabled() {
            return Err(NoDriver::Off);
        }
        let mut slot = self.slot();
        // Again under the lock: `set_enabled(false)` may have run since the
        // check above and found no driver to stop.
        if !self.is_enabled() {
            return Err(NoDriver::Off);
        }
        if let Some(client) = slot.as_ref().filter(|client| client.is_alive()) {
            return Ok(Arc::clone(client));
        }
        let client = (self.starter)()?;
        // The switch went off while the driver started: `set_enabled` did not
        // wait for this lock, so the new driver ends here.
        if !self.is_enabled() {
            client.kill();
            return Err(NoDriver::Off);
        }
        *slot = Some(Arc::clone(&client));
        Ok(client)
    }

    /// Kills the driver, if one runs. The next `driver()` starts a new one.
    pub fn stop_driver(&self) {
        if let Some(client) = self.slot().take() {
            client.kill();
        }
    }

    pub fn note_screen_recording_asked(&self) {
        self.asked_screen_recording.store(true, Ordering::Release);
    }

    pub fn asked_screen_recording(&self) -> bool {
        self.asked_screen_recording.load(Ordering::Acquire)
    }
}
