//! Inline visuals a session's agent showed: cleaned markup kept beside the session's artifacts,
//! never in the transcript. Design: `docs/superpowers/specs/2026-11-21-inline-visuals-design.md`.

use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::store::{clean_title_within, is_session_id, ArtifactStore, MAX_TITLE_CHARS};
use super::visual_clean::{clean, is_empty_visual, kind_of};
pub use super::visual_clean::{VisualKind, MAX_VISUAL_BYTES};
use crate::store::atomic_write;

pub const MAX_VISUALS: usize = 100;
/// A visual this young is never swept: its part may not have reached the transcript yet.
pub const SWEEP_GRACE: Duration = Duration::from_secs(60);
pub const VISUAL_TOO_LARGE: &str = "The visual is over 256 KB.";
pub const VISUAL_NOT_TEXT: &str = "The visual is not valid UTF-8 text.";
pub const VISUAL_EMPTY: &str = "There is nothing to show in that visual.";
pub const TOO_MANY_VISUALS: &str = "This session already has 100 visuals.";
pub const NEEDS_TITLE_VISUAL: &str = "Give the visual a title.";
/// `show_visual` takes its markup one way.
pub const VISUAL_ONE_SOURCE: &str = "Give show_visual either code or path, not both.";
pub const VISUAL_FAILED: &str = "Zorvo could not keep that visual.";
/// For the webview only: an agent never asks for a visual by id.
pub const VISUAL_GONE: &str = "That visual is no longer available.";

const VISUALS_DIR: &str = "visuals";
const VISUALS_FILE: &str = "visuals.json";
const VISUAL_ID_PREFIX: &str = "v-";
const VISUAL_ID_HEX_CHARS: usize = 16;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisualEntry {
    pub id: String,
    pub title: String,
    pub kind: VisualKind,
    pub bytes: u64,
    /// Milliseconds since the epoch.
    pub shown_at: u64,
}

pub fn is_visual_id(id: &str) -> bool {
    id.strip_prefix(VISUAL_ID_PREFIX).is_some_and(|hex| {
        hex.len() == VISUAL_ID_HEX_CHARS
            && hex
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    })
}

fn new_visual_id() -> Result<String, String> {
    use std::io::Read;
    let mut bytes = [0u8; VISUAL_ID_HEX_CHARS / 2];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| VISUAL_FAILED.to_string())?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{VISUAL_ID_PREFIX}{hex}"))
}

fn extension(kind: VisualKind) -> &'static str {
    match kind {
        VisualKind::Svg => "svg",
        VisualKind::Html => "html",
    }
}

/// Writes markup only its owner can read, then renames it into place.
fn write_private(path: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let written = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .and_then(|mut file| file.write_all(contents))
        .and_then(|()| fs::rename(&tmp, path));
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written.map_err(|_| VISUAL_FAILED.to_string())
}

impl ArtifactStore {
    fn visuals_dir(&self, session_id: &str) -> PathBuf {
        self.session_dir(session_id).join(VISUALS_DIR)
    }

    fn visual_path(&self, session_id: &str, entry: &VisualEntry) -> PathBuf {
        self.visuals_dir(session_id)
            .join(format!("{}.{}", entry.id, extension(entry.kind)))
    }

    fn read_visuals(&self, session_id: &str) -> Result<Vec<VisualEntry>, String> {
        match fs::read(self.session_dir(session_id).join(VISUALS_FILE)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| VISUAL_FAILED.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(VISUAL_FAILED.to_string()),
        }
    }

