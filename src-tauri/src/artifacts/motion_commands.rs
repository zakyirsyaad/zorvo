//! The commands the webview calls for motions and videos: showing them (the agent's
//! `show_artifact`, relayed), reading them, the preview view, export and forgetting.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::canvas_export::COULD_NOT_SAVE;
use super::commands::{bounds_in_window, changed, clean_file_stem, now_ms};
use super::motion::{read_motion, render_key, resolve_motion, Motion};
use super::motion_capture::CaptureView;
use super::motion_protocol::{apply_script, command_script, motion_page_url, shell_state};
use super::motion_render::{is_up_to_date, Destination, JobView, MotionRenderer};
use super::motion_store::{MotionEntry, ShownMotion, VideoEntry};
use super::protocol::Served;
use super::store::{clean_title_within, is_session_id, ArtifactStore, FAILED};
use super::view::{self, Bounds, ShownMotion as ViewMotion};
use crate::files::canonical_root;
use crate::media::video_type;
use crate::store::AppStore;

pub const NOTHING_MOVES: &str = "Nothing moves when Zorvo seeks this page: no CSS animation and no zorvoMotion.onSeek handler was found after it loaded. Read artifact_guide with kind motion.";
pub const NOT_A_VIDEO_FILE: &str =
    "The video must be an .mp4, .mov or .m4v file inside this folder.";
