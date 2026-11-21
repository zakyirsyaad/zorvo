//! The Tauri commands of inline visuals. The webview relays an agent's `show_visual` arguments
//! to `visual_show`; everything else takes ids only.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use tauri_plugin_dialog::DialogExt;

use super::commands::{changed, now_ms};
use super::protocol::Served;
use super::render::snapshot_visual_png;
use super::source::{read_visual_source, temp_roots};
use super::store::{is_session_id, ArtifactStore};
use super::visual_export::{
    checked_size, copy_png, export_name, offered, theme_of, Format, VISUAL_COPY_FAILED,
    VISUAL_EXPORT_FAILED,
};
use super::visual_wrapper::document;
use super::visuals::{
    VisualEntry, MAX_VISUAL_BYTES, VISUAL_FAILED, VISUAL_ONE_SOURCE, VISUAL_TOO_LARGE,
};
use crate::files::{canonical_root, ensure_known_workspace};
use crate::store::AppStore;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisualRead {
    pub entry: VisualEntry,
    /// The whole document for the chat's frame: Zorvo's wrapper around the cleaned markup.
    pub document: String,
}

/// Keeps the agent's markup, given as `code` or read from `path` under the page rules.
#[allow(clippy::too_many_arguments)]
pub fn show_visual(
    artifacts: &ArtifactStore,
    is_known: impl FnOnce(&Path) -> Result<bool, String>,
    session_id: &str,
    cwd: &str,
    title: &str,
    code: Option<&str>,
    path: Option<&str>,
    now_ms: u64,
) -> Result<VisualEntry, String> {
    ensure_known_workspace(cwd, is_known)?;
    if !is_session_id(session_id) {
        return Err(VISUAL_FAILED.to_string());
    }
    match (code, path) {
        (Some(code), None) => artifacts.put_visual(session_id, title, code.as_bytes(), now_ms),
        (None, Some(path)) => {
            let folder = canonical_root(cwd)?;
            let bytes = read_visual_source(
                &folder,
                &temp_roots(),
                path,
                MAX_VISUAL_BYTES,
                VISUAL_TOO_LARGE,
            )?;
            artifacts.put_visual(session_id, title, &bytes, now_ms)
        }
        _ => Err(VISUAL_ONE_SOURCE.to_string()),
    }
}

pub fn read_visual(
    artifacts: &ArtifactStore,
    session_id: &str,
    id: &str,
) -> Result<VisualRead, String> {
    let (entry, markup) = artifacts.visual(session_id, id)?;
    Ok(VisualRead {
        document: document(&markup, None),
        entry,
    })
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn visual_show(
    app: AppHandle,
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    cwd: String,
    title: String,
    code: Option<String>,
    path: Option<String>,
) -> Result<VisualEntry, String> {
    let entry = show_visual(
        &artifacts,
        |root| store.is_known_workspace(root),
        &session_id,
        &cwd,
        &title,
        code.as_deref(),
        path.as_deref(),
        now_ms(),
    )?;
    changed(&app, &session_id);
    Ok(entry)
}

#[tauri::command(async)]
pub fn visual_read(
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    id: String,
) -> Result<VisualRead, String> {
    read_visual(&artifacts, &session_id, &id)
}

/// Removes the session's visuals that no message names any more; `keep` is what the transcript
/// names now. A visual shown under a minute ago always stays.
#[tauri::command(async)]
pub fn visual_sweep(
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    keep: Vec<String>,
) -> Result<usize, String> {
    artifacts.keep_visuals(&session_id, &keep, now_ms())
}

/// What a save or a copy needs: the visual, and for a picture its size and theme.
fn picture(
    app: &AppHandle,
    served: &Arc<Served>,
    session_id: &str,
    id: &str,
    width: u32,
    height: u32,
    theme: &str,
) -> Option<Vec<u8>> {
    let (width, height) = checked_size(width, height)?;
    let theme = theme_of(theme)?;
    snapshot_visual_png(
        app,
        Arc::clone(served),
        session_id,
        id,
        theme,
        width,
        height,
    )
    .ok()
}

/// Saves a visual where the user chooses: its stored markup (`svg`), that markup in Zorvo's
/// wrapper (`html`), or a picture (`png`). `false` when the dialog is cancelled.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn visual_export(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    served: State<'_, Arc<Served>>,
    session_id: String,
    id: String,
    format: String,
    width: u32,
    height: u32,
    theme: String,
) -> Result<bool, String> {
    let failed = || VISUAL_EXPORT_FAILED.to_string();
    let (entry, markup) = artifacts.visual(&session_id, &id)?;
    let format = Format::parse(&format)
        .filter(|format| offered(entry.kind).contains(format))
        .ok_or_else(failed)?;
    let chosen = app
        .dialog()
        .file()
        .set_file_name(export_name(&entry.title, format))
        .add_filter(format.extension().to_uppercase(), &[format.extension()])
        .blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(false);
    };
    let bytes = match format {
        Format::Svg => markup.into_bytes(),
        Format::Html => document(&markup, None).into_bytes(),
        Format::Png => {
            picture(&app, &served, &session_id, &id, width, height, &theme).ok_or_else(failed)?
        }
    };
    let destination = chosen.into_path().map_err(|_| failed())?;
    std::fs::write(destination, bytes).map_err(|_| failed())?;
    Ok(true)
}

