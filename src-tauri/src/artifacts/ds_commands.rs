//! The commands of a project's design systems.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use super::commands::{bounds_in_window, changed, is_inside_known_session_folder, now_ms};
use super::design_system::{find_systems, system_key, SystemList, INDEX_FILE, NOT_A_DESIGN_SYSTEM};
use super::ds_content::{read_content, DsContent};
use super::ds_source::{source_state, SourceState};
use super::ds_store::DesignSystemEntry;
use super::ds_tokens::DsTokens;
use super::ds_view::{ds_apply_script, ShownDesignSystem};
use super::protocol::Served;
use super::store::{is_session_id, ArtifactStore, FAILED};
use super::view::{self, Bounds};
use crate::files::{canonical_root, ensure_known_workspace};
use crate::store::AppStore;

/// The same sentence a canvas whose folder moved reads.
pub const FOLDER_NOT_FOUND: &str = "Folder not found";
const MAX_PATH_CHARS: usize = 4096;
const GOOGLE_FONTS_CSS: &str = "https://fonts.googleapis.com/css2";
const MAX_FAMILY_CHARS: usize = 64;

/// What `design_system_show` and `ds_read` answer.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignSystemRead {
    pub entry: DesignSystemEntry,
    pub content: Option<DsContent>,
    pub error: Option<String>,
    pub google_fonts_url: Option<String>,
}