pub const NEEDS_TITLE_VIDEO: &str = "Give the video a title the first time you show it.";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FormatState {
    pub id: String,
    pub width: u32,
    pub height: u32,
    /// `out/<id>.mp4` exists.
    pub has_render: bool,
    /// It was rendered from what the folder holds now.
    pub is_up_to_date: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MotionRead {
    pub entry: MotionEntry,
    pub title: String,
    pub duration: f64,
    pub fps: u32,
    pub poster: f64,
    pub tracks: u32,
    pub formats: Vec<FormatState>,
    pub jobs: Vec<JobView>,
    /// `motion.json` could not be read: why, as the parser says it.
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

fn session_folder(store: &AppStore, session_id: &str, cwd: &str) -> Result<PathBuf, String> {
    if !is_session_id(session_id) {
        return Err(FAILED.to_string());
    }
    let folder = canonical_root(cwd)?;
    if !store.is_known_workspace(&folder).unwrap_or(false) {
        return Err(format!(
            "{} is not one of your workspaces",
            folder.display()
        ));
    }
    Ok(folder)
}

fn formats_of(root: &Path, motion: &Motion) -> Vec<FormatState> {
    motion
        .formats
        .iter()
        .map(|format| FormatState {
            id: format.id.clone(),
            width: format.width,
            height: format.height,
            has_render: super::motion::out_file(root, &format.id).is_file(),
            is_up_to_date: is_up_to_date(root, format),
        })
        .collect()
}

fn read_of(
    session_id: &str,
    entry: MotionEntry,
    root: &Path,
    renderer: &MotionRenderer,
    warnings: Vec<String>,
) -> MotionRead {
    let jobs = renderer
        .open_jobs(session_id)
        .into_iter()
        .filter(|job| job.key == entry.key)
        .collect();
    match read_motion(root) {
        Ok(motion) => MotionRead {
            title: motion.title.clone(),
            duration: motion.duration,
            fps: motion.fps,
            poster: motion.poster,
            tracks: motion.audio.len() as u32,
            formats: formats_of(root, &motion),
            entry,
            jobs,
            error: None,
            warnings,
        },
        Err(error) => MotionRead {
            title: entry.title.clone(),
            duration: entry.duration,
            fps: 0,
            poster: 0.0,
            tracks: 0,
            formats: Vec::new(),
            entry,
            jobs,
            error: Some(error),
            warnings,
        },
    }
}

/// Loads the first format once and says whether anything moves when it is seeked.
fn check_moves(
    app: &AppHandle,
    served: &Arc<Served>,
    session_id: &str,
    entry: &MotionEntry,
    motion: &Motion,
) -> Vec<String> {
    let format = &motion.formats[0];
    let Ok(view) = CaptureView::open(
        app,
        Arc::clone(served),
        motion_page_url(session_id, &entry.key, motion, format),
        session_id.to_string(),
        entry.key.clone(),
        format.width,
        format.height,
    ) else {
        return vec![super::motion_capture::CAPTURE_FAILED.to_string()];
    };
    let ready = view.wait_ready();
    if ready.animations == 0 && ready.handlers == 0 {
        vec![NOTHING_MOVES.to_string()]
    } else {
        Vec::new()
    }
}

/// The agent's `show_artifact` with `kind: "motion"`.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn motion_show(
    app: AppHandle,
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    served: State<'_, Arc<Served>>,
    renderer: State<'_, Arc<MotionRenderer>>,
    session_id: String,
    cwd: String,
    path: String,
    title: Option<String>,
) -> Result<MotionRead, String> {
    let folder = session_folder(&store, &session_id, &cwd)?;
    let found = resolve_motion(&folder, &path)?;
    let motion = read_motion(&found.root)?;
    let title = title
        .as_deref()
        .and_then(|title| clean_title_within(title, super::motion::MAX_TITLE_CHARS))
        .unwrap_or_else(|| motion.title.clone());
    let entry = artifacts.remember_motion(
        &session_id,
        ShownMotion {
            folder: &found.root,
            relative: &found.relative,
            title: &title,
            duration: motion.duration,
            formats: motion.formats.iter().map(|f| f.id.clone()).collect(),
        },
        now_ms(),
    )?;
    changed(&app, &session_id);
    let warnings = check_moves(&app, &served, &session_id, &entry, &motion);
    Ok(read_of(
        &session_id,
        entry,
        &found.root,
        &renderer,
        warnings,
    ))
}

/// The agent's `show_artifact` with `kind: "video"`.
#[tauri::command(async)]
pub fn video_show(
    app: AppHandle,
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    cwd: String,
    path: String,
    title: Option<String>,
) -> Result<VideoEntry, String> {
    let folder = session_folder(&store, &session_id, &cwd)?;
    let refused = || NOT_A_VIDEO_FILE.to_string();
    let file = std::fs::canonicalize(folder.join(&path)).map_err(|_| refused())?;
    let relative = file.strip_prefix(&folder).map_err(|_| refused())?;
    let relative = relative.to_str().ok_or_else(refused)?.to_string();
    let extension = file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !["mp4", "mov", "m4v"].contains(&extension.as_str()) || video_type(&file).is_none() {
        return Err(refused());
    }
    let known = artifacts
        .videos(&session_id)?
        .into_iter()
        .find(|entry| Path::new(&entry.path) == file);
    let title = match (
        title.as_deref().and_then(|t| clean_title_within(t, 60)),
        known,
    ) {
        (Some(title), _) => title,
        (None, Some(entry)) => entry.title,
        (None, None) => return Err(NEEDS_TITLE_VIDEO.to_string()),
    };
    let entry = artifacts.remember_video(&session_id, &file, &relative, &title, now_ms())?;
    changed(&app, &session_id);
    Ok(entry)
}

#[tauri::command(async)]
pub fn motion_read(
    artifacts: State<'_, Arc<ArtifactStore>>,
    served: State<'_, Arc<Served>>,
    renderer: State<'_, Arc<MotionRenderer>>,
    session_id: String,
    key: String,
) -> Result<MotionRead, String> {
    let entry = artifacts
        .motion(&session_id, &key)
        .ok_or_else(|| FAILED.to_string())?;
    let root = super::motion_protocol::motion_root(&served, &session_id, &key)
        .ok_or_else(|| super::motion_render::NOT_SHOWN.to_string())?;
    Ok(read_of(&session_id, entry, &root, &renderer, Vec::new()))
}

/// Shows a motion's preview at a rectangle of the main window, in `format`.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn motion_view_show(
    app: AppHandle,
    served: State<'_, Arc<Served>>,
    session_id: String,
    key: String,
    format: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let root = super::motion_protocol::motion_root(&served, &session_id, &key);
    let bounds = bounds_in_window(
        &app,
        Bounds {
            x,
            y,
            width,
            height,
        },
    );
    let (Some(root), Some(bounds)) = (root, bounds) else {
        view::close(&app);
        return Err(view::COULD_NOT_SHOW.to_string());
    };
    let motion = read_motion(&root)?;
    let shown = ViewMotion {
        session_id: session_id.clone(),
        key: key.clone(),
    };
    view::apply_motion(
        &app,
        shown.clone(),
        apply_script(&state_of(&root, &session_id, &key, &motion, &format)),
    );
    view::show_motion(&app, Arc::clone(&served), shown, bounds)
}

