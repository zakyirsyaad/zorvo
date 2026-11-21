//! The Tauri commands of inline visuals. The webview relays an agent's `show_visual` arguments
//! to `visual_show`; everything else takes ids only.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use super::commands::{changed, now_ms};
use super::source::{read_visual_source, temp_roots};
use super::store::{is_session_id, ArtifactStore};
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