    fn write_visuals(&self, session_id: &str, entries: &[VisualEntry]) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        let bytes = serde_json::to_vec_pretty(entries).map_err(|_| VISUAL_FAILED.to_string())?;
        let tmp = dir.join(format!("{VISUALS_FILE}.{}.tmp", std::process::id()));
        atomic_write(&dir.join(VISUALS_FILE), &tmp, &bytes).map_err(|_| VISUAL_FAILED.to_string())
    }

    /// Cleans `raw` and keeps it as a new visual of the session. A refusal writes nothing.
    pub fn put_visual(
        &self,
        session_id: &str,
        title: &str,
        raw: &[u8],
        now_ms: u64,
    ) -> Result<VisualEntry, String> {
        if !is_session_id(session_id) {
            return Err(VISUAL_FAILED.to_string());
        }
        if raw.len() > MAX_VISUAL_BYTES {
            return Err(VISUAL_TOO_LARGE.to_string());
        }
        let text = std::str::from_utf8(raw).map_err(|_| VISUAL_NOT_TEXT.to_string())?;
        let title = clean_title_within(title, MAX_TITLE_CHARS)
            .ok_or_else(|| NEEDS_TITLE_VISUAL.to_string())?;
        let kind = kind_of(text);
        let cleaned = clean(text);
        if is_empty_visual(&cleaned) {
            return Err(VISUAL_EMPTY.to_string());
        }
        if cleaned.len() > MAX_VISUAL_BYTES {
            return Err(VISUAL_TOO_LARGE.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries = self.read_visuals(session_id)?;
        if entries.len() >= MAX_VISUALS {
            return Err(TOO_MANY_VISUALS.to_string());
        }
        let entry = VisualEntry {
            id: new_visual_id()?,
            title,
            kind,
            bytes: cleaned.len() as u64,
            shown_at: now_ms,
        };
        fs::create_dir_all(self.visuals_dir(session_id)).map_err(|_| VISUAL_FAILED.to_string())?;
        write_private(&self.visual_path(session_id, &entry), cleaned.as_bytes())?;
        entries.push(entry.clone());
        self.write_visuals(session_id, &entries)?;
        Ok(entry)
    }

    /// A visual's entry and its cleaned markup; `VISUAL_GONE` for anything else.
    pub fn visual(&self, session_id: &str, id: &str) -> Result<(VisualEntry, String), String> {
        let gone = || VISUAL_GONE.to_string();
        if !is_session_id(session_id) || !is_visual_id(id) {
            return Err(gone());
        }
        let entry = self
            .read_visuals(session_id)
            .map_err(|_| gone())?
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or_else(gone)?;
        let markup =
            fs::read_to_string(self.visual_path(session_id, &entry)).map_err(|_| gone())?;
        Ok((entry, markup))
    }

    /// Removes the visuals `keep` does not name that were shown at least `SWEEP_GRACE` ago, and
    /// says how many.
    pub fn keep_visuals(
        &self,
        session_id: &str,
        keep: &[String],
        now_ms: u64,
    ) -> Result<usize, String> {
        if !is_session_id(session_id) {
            return Err(VISUAL_FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let grace = SWEEP_GRACE.as_millis() as u64;
        let (kept, removed): (Vec<_>, Vec<_>) = self
            .read_visuals(session_id)?
            .into_iter()
            .partition(|entry| {
                keep.contains(&entry.id) || now_ms.saturating_sub(entry.shown_at) < grace
            });
        if removed.is_empty() {
            return Ok(0);
        }
        self.write_visuals(session_id, &kept)?;
        for entry in &removed {
            let _ = fs::remove_file(self.visual_path(session_id, entry));
        }
        Ok(removed.len())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::artifacts::test_support::Temp;

    const S: &str = "session-1794800000000-k3x9a";

    fn store() -> (Temp, ArtifactStore) {
        let temp = Temp::new("visuals");
        let store = ArtifactStore::new(temp.0.clone());
        (temp, store)
    }

    #[test]
    fn keeps_the_cleaned_markup_and_lists_it() {
        let (_temp, store) = store();
        let e = store
            .put_visual(S, "Flow", b"<svg><script>1</script><rect/></svg>", 1_000)
            .unwrap();
        assert!(is_visual_id(&e.id));
        assert_eq!(e.kind, VisualKind::Svg);
        assert_eq!(e.title, "Flow");
        let (entry, markup) = store.visual(S, &e.id).unwrap();
        assert_eq!(entry, e);
        assert!(markup.contains("<rect") && !markup.contains("script"));
    }

    #[test]
    fn refuses_by_rule_without_writing() {
        let (temp, store) = store();
        let big = vec![b'a'; MAX_VISUAL_BYTES + 1];
        assert_eq!(
            store.put_visual(S, "T", &big, 0).unwrap_err(),
            VISUAL_TOO_LARGE
        );
        assert_eq!(
            store.put_visual(S, "T", &[0xff, 0xfe], 0).unwrap_err(),
            VISUAL_NOT_TEXT
        );
        assert_eq!(
            store
                .put_visual(S, "T", b"<script>1</script>", 0)
                .unwrap_err(),
            VISUAL_EMPTY
        );
        assert_eq!(
            store.put_visual(S, "  ", b"<p>a</p>", 0).unwrap_err(),
            NEEDS_TITLE_VISUAL
        );
        assert_eq!(
            store.put_visual("../x", "T", b"<p>a</p>", 0).unwrap_err(),
            VISUAL_FAILED
        );
        let dir = temp.0.join(S).join("visuals");
        assert!(!dir.exists() || fs::read_dir(dir).unwrap().next().is_none());
    }

    #[test]
    fn stops_at_one_hundred() {
        let (_temp, store) = store();
        for n in 0..MAX_VISUALS {
            store.put_visual(S, "T", b"<p>a</p>", n as u64).unwrap();
        }
        assert_eq!(
            store.put_visual(S, "T", b"<p>a</p>", 0).unwrap_err(),
            TOO_MANY_VISUALS
        );
    }

    #[test]
    fn sweep_keeps_named_and_recent_ones() {
        let (_temp, store) = store();
        let old = store.put_visual(S, "A", b"<p>a</p>", 0).unwrap();
        let kept = store.put_visual(S, "B", b"<p>b</p>", 0).unwrap();
        let fresh = store.put_visual(S, "C", b"<p>c</p>", 100_000).unwrap();
        let removed = store.keep_visuals(S, std::slice::from_ref(&kept.id), 100_000 + 59_000);
        assert_eq!(removed.unwrap(), 1);
        assert_eq!(store.visual(S, &old.id).unwrap_err(), VISUAL_GONE);
        assert!(store.visual(S, &kept.id).is_ok() && store.visual(S, &fresh.id).is_ok());
    }

    #[test]
    fn an_unknown_or_malformed_id_is_gone() {
        let (_temp, store) = store();
        assert_eq!(
            store.visual(S, "v-0000000000000000").unwrap_err(),
            VISUAL_GONE
        );
        assert_eq!(store.visual(S, "../x").unwrap_err(), VISUAL_GONE);
    }

    #[test]
    fn deleting_the_session_removes_its_visuals() {
        let (_temp, store) = store();
        let e = store.put_visual(S, "A", b"<p>a</p>", 0).unwrap();
        store.delete_session(S).unwrap();
        assert_eq!(store.visual(S, &e.id).unwrap_err(), VISUAL_GONE);
    }

    #[test]
    fn a_stored_file_is_private_and_named_by_kind() {
        use std::os::unix::fs::PermissionsExt;
        let (temp, store) = store();
        let svg = store.put_visual(S, "A", b"<svg><rect/></svg>", 0).unwrap();
        let html = store.put_visual(S, "B", b"<p>a</p>", 0).unwrap();
        let dir = temp.0.join(S).join("visuals");
        let mode = fs::metadata(dir.join(format!("{}.svg", svg.id)))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert!(dir.join(format!("{}.html", html.id)).exists());
    }
}