fn state_of(root: &Path, session_id: &str, key: &str, motion: &Motion, format: &str) -> String {
    let version = motion
        .formats
        .first()
        .and_then(|f| render_key(root, f))
        .map(|key| key[..12].to_string())
        .unwrap_or_default();
    shell_state(session_id, key, motion, format, &version)
}

/// Hands the preview the motion again: another format, or the folder changed.
#[tauri::command(async)]
pub fn motion_view_apply(
    app: AppHandle,
    served: State<'_, Arc<Served>>,
    session_id: String,
    key: String,
    format: String,
) -> Result<(), String> {
    let root = super::motion_protocol::motion_root(&served, &session_id, &key)
        .ok_or_else(|| view::COULD_NOT_SHOW.to_string())?;
    let motion = read_motion(&root)?;
    let script = apply_script(&state_of(&root, &session_id, &key, &motion, &format));
    view::apply_motion(&app, ViewMotion { session_id, key }, script);
    Ok(())
}

/// One of the preview's commands: play, pause, seek, mute, unmute.
#[tauri::command(async)]
pub fn motion_view_command(
    app: AppHandle,
    session_id: String,
    key: String,
    name: String,
    value: Option<f64>,
) -> Result<(), String> {
    let script = command_script(&name, value).ok_or_else(|| view::COULD_NOT_SHOW.to_string())?;
    view::motion_command(&app, ViewMotion { session_id, key }, script);
    Ok(())
}

/// Exports one format (to a file) or all (to a folder): asks where, then queues the render, which
/// copies an up-to-date `out/` file instead of rendering it again. `None` when cancelled.
#[tauri::command(async)]
pub fn motion_export(
    app: AppHandle,
    served: State<'_, Arc<Served>>,
    renderer: State<'_, Arc<MotionRenderer>>,
    session_id: String,
    key: String,
    format: Option<String>,
) -> Result<Option<JobView>, String> {
    let root = super::motion_protocol::motion_root(&served, &session_id, &key)
        .ok_or_else(|| super::motion_render::NOT_SHOWN.to_string())?;
    let motion = read_motion(&root)?;
    let stem = clean_file_stem(&motion.title, "motion");
    let dialog = app.dialog().file();
    let (formats, chosen) = match format {
        Some(id) => {
            let chosen = dialog
                .set_file_name(format!("{stem}-{id}.mp4"))
                .add_filter("MP4", &["mp4"])
                .blocking_save_file()
                .map(|path| path.into_path().map(Destination::File));
            (vec![id], chosen)
        }
        None => (
            Vec::new(),
            dialog
                .blocking_pick_folder()
                .map(|path| path.into_path().map(Destination::Folder)),
        ),
    };
    let Some(destination) = chosen.transpose().map_err(|_| COULD_NOT_SAVE.to_string())? else {
        return Ok(None);
    };
    renderer
        .enqueue(&session_id, &key, formats, destination, true)
        .map(Some)
}

#[tauri::command(async)]
pub fn motion_render_cancel(
    renderer: State<'_, Arc<MotionRenderer>>,
    session_id: String,
    job: String,
) -> bool {
    renderer.cancel(&session_id, &job)
}

/// Forgets a motion or a video (the Remove in Output); the files stay.
#[tauri::command(async)]
pub fn media_forget(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    key: String,
) -> Result<(), String> {
    artifacts.forget_media(&session_id, &key)?;
    changed(&app, &session_id);
    Ok(())
}
