//! The commands of a project's design systems.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`.

use std::path::Path;

use tauri::State;

use super::design_system::{find_systems, SystemList};
use super::store::{is_session_id, FAILED};
use crate::files::{canonical_root, ensure_known_workspace};
use crate::store::AppStore;

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
}
