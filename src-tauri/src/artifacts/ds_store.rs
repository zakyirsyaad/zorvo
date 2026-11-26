//! The design systems a session showed: `design-systems.json` beside the session's
//! `canvases.json`. Zorvo keeps no copy of a system; forgetting an entry leaves its files alone.

use serde::{Deserialize, Serialize};

use super::design_system::is_ds_key;
use super::store::{is_session_id, ArtifactStore, FAILED};

const DESIGN_SYSTEMS_FILE: &str = "design-systems.json";
pub const MAX_DESIGN_SYSTEMS: usize = 50;
pub const TOO_MANY_DESIGN_SYSTEMS: &str =
    "This session already has 50 design systems. The user can remove one in Zorvo.";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignSystemEntry {
    /// `system_key` of the folder: derived, never issued.
    pub key: String,
    pub folder: String,
    pub relative: String,
    pub title: String,
    pub tokens: u32,
    pub components: u32,
    pub shown_at: u64,
}

impl ArtifactStore {
    /// Remembers a shown system under its derived key, replacing an entry with that key.
    pub fn remember_design_system(
        &self,
        session_id: &str,
        entry: DesignSystemEntry,
    ) -> Result<DesignSystemEntry, String> {
        if !is_session_id(session_id) || !is_ds_key(&entry.key) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<DesignSystemEntry> =
            self.read_list(session_id, DESIGN_SYSTEMS_FILE)?;
        match entries.iter().position(|e| e.key == entry.key) {
            Some(at) => entries[at] = entry.clone(),
            None if entries.len() >= MAX_DESIGN_SYSTEMS => {
                return Err(TOO_MANY_DESIGN_SYSTEMS.to_string())
            }
            None => entries.push(entry.clone()),
        }
        self.write_list(session_id, DESIGN_SYSTEMS_FILE, &entries)?;
        Ok(entry)
    }

    /// Newest shown first.
    pub fn design_systems(&self, session_id: &str) -> Result<Vec<DesignSystemEntry>, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<DesignSystemEntry> =
            self.read_list(session_id, DESIGN_SYSTEMS_FILE)?;
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.shown_at));
        Ok(entries)
    }

    pub fn design_system(&self, session_id: &str, key: &str) -> Option<DesignSystemEntry> {
        if !is_ds_key(key) {
            return None;
        }
        self.design_systems(session_id)
            .ok()?
            .into_iter()
            .find(|entry| entry.key == key)
    }

    /// Forgets a system by its key; its files stay.
    pub fn forget_design_system(&self, session_id: &str, key: &str) -> Result<(), String> {
        if !is_session_id(session_id) || !is_ds_key(key) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let kept: Vec<DesignSystemEntry> = self
            .read_list::<DesignSystemEntry>(session_id, DESIGN_SYSTEMS_FILE)?
            .into_iter()
            .filter(|entry| entry.key != key)
            .collect();
        self.write_list(session_id, DESIGN_SYSTEMS_FILE, &kept)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    fn entry(n: u32, title: &str, shown_at: u64) -> DesignSystemEntry {
        DesignSystemEntry {
            key: format!("d-{n:016x}"),
            folder: format!("/w/app/ds{n}"),
            relative: format!("ds{n}"),
            title: title.to_string(),
            tokens: 4,
            components: 2,
            shown_at,
        }
    }

    #[test]
    fn the_same_key_keeps_one_entry_and_updates_it() {
        let data = Temp::new("ds-store");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        store
            .remember_design_system("s1", entry(1, "One", 1))
            .unwrap();
        let again = DesignSystemEntry {
            tokens: 9,
            components: 3,
            ..entry(1, "Two", 2)
        };
        assert_eq!(
            store.remember_design_system("s1", again.clone()).unwrap(),
            again
        );
        assert_eq!(store.design_systems("s1").unwrap(), vec![again.clone()]);
        assert_eq!(store.design_system("s1", &again.key), Some(again));
    }

    #[test]
    fn newest_first_and_forgotten_by_key() {
        let data = Temp::new("ds-store-order");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        store
            .remember_design_system("s1", entry(1, "A", 1))
            .unwrap();
        store
            .remember_design_system("s1", entry(2, "B", 5))
            .unwrap();
        let titles: Vec<String> = store
            .design_systems("s1")
            .unwrap()
            .into_iter()
            .map(|e| e.title)
            .collect();
        assert_eq!(titles, ["B", "A"]);
        store
            .forget_design_system("s1", &entry(1, "", 0).key)
            .unwrap();
        assert!(store.design_system("s1", &entry(1, "", 0).key).is_none());
        assert!(store.design_system("s1", &entry(2, "", 0).key).is_some());
        assert!(store.forget_design_system("s1", "c-1").is_err());
    }

    #[test]
    fn the_51st_is_refused() {
        let data = Temp::new("ds-store-many");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        for n in 0..MAX_DESIGN_SYSTEMS as u32 {
            store
                .remember_design_system("s1", entry(n, "T", 1))
                .unwrap();
        }
        assert_eq!(
            store
                .remember_design_system("s1", entry(99, "T", 1))
                .unwrap_err(),
            TOO_MANY_DESIGN_SYSTEMS
        );
        // An entry already there is still updated.
        assert!(store
            .remember_design_system("s1", entry(0, "New", 2))
            .is_ok());
    }

    #[test]
    fn refuses_a_bad_key_or_session_id() {
        let data = Temp::new("ds-store-bad");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        let bad_key = DesignSystemEntry {
            key: "c-0123456789abcdef".into(),
            ..entry(1, "T", 1)
        };
        assert_eq!(
            store.remember_design_system("s1", bad_key).unwrap_err(),
            FAILED
        );
        assert!(store
            .remember_design_system("../x", entry(1, "T", 1))
            .is_err());
        assert!(store.design_systems("../x").is_err());
        assert!(store.design_system("s1", "../x").is_none());
    }
}