/// A system's canonical folder inside the session's folder, and that folder relative to it.
/// `path` is the folder or its `design-system.json`. The session's folder is never a temporary
/// one, so a temporary folder is refused by construction.
pub fn resolve_system(session_folder: &Path, path: &str) -> Result<(PathBuf, String), String> {
    let refused = || NOT_A_DESIGN_SYSTEM.to_string();
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS || path.contains('\0') {
        return Err(refused());
    }
    let session = fs::canonicalize(session_folder).map_err(|_| refused())?;
    let mut root = fs::canonicalize(session.join(path)).map_err(|_| refused())?;
    if root.is_file() && root.file_name().is_some_and(|name| name == INDEX_FILE) {
        root.pop();
    }
    let relative = root.strip_prefix(&session).map_err(|_| refused())?;
    if !root.is_dir() || !root.join(INDEX_FILE).is_file() {
        return Err(refused());
    }
    let relative = relative
        .components()
        .map(|part| part.as_os_str().to_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(refused)?
        .join("/");
    Ok((
        root,
        if relative.is_empty() {
            ".".into()
        } else {
            relative
        },
    ))
}

fn token_count(tokens: Option<&DsTokens>) -> u32 {
    tokens.map_or(0, |t| (t.tokens.len() + t.styles.len()) as u32)
}

/// The Google Fonts stylesheet for the fonts `tokens.json` names with no file (spec gap 8):
/// families of letters, digits and spaces, their weights sorted and deduped.
pub fn google_fonts_url(tokens: Option<&DsTokens>) -> Option<String> {
    let mut families: Vec<(String, Vec<u16>)> = Vec::new();
    for font in tokens.map(|t| t.fonts.as_slice()).unwrap_or_default() {
        let name = font.family.trim();
        let plain = !name.is_empty()
            && name.chars().count() <= MAX_FAMILY_CHARS
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ');
        if font.file.is_some() || !plain {
            continue;
        }
        let weight = font.weight.unwrap_or(400);
        match families.iter_mut().find(|(family, _)| family == name) {
            Some((_, weights)) => weights.push(weight),
            None => families.push((name.to_string(), vec![weight])),
        }
    }
    if families.is_empty() {
        return None;
    }
    let query: Vec<String> = families
        .into_iter()
        .map(|(family, mut weights)| {
            weights.sort_unstable();
            weights.dedup();
            let weights: Vec<String> = weights.iter().map(u16::to_string).collect();
            format!(
                "family={}:wght@{}",
                family.replace(' ', "+"),
                weights.join(";")
            )
        })
        .collect();
    Some(format!(
        "{GOOGLE_FONTS_CSS}?{}&display=swap",
        query.join("&")
    ))
}

fn read_of(entry: DesignSystemEntry, content: DsContent) -> DesignSystemRead {
    let google_fonts_url = google_fonts_url(content.tokens.as_ref());
    let entry = DesignSystemEntry {
        title: content.index.title.clone(),
        tokens: token_count(content.tokens.as_ref()),
        components: content.components.len() as u32,
        ..entry
    };
    DesignSystemRead {
        entry,
        content: Some(content),
        error: None,
        google_fonts_url,
    }
}

/// `show_artifact` with `kind: "design-system"`: checks the session's folder, reads the system
/// and remembers it.
pub fn show_design_system(
    artifacts: &ArtifactStore,
    is_known: impl Fn(&Path) -> bool,
    session_id: &str,
    cwd: &str,
    path: &str,
    now: u64,
) -> Result<DesignSystemRead, String> {
    if !is_session_id(session_id) {
        return Err(FAILED.to_string());
    }
    let session_folder = canonical_root(cwd)?;
    if !is_known(&session_folder) {
        return Err(format!(
            "{} is not one of your workspaces",
            session_folder.display()
        ));
    }
    let (root, relative) = resolve_system(&session_folder, path)?;
    let content = read_content(&root)?;
    let entry = DesignSystemEntry {
        key: system_key(&root),
        folder: root.to_string_lossy().to_string(),
        relative,
        title: content.index.title.clone(),
        tokens: token_count(content.tokens.as_ref()),
        components: content.components.len() as u32,
        shown_at: now,
    };
    let entry = artifacts.remember_design_system(session_id, entry)?;
    Ok(read_of(entry, content))
}

/// Reads a remembered system again; a folder that moved or no longer reads is an answer with
/// `error`, not a refusal, so the viewer keeps its last good state.
pub fn read_design_system(
    artifacts: &ArtifactStore,
    is_known: impl Fn(&Path) -> bool,
    session_id: &str,
    key: &str,
) -> Result<DesignSystemRead, String> {
    let entry = artifacts
        .design_system(session_id, key)
        .ok_or_else(|| FAILED.to_string())?;
    let failed = |entry: DesignSystemEntry, error: &str| DesignSystemRead {
        entry,
        content: None,
        error: Some(error.to_string()),
        google_fonts_url: None,
    };
    let root = PathBuf::from(&entry.folder);
    if !is_inside_known_session_folder(&root, &entry.relative, &is_known) {
        return Ok(failed(entry, FOLDER_NOT_FOUND));
    }
    Ok(match read_content(&root) {
        Ok(content) => read_of(entry, content),
        Err(error) => failed(entry, &error),
    })
}

#[tauri::command(async)]
pub fn design_system_show(
    app: AppHandle,
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    cwd: String,
    path: String,
) -> Result<DesignSystemRead, String> {
    let read = show_design_system(
        &artifacts,
        |root| store.is_known_workspace(root).unwrap_or(false),
        &session_id,
        &cwd,
        &path,
        now_ms(),
    )?;
    changed(&app, &session_id);
    Ok(read)
}

#[tauri::command(async)]
pub fn ds_read(
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    key: String,
) -> Result<DesignSystemRead, String> {
    read_design_system(
        &artifacts,
        |root| store.is_known_workspace(root).unwrap_or(false),
        &session_id,
        &key,
    )
}

#[tauri::command(async)]
pub fn ds_forget(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    key: String,
) -> Result<(), String> {
    artifacts.forget_design_system(&session_id, &key)?;
    view::close_for(&app, session_id.clone(), Some(key));
    changed(&app, &session_id);
    Ok(())
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn ds_view_show(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    served: State<'_, Arc<Served>>,
    session_id: String,
    key: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let is_known = artifacts.design_system(&session_id, &key).is_some();
    let bounds = bounds_in_window(
        &app,
        Bounds {
            x,
            y,
            width,
            height,
        },
    );
    match (is_known, bounds) {
        (true, Some(bounds)) => view::show_design_system(
            &app,
            Arc::clone(&served),
            ShownDesignSystem { session_id, key },
            bounds,
        ),
        _ => {
            view::close(&app);
            Err(view::COULD_NOT_SHOW.to_string())
        }
    }
}

/// Whether the code a remembered system was made from changed since: read-only git in its
/// repository, only for a system still inside a known session folder.
pub fn source_state_of(
    artifacts: &ArtifactStore,
    is_known: impl Fn(&Path) -> bool,
    git: &Path,
    session_id: &str,
    key: &str,
) -> Result<SourceState, String> {
    let entry = artifacts
        .design_system(session_id, key)
        .ok_or_else(|| FAILED.to_string())?;
    let root = PathBuf::from(&entry.folder);
    let relative = if entry.relative == "." {
        ""
    } else {
        entry.relative.as_str()
    };
    if !is_inside_known_session_folder(&root, relative, &is_known) {
        return Ok(SourceState::None);
    }
    let source = read_content(&root)
        .ok()
        .and_then(|content| content.tokens)
        .and_then(|tokens| tokens.source);
    Ok(source_state(git, &root, source.as_ref()))
}

#[tauri::command(async)]
pub fn ds_source_state(
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    key: String,
) -> Result<SourceState, String> {
    source_state_of(
        &artifacts,
        |root| store.is_known_workspace(root).unwrap_or(false),
        &crate::git_info::git_binary(),
        &session_id,
        &key,
    )
}

/// The components `ds_view_apply` reads for `key`: none when the system is forgotten or no
/// longer reads, so every preview message is refused.
pub fn components_of(artifacts: &ArtifactStore, session_id: &str, key: &str) -> Vec<String> {
    artifacts
        .design_system(session_id, key)
        .and_then(|entry| read_content(Path::new(&entry.folder)).ok())
        .map(|content| content.components.into_iter().map(|c| c.name).collect())
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn ds_view_apply(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    key: String,
    state: String,
) -> Result<(), String> {
    let shown = ShownDesignSystem {
        session_id: session_id.clone(),
        key: key.clone(),
    };
    let names = components_of(&artifacts, &session_id, &key);
    let script = ds_apply_script(&state).ok_or_else(|| view::COULD_NOT_SHOW.to_string())?;
    view::apply_design_system(&app, shown, names, script);
    Ok(())
}

/// The systems in the session's folder and below it, for the line every design guide ends
/// with. `cwd` must be a known workspace.
pub fn list_for(
    is_known: impl FnOnce(&Path) -> Result<bool, String>,
    session_id: &str,
    cwd: &str,
) -> Result<SystemList, String> {
    if !is_session_id(session_id) {
        return Err(FAILED.to_string());
    }
    ensure_known_workspace(cwd, is_known)?;
    Ok(find_systems(&canonical_root(cwd)?))
}

#[tauri::command(async)]
pub fn design_systems_list(
    store: State<'_, AppStore>,
    session_id: String,
    cwd: String,
) -> Result<SystemList, String> {
    list_for(|root| store.is_known_workspace(root), &session_id, &cwd)
}

#[cfg(test)]
mod tests {
    use super::super::design_system::INDEX_FILE;
    use super::super::test_support::Temp;
    use super::*;

    fn system(root: &Path, relative: &str) {
        let folder = root.join(relative);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(INDEX_FILE), r#"{"title": "Acme"}"#).unwrap();
    }

    #[test]
    fn refuses_a_folder_that_is_not_a_workspace() {
        let temp = Temp::new("ds-cmd-unknown");
        system(&temp.0, "brand");
        let cwd = temp.0.to_string_lossy().to_string();
        let error = list_for(|_| Ok(false), "s1", &cwd).expect_err("refused");
        let expected = ensure_known_workspace(&cwd, |_| Ok(false)).unwrap_err();
        assert_eq!(error, expected);
    }

    #[test]
    fn refuses_a_bad_session_id() {
        let temp = Temp::new("ds-cmd-session");
        let cwd = temp.0.to_string_lossy().to_string();
        for id in ["", "../x", "a b"] {
            assert_eq!(list_for(|_| Ok(true), id, &cwd).unwrap_err(), FAILED);
        }
    }

    #[test]
    fn lists_the_systems_of_a_known_folder() {
        let temp = Temp::new("ds-cmd-list");
        system(&temp.0, "docs/design-system");
        let cwd = temp.0.to_string_lossy().to_string();
        let list = list_for(|root| Ok(root == temp.0), "s1", &cwd).expect("listed");
        assert_eq!(list.systems.len(), 1);
        assert_eq!(list.systems[0].relative, "docs/design-system");
        assert_eq!(list.systems[0].title, "Acme");
        assert!(list.systems[0].is_default);
    }

    fn known(root: &Path) -> impl Fn(&Path) -> bool + '_ {
        move |candidate: &Path| fs::canonicalize(candidate).ok() == fs::canonicalize(root).ok()
    }

    fn full_system(root: &Path, relative: &str) {
        system(root, relative);
        std::fs::write(root.join(relative).join("README.md"), "# Acme").unwrap();
    }

    #[test]
    fn show_refuses_a_temp_folder_and_a_folder_outside_the_session() {
        let data = Temp::new("ds-show-data");
        let work = Temp::new("ds-show-work");
        let outside = Temp::new("ds-show-outside");
        full_system(&outside.0, "brand");
        let artifacts = ArtifactStore::new(data.0.clone());
        let cwd = work.0.to_string_lossy().to_string();
        let away = outside.0.join("brand").to_string_lossy().to_string();
        for path in [away.as_str(), "/tmp", "../x", ""] {
            let error = show_design_system(&artifacts, known(&work.0), "s1", &cwd, path, 1);
            assert_eq!(error.unwrap_err(), NOT_A_DESIGN_SYSTEM, "{path}");
        }
    }

    #[test]
    fn show_remembers_and_answers_the_key_and_counts() {
        let data = Temp::new("ds-show2-data");
        let work = Temp::new("ds-show2-work");
        full_system(&work.0, "docs/ds");
        let artifacts = ArtifactStore::new(data.0.clone());
        let cwd = work.0.to_string_lossy().to_string();
        let read = show_design_system(&artifacts, known(&work.0), "s1", &cwd, "docs/ds", 7)
            .expect("shown");
        assert!(super::super::design_system::is_ds_key(&read.entry.key));
        assert_eq!(read.entry.relative, "docs/ds");
        assert_eq!(read.entry.title, "Acme");
        assert_eq!(read.error, None);
        assert_eq!(artifacts.design_systems("s1").unwrap().len(), 1);
        let again = show_design_system(
            &artifacts,
            known(&work.0),
            "s1",
            &cwd,
            "docs/ds/design-system.json",
            8,
        )
        .expect("shown again");
        assert_eq!(again.entry.key, read.entry.key);
        assert_eq!(artifacts.design_systems("s1").unwrap().len(), 1);
    }

    #[test]
    fn read_of_a_moved_folder_answers_folder_not_found() {
        let data = Temp::new("ds-read-data");
        let work = Temp::new("ds-read-work");
        full_system(&work.0, "brand");
        let artifacts = ArtifactStore::new(data.0.clone());
        let cwd = work.0.to_string_lossy().to_string();
        let read = show_design_system(&artifacts, known(&work.0), "s1", &cwd, "brand", 1).unwrap();
        std::fs::remove_dir_all(work.0.join("brand")).unwrap();
        let again = read_design_system(&artifacts, known(&work.0), "s1", &read.entry.key).unwrap();
        assert_eq!(again.error.as_deref(), Some(FOLDER_NOT_FOUND));
        assert_eq!(again.content, None);
        assert_eq!(
            read_design_system(&artifacts, known(&work.0), "s1", "d-ffffffffffffffff").unwrap_err(),
            FAILED
        );
    }

    #[test]
    fn google_fonts_url_for_hosted_fonts_only() {
        let tokens = super::super::ds_tokens::parse_tokens(
            br#"{"type": {"fonts": [
                {"family": "Inter", "weight": 600},
                {"family": "Inter", "weight": 400},
                {"family": "Inter", "weight": 400},
                {"family": "Space Grotesk"},
                {"family": "Local", "file": "fonts/Local.woff2"},
                {"family": "Bad;Name"}
            ]}}"#,
        )
        .expect("read");
        assert_eq!(
            google_fonts_url(Some(&tokens)).as_deref(),
            Some("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@400&display=swap")
        );
        assert_eq!(google_fonts_url(None), None);
    }
}
