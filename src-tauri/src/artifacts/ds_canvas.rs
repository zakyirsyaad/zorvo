//! A canvas that names a design system in `canvas.json`: the system it links, what its artboards
//! load from it under `_ds/`, and the picture key that follows the system and the chosen theme.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 4.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::canvas::{digest_where, Canvas, MAX_DIGEST_ENTRIES};
use super::design_system::{parse_index, system_key, INDEX_FILE};
use super::ds_protocol::themes_of;
use super::source::read_checked;

/// The virtual folder an artboard loads its canvas's design system from.
pub const DS_FOLDER: &str = "_ds";

/// The system a canvas links: its derived key, canonical folder and themes.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkedSystem {
    pub key: String,
    pub root: PathBuf,
    pub themes: Vec<String>,
}

/// What a canvas read says about its system, for the header.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSystem {
    /// As `canvas.json` writes it.
    pub path: String,
    pub key: Option<String>,
    pub themes: Vec<String>,
    pub is_missing: bool,
    /// A real `_ds` folder in the canvas folder, hidden by the virtual one.
    pub hides_ds_folder: bool,
}

/// The session's folder a remembered folder was shown from: its canonical path minus `relative`.
pub fn session_folder_of(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut session = fs::canonicalize(root).ok()?;
    for _ in relative
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
    {
        if !session.pop() {
            return None;
        }
    }
    fs::canonicalize(session).ok()
}

/// The system `design_system` names, relative to the canvas folder: it must stay inside the
/// session's folder once canonical and hold an index that parses. `None` otherwise.
pub fn linked_system(
    canvas_root: &Path,
    session_folder: &Path,
    design_system: &str,
) -> Option<LinkedSystem> {
    let root = fs::canonicalize(canvas_root.join(design_system)).ok()?;
    let session = fs::canonicalize(session_folder).ok()?;
    if !root.starts_with(&session) || !root.is_dir() {
        return None;
    }
    parse_index(&read_checked(&root.join(INDEX_FILE)).ok()?).ok()?;
    Some(LinkedSystem {
        key: system_key(&root),
        themes: themes_of(&root),
        root,
    })
}

/// What a canvas read reports about the system `canvas.json` names; `None` when it names none.
pub fn canvas_system(
    canvas_root: &Path,
    session_folder: &Path,
    canvas: &Canvas,
) -> Option<CanvasSystem> {
    let path = canvas.design_system.clone()?;
    let hides_ds_folder = canvas_root.join(DS_FOLDER).is_dir();
    Some(match linked_system(canvas_root, session_folder, &path) {
        Some(system) => CanvasSystem {
            path,
            key: Some(system.key),
            themes: system.themes,
            is_missing: false,
            hides_ds_folder,
        },
        None => CanvasSystem {
            path,
            key: None,
            themes: Vec::new(),
            is_missing: true,
            hides_ds_folder,
        },
    })
}

/// A digest of the system's servable files (path, size, modification time), hidden files and
/// folders left out, so a new logo or token value draws new pictures.
pub fn system_digest(system_root: &Path) -> String {
    digest_where(system_root, MAX_DIGEST_ENTRIES, &|relative: &str| {
        !relative
            .split('/')
            .any(|part| !part.is_empty() && part.starts_with('.'))
    })
}

/// What a picture and a live frame are keyed by: the artboard's own key, and when the canvas
/// links a system, that system's digest and the theme. Without a system it is the board key, so
/// pictures cached before stay valid.
pub fn picture_key(board_key: &str, system: Option<(&str, &str)>) -> String {
    match system {
        None => board_key.to_string(),
        Some((digest, theme)) => {
            let bytes = Sha256::digest(format!("{board_key}\0{digest}\0{theme}"));
            bytes.iter().map(|byte| format!("{byte:02x}")).collect()
        }
    }
}

/// The theme a request may use: the one asked for when the system has it, else the first.
pub fn chosen_theme(themes: &[String], asked: Option<&str>) -> Option<String> {
    asked
        .filter(|asked| themes.iter().any(|theme| theme == asked))
        .map(str::to_string)
        .or_else(|| themes.first().cloned())
}

#[cfg(test)]
mod tests {
    use super::super::test_support::Temp;
    use super::*;