/// Puts a picture of a visual on the clipboard.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn visual_copy_image(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    served: State<'_, Arc<Served>>,
    session_id: String,
    id: String,
    width: u32,
    height: u32,
    theme: String,
) -> Result<(), String> {
    artifacts.visual(&session_id, &id)?;
    let png = picture(&app, &served, &session_id, &id, width, height, &theme)
        .ok_or_else(|| VISUAL_COPY_FAILED.to_string())?;
    copy_png(&app, png)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::source::NOT_ALLOWED;
    use crate::artifacts::test_support::Temp;
    use crate::artifacts::visuals::VISUAL_GONE;

    fn visual_store(tag: &str) -> (Temp, ArtifactStore) {
        let temp = Temp::new(tag);
        let store = ArtifactStore::new(temp.0.join("store"));
        (temp, store)
    }

    const VISUAL_SESSION: &str = "session-1794800000000-k3x9a";

    #[test]
    fn a_visual_from_code_is_kept_and_read_back_as_a_document() {
        let (temp, store) = visual_store("visual-code");
        let cwd = temp.0.to_str().unwrap();
        let code = Some("<svg><rect/></svg>");
        let entry = show_visual(
            &store,
            |_| Ok(true),
            VISUAL_SESSION,
            cwd,
            "Flow",
            code,
            None,
            5,
        )
        .unwrap();
        assert_eq!(entry.title, "Flow");
        let read = read_visual(&store, VISUAL_SESSION, &entry.id).unwrap();
        assert_eq!(read.entry, entry);
        assert!(read.document.starts_with("<!doctype html>") && read.document.contains("<rect"));
        assert!(read.document.contains("prefers-color-scheme: light"));
    }

    #[test]
    fn a_visual_from_a_file_follows_the_path_rules() {
        let (temp, store) = visual_store("visual-path");
        let cwd = temp.0.to_str().unwrap();
        std::fs::write(temp.0.join("a.svg"), "<svg><rect/></svg>").unwrap();
        std::fs::write(temp.0.join("a.txt"), "<p>a</p>").unwrap();
        std::fs::write(temp.0.join("big.html"), vec![b'a'; MAX_VISUAL_BYTES + 1]).unwrap();
        let show = |path: &str| {
            show_visual(
                &store,
                |_| Ok(true),
                VISUAL_SESSION,
                cwd,
                "A",
                None,
                Some(path),
                0,
            )
        };
        assert!(show("a.svg").is_ok());
        assert_eq!(show("a.txt").unwrap_err(), NOT_ALLOWED);
        assert_eq!(show("../outside.svg").unwrap_err(), NOT_ALLOWED);
        assert_eq!(show("big.html").unwrap_err(), VISUAL_TOO_LARGE);
    }

    #[test]
    fn a_visual_needs_exactly_one_source_and_a_known_folder() {
        let (temp, store) = visual_store("visual-source");
        let cwd = temp.0.to_str().unwrap();
        let both = show_visual(
            &store,
            |_| Ok(true),
            VISUAL_SESSION,
            cwd,
            "A",
            Some("<p>a</p>"),
            Some("a.svg"),
            0,
        );
        assert_eq!(both.unwrap_err(), VISUAL_ONE_SOURCE);
        let neither = show_visual(
            &store,
            |_| Ok(true),
            VISUAL_SESSION,
            cwd,
            "A",
            None,
            None,
            0,
        );
        assert_eq!(neither.unwrap_err(), VISUAL_ONE_SOURCE);
        let unknown = show_visual(
            &store,
            |_| Ok(false),
            VISUAL_SESSION,
            cwd,
            "A",
            Some("<p>a</p>"),
            None,
            0,
        );
        assert!(unknown.is_err());
        assert_eq!(
            read_visual(&store, VISUAL_SESSION, "v-0000000000000000").unwrap_err(),
            VISUAL_GONE
        );
    }
}
