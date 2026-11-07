//! What Zorvo Private keeps on this Mac besides the Keychain: recovery flags,
//! the top-up in flight, the last balance and the last model list. Holds no
//! secret (no recovery code, no key). Read leniently, so a hand-edited or
//! older file never blocks the app; written atomically with owner-only
//! permissions.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::client::ModelPrice;
use super::PrivateError;

const STATE_FILE: &str = "state.json";
const DIR_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

/// How many private ACP session ids are remembered; the oldest go first.
/// Accepted limit: once more than this many private sessions exist, the oldest
/// id is forgotten and that session could be opened plainly (the guard fails
/// open for it).
pub const MAX_PRIVATE_SESSIONS: usize = 1000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTopup {
    pub topup_id: String,
    pub expires_at: String,
    pub credits: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastBalance {
    pub credits: u64,
    pub used_credits: u64,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedModels {
    pub at: String,
    pub list: Vec<ModelPrice>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalState {
    pub recovery_saved: bool,
    pub recovery_prompted: bool,
    pub pending_topup: Option<PendingTopup>,
    pub last_balance: Option<LastBalance>,
    pub models: Option<CachedModels>,
    /// Epoch ms until which a rotated key is expected after a recovery: a key
    /// missing before then is on its way, not lost.
    pub rotation_expected_until: Option<i64>,
    /// The server answered `401` to this Mac's secret: its credits moved.
    pub moved: bool,
    /// ACP session ids started privately, lower-cased (the agent's store is
    /// read case-insensitively on macOS), oldest first. The agent keeps those
    /// sessions in its own store, so this is how Zorvo knows to never open one
    /// without private mode. Ids only, no secret. Accepted limit: a state file
    /// that is malformed reads as empty, so the record is lost with it.
    pub private_sessions: Vec<String>,
}

/// One field of the file, or `None` when it is absent or has the wrong shape.
fn field<T: DeserializeOwned>(object: &Map<String, Value>, key: &str) -> Option<T> {
    object
        .get(key)
        .and_then(|value| serde_json::from_value(value.clone()).ok())
}

/// The string items of `privateSessions`, lower-cased, without empty ones or
/// repeats, newest `MAX_PRIVATE_SESSIONS` kept; anything but an array is no
/// sessions.
fn private_sessions_of(object: &Map<String, Value>) -> Vec<String> {
    let Some(Value::Array(items)) = object.get("privateSessions") else {
        return Vec::new();
    };
    let mut ids: Vec<String> = Vec::new();
    for id in items.iter().filter_map(Value::as_str) {
        let id = id.to_ascii_lowercase();
        if !id.is_empty() && !ids.contains(&id) {
            ids.push(id);
        }
    }
    let excess = ids.len().saturating_sub(MAX_PRIVATE_SESSIONS);
    ids.drain(..excess);
    ids
}

impl LocalState {
    /// `<dir>/state.json`. A missing or malformed file is the default; a field
    /// of the wrong type is its default and the others are kept.
    pub fn load(dir: &Path) -> LocalState {
        let parsed = fs::read_to_string(dir.join(STATE_FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        let Some(Value::Object(object)) = parsed else {
            return LocalState::default();
        };
        LocalState {
            recovery_saved: field(&object, "recoverySaved").unwrap_or_default(),
            recovery_prompted: field(&object, "recoveryPrompted").unwrap_or_default(),
            pending_topup: field(&object, "pendingTopup"),
            last_balance: field(&object, "lastBalance"),
            models: field(&object, "models"),
            rotation_expected_until: field(&object, "rotationExpectedUntil"),
            moved: field(&object, "moved").unwrap_or_default(),
            private_sessions: private_sessions_of(&object),
        }
    }

    /// This state with `acp_session_id` recorded as private, lower-cased:
    /// appended unless already there, and the oldest dropped past
    /// [`MAX_PRIVATE_SESSIONS`].
    pub fn with_private_session(self, acp_session_id: &str) -> LocalState {
        let id = acp_session_id.to_ascii_lowercase();
        if self.private_sessions.contains(&id) {
            return self;
        }
        let mut private_sessions = self.private_sessions;
        private_sessions.push(id);
        let excess = private_sessions.len().saturating_sub(MAX_PRIVATE_SESSIONS);
        private_sessions.drain(..excess);
        LocalState {
            private_sessions,
            ..self
        }
    }

    /// Writes a temp file in `dir` and renames it over `state.json`, creating
    /// `dir` owner-only when it does not exist.
    pub fn save(&self, dir: &Path) -> Result<(), PrivateError> {
        let json = serde_json::to_vec_pretty(self).map_err(|_| PrivateError::Storage)?;
        create_private_dir(dir)?;
        let tmp = dir.join(unique_tmp_name());
        let written =
            write_private_file(&tmp, &json).and_then(|()| fs::rename(&tmp, dir.join(STATE_FILE)));
        if written.is_err() {
            // Best effort: a failed save must not leave its scratch file behind.
            let _ = fs::remove_file(&tmp);
        }
        written.map_err(|_| PrivateError::Storage)
    }
}

/// A temp name no other save uses, even from a second app process.
fn unique_tmp_name() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    format!("{STATE_FILE}.{}.{n}.tmp", std::process::id())
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> Result<(), PrivateError> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(DIR_MODE)
        .create(dir)
        .map_err(|_| PrivateError::Storage)
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> Result<(), PrivateError> {
    fs::create_dir_all(dir).map_err(|_| PrivateError::Storage)
}

#[cfg(unix)]
fn write_private_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(FILE_MODE)
        .open(path)?;
    file.write_all(contents)
}

#[cfg(not(unix))]
fn write_private_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn scratch_dir() -> std::path::PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "zorvo-local-state-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn sample() -> LocalState {
        LocalState {
            recovery_saved: true,
            recovery_prompted: true,
            pending_topup: Some(PendingTopup {
                topup_id: "t1".into(),
                expires_at: "2026-11-07T02:00:00Z".into(),
                credits: 1000,
            }),
            last_balance: Some(LastBalance {
                credits: 900,
                used_credits: 100,
                at: "2026-11-07T01:00:00Z".into(),
            }),
            models: Some(CachedModels {
                at: "2026-11-07T01:00:00Z".into(),
                list: vec![ModelPrice {
                    id: "qwen3-30b".into(),
                    input_per_m: 0.15,
                    output_per_m: 0.6,
                }],
            }),
            rotation_expected_until: Some(1_762_480_800_000),
            moved: true,
            private_sessions: vec!["acp-1".into(), "acp-2".into()],
        }
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = scratch_dir();
        let state = sample();
        state.save(&dir).expect("saves");
        assert_eq!(LocalState::load(&dir), state);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_malformed_file_loads_the_default() {
        let dir = scratch_dir();
        assert_eq!(LocalState::load(&dir), LocalState::default());

        std::fs::create_dir_all(&dir).expect("dir");
        for junk in ["", "not json", "[1,2]", "7", "null"] {
            std::fs::write(dir.join(STATE_FILE), junk).expect("write");
            assert_eq!(LocalState::load(&dir), LocalState::default(), "{junk:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_wrong_typed_field_falls_back_and_the_others_are_kept() {
        let dir = scratch_dir();
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(
            dir.join(STATE_FILE),
            r#"{"recoverySaved":true,"recoveryPrompted":"yes","pendingTopup":7,
                "lastBalance":{"credits":"many"},"models":{"at":"t","list":[]},
                "rotationExpectedUntil":"soon","moved":"maybe"}"#,
        )
        .expect("write");

        let loaded = LocalState::load(&dir);

        assert!(loaded.recovery_saved);
        assert!(!loaded.recovery_prompted);
        assert_eq!(loaded.pending_topup, None);
        assert_eq!(loaded.last_balance, None);
        assert_eq!(loaded.rotation_expected_until, None);
        assert!(!loaded.moved);
        assert_eq!(
            loaded.models,
            Some(CachedModels {
                at: "t".into(),
                list: vec![]
            })
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn load_text(text: &str) -> LocalState {
        let dir = scratch_dir();
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(dir.join(STATE_FILE), text).expect("write");
        let loaded = LocalState::load(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        loaded
    }

    #[test]
    fn private_sessions_skip_items_that_are_not_strings_and_repeats() {
        let loaded = load_text(r#"{"privateSessions":["a",1,null,"b",{"x":1},"a",""]}"#);

        assert_eq!(loaded.private_sessions, ["a", "b"]);
    }

    #[test]
    fn stored_private_session_ids_load_lower_cased_and_without_case_repeats() {
        let loaded = load_text(r#"{"privateSessions":["ABC-1","b","abc-1","B"]}"#);

        assert_eq!(loaded.private_sessions, ["abc-1", "b"]);
    }

    #[test]
    fn with_private_session_stores_lower_case_and_sees_another_case_as_a_repeat() {
        let state = LocalState::default()
            .with_private_session("ACP-1")
            .with_private_session("acp-1");

        assert_eq!(state.private_sessions, ["acp-1"]);
    }

    #[test]
    fn private_sessions_of_the_wrong_shape_are_empty_and_the_rest_is_kept() {
        for junk in ["\"a\"", "7", "{\"a\":1}", "null", "true"] {
            let loaded = load_text(&format!(
                r#"{{"recoverySaved":true,"privateSessions":{junk}}}"#
            ));

            assert!(loaded.private_sessions.is_empty(), "{junk}");
            assert!(loaded.recovery_saved, "{junk}");
        }
    }

    #[test]
    fn a_hand_edited_file_with_too_many_private_sessions_keeps_the_newest() {
        let ids: Vec<String> = (0..MAX_PRIVATE_SESSIONS + 5)
            .map(|n| format!("\"s{n}\""))
            .collect();
        let loaded = load_text(&format!(r#"{{"privateSessions":[{}]}}"#, ids.join(",")));

        assert_eq!(loaded.private_sessions.len(), MAX_PRIVATE_SESSIONS);
        assert_eq!(
            loaded.private_sessions.first().map(String::as_str),
            Some("s5")
        );
        assert_eq!(
            loaded.private_sessions.last().map(String::as_str),
            Some("s1004")
        );
    }

    #[test]
    fn with_private_session_appends_in_order_and_never_repeats() {
        let state = LocalState::default()
            .with_private_session("a")
            .with_private_session("b")
            .with_private_session("a");

        assert_eq!(state.private_sessions, ["a", "b"]);
    }

    #[test]
    fn with_private_session_drops_the_oldest_past_the_cap() {
        let mut state = LocalState::default();
        for n in 0..MAX_PRIVATE_SESSIONS {
            state = state.with_private_session(&format!("s{n}"));
        }
        assert_eq!(state.private_sessions.len(), MAX_PRIVATE_SESSIONS);

        let state = state.with_private_session("newest");

        assert_eq!(state.private_sessions.len(), MAX_PRIVATE_SESSIONS);
        assert_eq!(
            state.private_sessions.first().map(String::as_str),
            Some("s1")
        );
        assert_eq!(
            state.private_sessions.last().map(String::as_str),
            Some("newest")
        );
        assert!(!state.private_sessions.iter().any(|id| id == "s0"));
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let dir = scratch_dir();
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(dir.join(STATE_FILE), r#"{"recoverySaved":true,"future":1}"#)
            .expect("write");
        assert!(LocalState::load(&dir).recovery_saved);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn save_creates_the_dir_owner_only_and_the_file_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch_dir().join("nested");
        sample().save(&dir).expect("saves");
        let dir_mode = std::fs::metadata(&dir).expect("dir").permissions().mode() & 0o777;
        let file_mode = std::fs::metadata(dir.join(STATE_FILE))
            .expect("file")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
        let _ = std::fs::remove_dir_all(dir.parent().expect("parent"));
    }

    #[test]
    fn save_leaves_no_temp_file_and_replaces_the_old_one() {
        let dir = scratch_dir();
        sample().save(&dir).expect("first save");
        LocalState::default().save(&dir).expect("second save");

        assert_eq!(LocalState::load(&dir), LocalState::default());
        let names: Vec<String> = std::fs::read_dir(&dir)
            .expect("dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(names, vec![STATE_FILE.to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_file_holds_no_secret_fields() {
        let dir = scratch_dir();
        sample().save(&dir).expect("saves");
        let text = std::fs::read_to_string(dir.join(STATE_FILE)).expect("read");
        for word in ["recoveryCode", "secret", "key\""] {
            assert!(!text.contains(word), "{word} in {text}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_reports_a_storage_error_when_the_dir_cannot_be_made() {
        let dir = scratch_dir();
        std::fs::write(&dir, "a file, not a folder").expect("blocker");
        assert_eq!(sample().save(&dir.join("sub")), Err(PrivateError::Storage));
        let _ = std::fs::remove_file(&dir);
    }
}
