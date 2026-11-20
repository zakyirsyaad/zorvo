//! The pill: a small Zorvo window that stays on top of every app and every
//! Space while an agent uses an app, and for a few seconds after. The agent
//! cursor sits on the window the agent acts on, which the user's own windows
//! can cover; the pill is the sign that shows whatever is in front, and its
//! Stop works from there.

use std::sync::atomic::{AtomicU64, Ordering};
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
/// How long the pill stays after the last thing an agent did.
pub const LINGER: Duration = Duration::from_secs(5);

/// The newest thing an agent did, which the pill's page reads when it loads
/// (its window is made on the first action, after that action's event).
#[derive(Default)]
pub struct Pill {
    latest: Mutex<Option<Value>>,
    /// Counts actions, so a hide scheduled by an older one does nothing.
    turn: AtomicU64,
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

/// An agent did something: the pill shows, and hides `LINGER` after the last
/// such call.
pub fn note(app: &AppHandle, activity: Value) {
    let Some(pill) = app.try_state::<Pill>() else {
        return;
    };
    let turn = pill.set(Some(activity));
    let on_main = app.clone();
    // Windows are made on the main thread.
    let _ = app.run_on_main_thread(move || place_and_show(&on_main));
    let later = app.clone();
    thread::spawn(move || {
        thread::sleep(LINGER);
        let is_newest = later
            .try_state::<Pill>()
            .is_some_and(|pill| pill.turn.load(Ordering::Acquire) == turn);
        if is_newest {
            hide(&later);
        }
    });
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