    fn system(root: &Path, relative: &str, accent: &str) -> PathBuf {
        let folder = root.join(relative);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(INDEX_FILE), r#"{"title": "Acme"}"#).unwrap();
        fs::write(
            folder.join("tokens.json"),
            format!(
                r##"{{"color": {{"themes": [{{"id": "dark", "name": "Dark"}}, {{"id": "light", "name": "Light"}}],
                "tokens": [{{"name": "accent", "value": {{"dark": "{accent}", "light": "#ffffff"}}}}]}}}}"##
            ),
        )
        .unwrap();
        folder
    }

    #[test]
    fn links_a_system_inside_the_session_folder_only() {
        let temp = Temp::new("ds-canvas-link");
        system(&temp.0, "docs/ds", "#111111");
        let canvas = temp.0.join("design/checkout");
        fs::create_dir_all(&canvas).unwrap();
        let linked = linked_system(&canvas, &temp.0, "../../docs/ds").expect("linked");
        assert_eq!(linked.themes, vec!["dark".to_string(), "light".to_string()]);
        assert!(linked_system(&canvas, &temp.0, "../../../outside").is_none());
        assert!(linked_system(&canvas, &temp.0, "../../docs/missing").is_none());
        let inner = temp.0.join("docs");
        assert!(linked_system(&canvas, &inner.join("ds/x"), "../../docs/ds").is_none());
    }

    #[test]
    fn reports_a_missing_system_and_a_hidden_ds_folder() {
        let temp = Temp::new("ds-canvas-missing");
        let canvas_root = temp.0.join("c");
        fs::create_dir_all(canvas_root.join(DS_FOLDER)).unwrap();
        let canvas = Canvas {
            title: "T".into(),
            sections: Vec::new(),
            design_system: Some("../nowhere".into()),
        };
        let reported = canvas_system(&canvas_root, &temp.0, &canvas).expect("named");
        assert!(reported.is_missing);
        assert!(reported.hides_ds_folder);
        assert_eq!(reported.path, "../nowhere");
        let none = Canvas {
            design_system: None,
            ..canvas
        };
        assert_eq!(canvas_system(&canvas_root, &temp.0, &none), None);
    }

    #[test]
    fn picture_key_changes_with_a_token_an_asset_and_the_theme_while_the_board_key_stays() {
        let temp = Temp::new("ds-canvas-key");
        let root = system(&temp.0, "ds", "#111111");
        let first = system_digest(&root);
        let dark = picture_key("board", Some((&first, "dark")));
        assert_ne!(dark, picture_key("board", Some((&first, "light"))));
        std::thread::sleep(std::time::Duration::from_millis(20));
        system(&temp.0, "ds", "#222222");
        let changed = system_digest(&root);
        assert_ne!(first, changed);
        fs::create_dir_all(root.join("assets/Logos")).unwrap();
        fs::write(root.join("assets/Logos/mark.svg"), "<svg/>").unwrap();
        assert_ne!(changed, system_digest(&root));
        assert_eq!(picture_key("board", None), "board");
    }

    #[test]
    fn system_digest_skips_hidden_files() {
        let temp = Temp::new("ds-canvas-hidden");
        let root = system(&temp.0, "ds", "#111111");
        let before = system_digest(&root);
        fs::write(root.join(".DS_Store"), "x").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config.json"), "{}").unwrap();
        assert_eq!(before, system_digest(&root));
    }

    #[test]
    fn chosen_theme_falls_back_to_the_first() {
        let themes = vec!["dark".to_string(), "light".to_string()];
        assert_eq!(
            chosen_theme(&themes, Some("light")).as_deref(),
            Some("light")
        );
        assert_eq!(
            chosen_theme(&themes, Some("sepia")).as_deref(),
            Some("dark")
        );
        assert_eq!(chosen_theme(&themes, None).as_deref(), Some("dark"));
        assert_eq!(chosen_theme(&[], None), None);
    }

    #[test]
    fn session_folder_of_strips_the_relative_path() {
        let temp = Temp::new("ds-canvas-session");
        let canvas = temp.0.join("design/x");
        fs::create_dir_all(&canvas).unwrap();
        assert_eq!(
            session_folder_of(&canvas, "design/x"),
            fs::canonicalize(&temp.0).ok()
        );
        assert_eq!(
            session_folder_of(&temp.0, "."),
            fs::canonicalize(&temp.0).ok()
        );
    }
}
