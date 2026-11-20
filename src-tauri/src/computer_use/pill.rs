//! The pill: a small Zorvo window that stays on top of every app and every
//! Space while an agent uses an app, and for a few seconds after. The agent
//! cursor sits on the window the agent acts on, which the user's own windows
//! can cover; the pill is the sign that shows whatever is in front, and its
//! Stop works from there.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "computer-use-pill";
const PAGE: &str = "index.html?pill=1";
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 40.0;
/// Under the menu bar of the main display.
const TOP: f64 = 34.0;
/// How long the pill stays after the last thing an agent did ended.
pub const LINGER: Duration = Duration::from_secs(5);

/// The newest thing an agent did, which the pill's page reads when it loads
/// (its window is made on the first action, after that action's event).
#[derive(Default)]
pub struct Pill {
    latest: Mutex<Option<Value>>,
    /// Counts actions and hides, so the one thread that waits to hide the
    /// pill sees anything that happened while it slept.
    turn: AtomicU64,
    /// A thread is waiting to hide the pill.
    is_waiting: AtomicBool,
    /// Reads the driver is still running: the pill stays while there are any.
    active: AtomicU64,
}

impl Pill {
    pub fn latest(&self) -> Option<Value> {
        self.latest
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn set(&self, activity: Option<Value>) -> u64 {
        *self.latest.lock().unwrap_or_else(|e| e.into_inner()) = activity;
        self.turn.fetch_add(1, Ordering::AcqRel) + 1
    }

    fn is_busy(&self) -> bool {
        self.active.load(Ordering::Acquire) > 0
    }

    /// A read ended. Counts down, never below nothing.
    fn finish_one(&self) {
        let mut active = self.active.load(Ordering::Acquire);
        while active > 0 {
            let counted = self.active.compare_exchange_weak(
                active,
                active - 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
            match counted {
                Ok(_) => break,
                Err(now) => active = now,
            }
        }
        // The wait to hide starts again from here.
        self.turn.fetch_add(1, Ordering::AcqRel);
    }
}

fn place_and_show(app: &AppHandle) {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => {
            let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(PAGE.into()))
                .title("Zorvo")
                .inner_size(WIDTH, HEIGHT)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build();
            match built {
                Ok(window) => window,
                Err(error) => {
                    eprintln!("Zorvo could not open the computer use pill: {error}");
                    return;
                }
            }
        }
    };
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let width = monitor.size().width as f64 / scale;
        let left = monitor.position().x as f64 / scale + (width - WIDTH) / 2.0;
        let top = monitor.position().y as f64 / scale + TOP;
        let _ = window.set_position(LogicalPosition::new(left, top));
    }
    // Shown without focus: the user keeps typing in their own app.
    let _ = window.show();
}

/// An agent started to read an app: the pill shows, stays while the read
/// runs, and hides `LINGER` after the last one ended. Each call is followed
/// by one `ended`.
pub fn note(app: &AppHandle, activity: Value) {
    let Some(pill) = app.try_state::<Pill>() else {
        return;
    };
    pill.active.fetch_add(1, Ordering::AcqRel);
    let turn = pill.set(Some(activity));
    let on_main = app.clone();
    // Windows are made on the main thread.
    let _ = app.run_on_main_thread(move || place_and_show(&on_main));
    // One thread waits, however many actions arrive while it does.
    if pill.is_waiting.swap(true, Ordering::AcqRel) {
        return;
    }
    let later = app.clone();
    thread::spawn(move || {
        let Some(pill) = later.try_state::<Pill>() else {
            return;
        };
        let mut seen = turn;
        loop {
            thread::sleep(LINGER);
            let now = pill.turn.load(Ordering::Acquire);
            if now != seen || pill.is_busy() {
                seen = now;
                continue;
            }
            pill.is_waiting.store(false, Ordering::Release);
            // An action that arrived just now saw a thread still waiting and
            // started none: this one goes on waiting for it.
            if pill.turn.load(Ordering::Acquire) != seen
                && !pill.is_waiting.swap(true, Ordering::AcqRel)
            {
                seen = pill.turn.load(Ordering::Acquire);
                continue;
            }
            break;
        }
        // Nothing to hide when a Stop already did.
        if pill.latest().is_some() && pill.turn.load(Ordering::Acquire) == seen {
            hide(&later);
        }
    });
}

/// The read a `note` announced ended, whatever its outcome.
pub fn ended(app: &AppHandle) {
    if let Some(pill) = app.try_state::<Pill>() {
        pill.finish_one();
    }
}

/// Computer use stopped, or nothing happened for a while.
pub fn hide(app: &AppHandle) {
    if let Some(pill) = app.try_state::<Pill>() {
        pill.set(None);
    }
    let on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = on_main.get_webview_window(LABEL) {
            let _ = window.hide();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pill_is_busy_until_every_read_ended() {
        let pill = Pill::default();
        pill.active.fetch_add(2, Ordering::AcqRel);
        pill.finish_one();
        assert!(pill.is_busy());
        pill.finish_one();
        assert!(!pill.is_busy());
        // An end with no start counts nothing down.
        pill.finish_one();
        assert!(!pill.is_busy());
    }

    #[test]
    fn a_read_that_ends_restarts_the_wait_to_hide() {
        let pill = Pill::default();
        let before = pill.turn.load(Ordering::Acquire);
        pill.finish_one();
        assert_ne!(pill.turn.load(Ordering::Acquire), before);
    }
}
