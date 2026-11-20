//! The commands Settings calls for computer use. The webview sends only a
//! pane's name; every path, bundle id and command is Zorvo's own.

use std::sync::Arc;

use tauri::{AppHandle, State};

use super::permissions::{self, ComputerUseStatus};
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
