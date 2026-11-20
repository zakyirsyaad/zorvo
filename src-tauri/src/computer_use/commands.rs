//! The commands Settings calls for computer use. The webview sends only a
//! pane's name; every path, bundle id and command is Zorvo's own.

use std::sync::Arc;

use tauri::{AppHandle, State};

use serde::Serialize;

use super::grants::GrantView;
use super::permissions::{self, ComputerUseStatus};
use super::requests::RequestView;
use super::server::ScreenServer;
use super::state::ComputerUse;

fn status(state: &ComputerUse) -> ComputerUseStatus {
    permissions::read_status(state.data_dir(), state.asked_screen_recording())
}

/// What the Computer use group shows. Asks macOS nothing.
#[tauri::command(async)]
pub fn computer_use_status(state: State<'_, Arc<ComputerUse>>) -> ComputerUseStatus {
    status(&state)
}

/// Asks macOS for Screen Recording and Accessibility. Only the user's click
/// on the switch or a button in Settings calls this.
#[tauri::command(async)]
pub fn computer_use_request_permissions(state: State<'_, Arc<ComputerUse>>) -> ComputerUseStatus {
    permissions::request();
    state.note_screen_recording_asked();
    status(&state)
}

/// Opens System Settings on one permission's pane: "screen" or "accessibility".
#[tauri::command(async)]
pub fn computer_use_open_pane(
    state: State<'_, Arc<ComputerUse>>,
    pane: String,
) -> Result<(), String> {
    permissions::open_pane(&pane)?;
    if pane == "screen" {
        state.note_screen_recording_asked();
    }
    Ok(())
}

/// After an update: forgets macOS's stale record of both permissions for
/// Zorvo and asks again.
#[tauri::command(async)]
pub fn computer_use_reset_permissions(
    app: AppHandle,
    state: State<'_, Arc<ComputerUse>>,
) -> ComputerUseStatus {
    // A debug build shares the installed Zorvo's bundle id, and under
    // `pnpm tauri dev` the permissions belong to the terminal anyway: a reset
    // here would only take the installed app's permissions away.
    if !cfg!(debug_assertions) {
        permissions::reset(&app.config().identifier);
    }
    permissions::request();
    state.note_screen_recording_asked();
    status(&state)
}

/// What the webview shows of computer use: what each session may use, and
/// the cards that wait for an answer.
#[derive(Debug, Clone, Serialize)]
pub struct ComputerUseView {
    pub grants: Vec<GrantView>,
    pub requests: Vec<RequestView>,
}

/// The user answered a card. `allowed` holds the keys Rust gave the ticked
/// rows of that card ("app-1"); a key of another card grants nothing.
#[tauri::command(async)]
pub fn computer_use_answer(
    server: State<'_, Arc<ScreenServer>>,
    call_id: String,
    allowed: Vec<String>,
) -> Option<Vec<String>> {
    server.answer(&call_id, &allowed)
}

/// Read when the webview loads, since a reload loses its copy, and after
/// every `computer-use-changed`.
#[tauri::command]
pub fn computer_use_state(server: State<'_, Arc<ScreenServer>>) -> ComputerUseView {
    ComputerUseView {
        grants: server.views(),
        requests: server.open_requests(),
    }
}

/// Stop computer use for a session: its grants end and the driver is killed.
/// The pill goes with it.
#[tauri::command(async)]
pub fn computer_use_revoke(
    app: AppHandle,
    server: State<'_, Arc<ScreenServer>>,
    session_id: String,
) {
    server.revoke(&session_id);
    super::pill::hide(&app);
}

/// What the pill shows when its page loads: the newest thing an agent did.
#[tauri::command]
pub fn computer_use_pill_state(pill: State<'_, super::pill::Pill>) -> Option<serde_json::Value> {
    pill.latest()
}
