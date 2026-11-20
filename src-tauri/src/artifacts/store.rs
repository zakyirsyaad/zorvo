//! Versioned copies of the pages a session's agent has shown.
//!
//! `<root>/<sessionId>/index.json` lists the session's artifacts and
//! `<root>/<sessionId>/<artifactId>/<n>.html` holds one stored page. The
//! backend owns all of it; nothing about artifacts is in `state.json`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::store::atomic_write;

pub const MAX_VERSIONS: usize = 20;
pub const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ARTIFACTS: usize = 50;
pub const MAX_TITLE_CHARS: usize = 60;
pub const NEEDS_TITLE: &str = "Give the page a title the first time you show it.";
pub const TOO_MANY: &str = "This session already has 50 pages. The user can delete one in Zorvo.";
/// Said for anything that is Zorvo's own fault or a malformed id; never the cause.
pub const FAILED: &str = "Zorvo could not keep that page.";
const NO_SUCH_ARTIFACT: &str = "That artifact does not exist.";

pub const MAX_CANVASES: usize = 50;
pub const TOO_MANY_CANVASES: &str =
    "This session already has 50 canvases. The user can remove one in Zorvo.";

const INDEX_FILE: &str = "index.json";
const CANVASES_FILE: &str = "canvases.json";
const CANVAS_KEY_PREFIX: &str = "c-";
const MAX_SESSION_ID_CHARS: usize = 80;
const ARTIFACT_ID_PREFIX: &str = "a-";
const ARTIFACT_ID_HEX_CHARS: usize = 16;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactVersion {
    pub n: u32,
    pub at: u64,
    pub bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub id: String,
    pub title: String,
    pub source_path: String,
    pub versions: Vec<ArtifactVersion>,
}

/// What `show` did: the artifact as it now is and the version to display.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    pub artifact: ArtifactRecord,
    pub version: u32,
    pub is_new_artifact: bool,
    pub is_new_version: bool,
}

/// A canvas Zorvo showed in a session, found again by its folder.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEntry {
    pub key: String,
    pub folder: String,
    pub relative: String,
    pub title: String,
    pub shown_at: u64,
    /// How many artboards the canvas had when it was last shown; 0 in an index from before.
    #[serde(default)]
    pub artboards: u32,
}

pub fn is_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SESSION_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn is_artifact_id(id: &str) -> bool {
    id.strip_prefix(ARTIFACT_ID_PREFIX).is_some_and(|hex| {
        hex.len() == ARTIFACT_ID_HEX_CHARS
            && hex
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    })
}

pub fn is_canvas_key(id: &str) -> bool {
    id.strip_prefix(CANVAS_KEY_PREFIX).is_some_and(|hex| {
        hex.len() == ARTIFACT_ID_HEX_CHARS
            && hex
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    })
}

/// Characters that reorder a line or break it: a title is one row of plain text.
fn reshapes_a_line(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Characters that draw nothing by themselves. They stay inside a title (a
/// joined emoji needs them) but a title made only of them reads as empty.
fn draws_nothing(c: char) -> bool {
    c.is_whitespace()
        || matches!(
            c,
            '\u{00AD}'
                | '\u{034F}'
                | '\u{115F}'
                | '\u{1160}'
                | '\u{17B4}'
                | '\u{17B5}'
                | '\u{180B}'..='\u{180F}'
                | '\u{200B}'..='\u{200D}'
                | '\u{2060}'..='\u{2064}'
                | '\u{206A}'..='\u{206F}'
                | '\u{3164}'
                | '\u{FE00}'..='\u{FE0F}'
                | '\u{FEFF}'
                | '\u{FFA0}'
                | '\u{E0000}'..='\u{E0FFF}'
        )
}

/// A title as it is stored: without what reorders or breaks its line, trimmed,
/// at most 60 characters; `None` when nothing of it could be read.
fn clean_title(title: &str) -> Option<String> {
    clean_title_within(title, MAX_TITLE_CHARS)
}

/// `clean_title` with a limit of the caller's choosing.
pub(crate) fn clean_title_within(title: &str, max_chars: usize) -> Option<String> {
    let kept: String = title
        .chars()
        // A break between words stays a gap, so the words do not run together.
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !reshapes_a_line(*c))
        .collect();
    let cut: String = kept.trim().chars().take(max_chars).collect();
    let cut = cut.trim_end().to_string();
    cut.chars().any(|c| !draws_nothing(c)).then_some(cut)
}

fn new_artifact_id() -> Result<String, String> {
    let mut bytes = [0u8; ARTIFACT_ID_HEX_CHARS / 2];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| FAILED.to_string())?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{ARTIFACT_ID_PREFIX}{hex}"))
}

fn new_canvas_key() -> Result<String, String> {
    let mut bytes = [0u8; ARTIFACT_ID_HEX_CHARS / 2];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| FAILED.to_string())?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{CANVAS_KEY_PREFIX}{hex}"))
}

/// Writes a page only its owner can read, then renames it into place.
fn write_private(path: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("html.{}.tmp", std::process::id()));
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
    written.map_err(|_| FAILED.to_string())
}

fn newest_at(record: &ArtifactRecord) -> u64 {
    record.versions.last().map_or(0, |version| version.at)
}

pub struct ArtifactStore {
    root: PathBuf,
    max_versions: usize,
    max_artifact_bytes: u64,
    /// One lock per session, so two shows for one session never interleave.
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl ArtifactStore {
    /// `root` is `<data dir>/artifacts`.
    pub fn new(root: PathBuf) -> Self {
        Self::with_limits(root, MAX_VERSIONS, MAX_ARTIFACT_BYTES)
    }

    /// As `new`, with other limits per artifact (tests use small ones).
    pub fn with_limits(root: PathBuf, max_versions: usize, max_artifact_bytes: u64) -> Self {
        Self {
            root,
            max_versions,
            max_artifact_bytes,
            locks: Mutex::new(HashMap::new()),
        }
    }

    fn session_dir(&self, session_id: &str) -> PathBuf {
        self.root.join(session_id)
    }

    fn page_path(&self, session_id: &str, artifact_id: &str, version: u32) -> PathBuf {
        self.session_dir(session_id)
            .join(artifact_id)
            .join(format!("{version}.html"))
    }

    fn lock_for(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().unwrap_or_else(|e| e.into_inner());
        Arc::clone(locks.entry(session_id.to_string()).or_default())
    }

    /// The session's records in stored order; `Ok(vec![])` when it has no index.
    fn read_index(&self, session_id: &str) -> Result<Vec<ArtifactRecord>, String> {
        let path = self.session_dir(session_id).join(INDEX_FILE);
        match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| FAILED.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(FAILED.to_string()),
        }
    }

    fn write_index(&self, session_id: &str, records: &[ArtifactRecord]) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        let bytes = serde_json::to_vec_pretty(records).map_err(|_| FAILED.to_string())?;
        let tmp = dir.join(format!("{INDEX_FILE}.{}.tmp", std::process::id()));
        atomic_write(&dir.join(INDEX_FILE), &tmp, &bytes).map_err(|_| FAILED.to_string())
    }

    /// The session's remembered canvases in stored order; empty when it has none.
    fn read_canvases(&self, session_id: &str) -> Result<Vec<CanvasEntry>, String> {
        let path = self.session_dir(session_id).join(CANVASES_FILE);
        match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| FAILED.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(FAILED.to_string()),
        }
    }

    fn write_canvases(&self, session_id: &str, entries: &[CanvasEntry]) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        fs::create_dir_all(&dir).map_err(|_| FAILED.to_string())?;
        let bytes = serde_json::to_vec_pretty(entries).map_err(|_| FAILED.to_string())?;
        let tmp = dir.join(format!("{CANVASES_FILE}.{}.tmp", std::process::id()));
        atomic_write(&dir.join(CANVASES_FILE), &tmp, &bytes).map_err(|_| FAILED.to_string())
    }

    /// Remembers a shown canvas: the same canonical folder keeps its key and
    /// takes the new title and time.
    pub fn remember_canvas(
        &self,
        session_id: &str,
        folder: &super::canvas::CanvasFolder,
        title: &str,
        artboards: u32,
        now: u64,
    ) -> Result<CanvasEntry, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let root = folder.root.to_string_lossy().into_owned();
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries = self.read_canvases(session_id)?;
        let entry = if let Some(existing) = entries.iter_mut().find(|e| e.folder == root) {
            existing.title = title.to_string();
            existing.relative = folder.relative.clone();
            existing.shown_at = now;
            existing.artboards = artboards;
            existing.clone()
        } else {
            if entries.len() >= MAX_CANVASES {
                return Err(TOO_MANY_CANVASES.to_string());
            }
            let entry = CanvasEntry {
                key: new_canvas_key()?,
                folder: root,
                relative: folder.relative.clone(),
                title: title.to_string(),
                shown_at: now,
                artboards,
            };
            entries.push(entry.clone());
            entry
        };
        self.write_canvases(session_id, &entries)?;
        Ok(entry)
    }

    /// Newest shown first.
    pub fn canvases(&self, session_id: &str) -> Result<Vec<CanvasEntry>, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries = self.read_canvases(session_id)?;
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.shown_at));
        Ok(entries)
    }

    pub fn canvas(&self, session_id: &str, key: &str) -> Option<CanvasEntry> {
        if !is_session_id(session_id) || !is_canvas_key(key) {
            return None;
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_canvases(session_id)
            .ok()?
            .into_iter()
            .find(|entry| entry.key == key)
    }

    pub fn forget_canvas(&self, session_id: &str, key: &str) -> Result<(), String> {
        if !is_session_id(session_id) || !is_canvas_key(key) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let entries: Vec<CanvasEntry> = self
            .read_canvases(session_id)?
            .into_iter()
            .filter(|entry| entry.key != key)
            .collect();
        self.write_canvases(session_id, &entries)
    }

    /// Takes the oldest versions past the limits off the record and returns
    /// their numbers; the newest always stays. Their files are removed by the
    /// caller, only once the index that no longer lists them is written.
    fn prune(&self, record: &mut ArtifactRecord) -> Vec<u32> {
        let total = |versions: &[ArtifactVersion]| versions.iter().map(|v| v.bytes).sum::<u64>();
        let mut dropped = Vec::new();
        while record.versions.len() > 1
            && (record.versions.len() > self.max_versions
                || total(&record.versions) > self.max_artifact_bytes)
        {
            dropped.push(record.versions.remove(0).n);
        }
        dropped
    }

    /// Keeps `html` as the newest version of the artifact for `source_path`,
    /// making the artifact when the path is new to the session.
    pub fn show(
        &self,
        session_id: &str,
        source_path: &str,
        title: Option<&str>,
        html: &[u8],
        now_ms: u64,
    ) -> Result<Shown, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let title = title.and_then(clean_title);
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut records = self.read_index(session_id)?;
        let existing = records
            .iter()
            .position(|record| record.source_path == source_path);
        let is_new_artifact = existing.is_none();
        let index = match existing {
            Some(index) => index,
            None => {
                let title = title.clone().ok_or_else(|| NEEDS_TITLE.to_string())?;
                if records.len() >= MAX_ARTIFACTS {
                    return Err(TOO_MANY.to_string());
                }
                records.push(ArtifactRecord {
                    id: new_artifact_id()?,
                    title,
                    source_path: source_path.to_string(),
                    versions: Vec::new(),
                });
                records.len() - 1
            }
        };
        if let Some(title) = title {
            records[index].title = title;
        }
        let artifact_id = records[index].id.clone();
        let newest = records[index].versions.last().cloned();
        let is_same = newest.as_ref().is_some_and(|version| {
            version.bytes == html.len() as u64
                && fs::read(self.page_path(session_id, &artifact_id, version.n))
                    .is_ok_and(|stored| stored == html)
        });
        // The new page, when one is written, and the versions it pushes out.
        let mut written: Option<PathBuf> = None;
        let mut dropped: Vec<u32> = Vec::new();
        let version = match (&newest, is_same) {
            (Some(version), true) => version.n,
            _ => {
                let n = newest.map_or(1, |version| version.n + 1);
                let page = self.page_path(session_id, &artifact_id, n);
                let folder = page.parent().ok_or_else(|| FAILED.to_string())?;
                fs::create_dir_all(folder).map_err(|_| FAILED.to_string())?;
                write_private(&page, html)?;
                written = Some(page);
                records[index].versions.push(ArtifactVersion {
                    n,
                    at: now_ms,
                    bytes: html.len() as u64,
                });
                dropped = self.prune(&mut records[index]);
                n
            }
        };
        // The index is the record of what exists. Until it is written the old
        // versions stay on disk; if it cannot be written, the page it would
        // have listed is taken back, and nothing that was listed is lost.
        if let Err(error) = self.write_index(session_id, &records) {
            if let Some(page) = written {
                let _ = fs::remove_file(page);
            }
            return Err(error);
        }
        for n in dropped {
            let _ = fs::remove_file(self.page_path(session_id, &artifact_id, n));
        }
        Ok(Shown {
            artifact: records[index].clone(),
            version,
            is_new_artifact,
            is_new_version: !is_same,
        })
    }

    /// The session's artifacts, the most recently changed first. A session with
    /// no index, or one that cannot be read, has none.
    pub fn list(&self, session_id: &str) -> Result<Vec<ArtifactRecord>, String> {
        Ok(self.list_checked(session_id).unwrap_or_default())
    }

    /// The session's artifacts, newest first; an error when its index exists
    /// but cannot be read, which `list` reads as no artifacts.
    pub fn list_checked(&self, session_id: &str) -> Result<Vec<ArtifactRecord>, String> {
        if !is_session_id(session_id) {
            return Ok(Vec::new());
        }
        let mut records = self.read_index(session_id)?;
        records.sort_by_key(|record| std::cmp::Reverse(newest_at(record)));
        Ok(records)
    }

    pub fn rename(
        &self,
        session_id: &str,
        artifact_id: &str,
        title: &str,
    ) -> Result<ArtifactRecord, String> {
        if !is_session_id(session_id) || !is_artifact_id(artifact_id) {
            return Err(NO_SUCH_ARTIFACT.to_string());
        }
        let title = clean_title(title).ok_or_else(|| NEEDS_TITLE.to_string())?;
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut records = self.read_index(session_id)?;
        let record = records
            .iter_mut()
            .find(|record| record.id == artifact_id)
            .ok_or_else(|| NO_SUCH_ARTIFACT.to_string())?;
        record.title = title;
        let renamed = record.clone();
        self.write_index(session_id, &records)?;
        Ok(renamed)
    }

    pub fn delete(&self, session_id: &str, artifact_id: &str) -> Result<(), String> {
        if !is_session_id(session_id) || !is_artifact_id(artifact_id) {
            return Err(NO_SUCH_ARTIFACT.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let records = self.read_index(session_id)?;
        let kept: Vec<ArtifactRecord> = records
            .into_iter()
            .filter(|record| record.id != artifact_id)
            .collect();
        self.write_index(session_id, &kept)?;
        let _ = fs::remove_dir_all(self.session_dir(session_id).join(artifact_id));
        Ok(())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        match fs::remove_dir_all(self.session_dir(session_id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(FAILED.to_string()),
        }
    }

    /// Where a stored page is, only for a version the index lists.
    pub fn version_path(
        &self,
        session_id: &str,
        artifact_id: &str,
        version: u32,
    ) -> Option<PathBuf> {
        if !is_session_id(session_id) || !is_artifact_id(artifact_id) {
            return None;
        }
        let records = self.read_index(session_id).ok()?;
        records
            .iter()
            .find(|record| record.id == artifact_id)?
            .versions
            .iter()
            .any(|listed| listed.n == version)
            .then(|| self.page_path(session_id, artifact_id, version))
    }

    /// Removes the folders of sessions that no longer exist and were last
    /// changed over `min_age` ago; returns how many it removed.
    pub fn sweep_orphans(
        &self,
        known_sessions: &HashSet<String>,
        now: SystemTime,
        min_age: Duration,
    ) -> usize {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return 0;
        };
        entries
            .flatten()
            .filter(|entry| {
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    return false;
                };
                let is_old = entry
                    .metadata()
                    .ok()
                    .filter(|metadata| metadata.is_dir())
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|modified| now.duration_since(modified).ok())
                    .is_some_and(|age| age > min_age);
                is_session_id(name) && !known_sessions.contains(name) && is_old
            })
            .filter(|entry| fs::remove_dir_all(entry.path()).is_ok())
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;
    use std::time::UNIX_EPOCH;

    /// A temp folder removed when the test ends, even on panic.
    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "zorvo-artifacts-{tag}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp folder");
            Self(path)
        }

        fn store(&self) -> ArtifactStore {
            ArtifactStore::new(self.0.clone())
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const SESSION: &str = "session-1794800000000-k3x9a";
    const PATH: &str = "/work/report.html";

    fn numbers(record: &ArtifactRecord) -> Vec<u32> {
        record.versions.iter().map(|version| version.n).collect()
    }

    #[test]
    fn first_show_needs_a_title() {
        let temp = Temp::new("title");
        let store = temp.store();

        assert_eq!(
            store.show(SESSION, PATH, None, b"<p>a</p>", 1).unwrap_err(),
            NEEDS_TITLE
        );
        assert_eq!(
            store
                .show(SESSION, PATH, Some("   "), b"<p>a</p>", 1)
                .unwrap_err(),
            NEEDS_TITLE
        );
        assert!(store.list(SESSION).unwrap().is_empty());
    }

    #[test]
    fn same_path_makes_a_new_version() {
        let temp = Temp::new("versions");
        let store = temp.store();

        let first = store
            .show(SESSION, PATH, Some("Report"), b"one", 10)
            .unwrap();
        let second = store.show(SESSION, PATH, None, b"two", 20).unwrap();

        assert!(first.is_new_artifact && first.is_new_version);
        assert_eq!(first.version, 1);
        assert!(!second.is_new_artifact && second.is_new_version);
        assert_eq!(second.version, 2);
        let listed = store.list(SESSION).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(numbers(&listed[0]), vec![1, 2]);
        assert_eq!(listed[0].title, "Report");
        assert_eq!(listed[0].source_path, PATH);
        assert_eq!(listed[0].versions[1].bytes, 3);
        assert_eq!(listed[0].versions[1].at, 20);
    }

    #[test]
    fn equal_content_makes_no_version() {
        let temp = Temp::new("equal");
        let store = temp.store();
        store
            .show(SESSION, PATH, Some("Report"), b"same", 10)
            .unwrap();

        let again = store
            .show(SESSION, PATH, Some("Renamed"), b"same", 20)
            .unwrap();

        assert!(!again.is_new_version && !again.is_new_artifact);
        assert_eq!(again.version, 1);
        let listed = store.list(SESSION).unwrap();
        assert_eq!(numbers(&listed[0]), vec![1]);
        assert_eq!(listed[0].title, "Renamed");
    }

    #[test]
    fn another_path_is_another_artifact() {
        let temp = Temp::new("paths");
        let store = temp.store();

        store.show(SESSION, PATH, Some("One"), b"a", 10).unwrap();
        store
            .show(SESSION, "/work/other.html", Some("Two"), b"b", 20)
            .unwrap();

        let listed = store.list(SESSION).unwrap();
        assert_eq!(listed.len(), 2);
        // Newest-changed first.
        assert_eq!(listed[0].title, "Two");
        assert_ne!(listed[0].id, listed[1].id);
        assert!(is_artifact_id(&listed[0].id));
    }

    #[test]
    fn a_title_nobody_could_read_is_no_title() {
        let temp = Temp::new("unseen");
        let store = temp.store();

        // Zero-width and filler characters only: the list would show an empty row.
        for unseen in [
            "\u{200B}\u{200B}",
            "\u{2060}\u{FEFF}",
            "\u{3164}",
            " \u{00AD}\u{200D} ",
        ] {
            assert_eq!(
                store
                    .show(SESSION, PATH, Some(unseen), b"<p>a</p>", 1)
                    .unwrap_err(),
                NEEDS_TITLE,
                "title: {unseen:?}"
            );
        }
        assert!(store.list(SESSION).unwrap().is_empty());
    }

    #[test]
    fn a_title_loses_what_reorders_or_breaks_its_line() {
        let temp = Temp::new("reorder");
        let store = temp.store();

        // A right-to-left override would show "lmth.troper" as "report.html"; a line break would split the row.
        let shown = store
            .show(
                SESSION,
                PATH,
                Some("Q3\u{202E} report\nfinal\u{2028}\u{0007}"),
                b"a",
                1,
            )
            .unwrap();

        // A break between words becomes a space, so the words do not run together.
        assert_eq!(shown.artifact.title, "Q3 report final");
    }

    #[test]
    fn a_title_keeps_joined_emoji() {
        let temp = Temp::new("emoji");
        let store = temp.store();
        let family = "Team \u{1F469}\u{200D}\u{1F4BB} \u{2764}\u{FE0F}";

        let shown = store.show(SESSION, PATH, Some(family), b"a", 1).unwrap();

        assert_eq!(shown.artifact.title, family);
    }

    #[test]
    fn a_title_is_trimmed_and_cut_to_60_characters() {
        let temp = Temp::new("cut");
        let store = temp.store();
        let long = format!("  {}  ", "é".repeat(80));

        let shown = store.show(SESSION, PATH, Some(&long), b"a", 10).unwrap();

        assert_eq!(shown.artifact.title.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn keeps_the_newest_20_versions() {
        let temp = Temp::new("twenty");
        let store = temp.store();

        for n in 1..=21u32 {
            let body = format!("version {n}");
            store
                .show(SESSION, PATH, Some("Report"), body.as_bytes(), u64::from(n))
                .unwrap();
        }

        let record = store.list(SESSION).unwrap().remove(0);
        assert_eq!(numbers(&record), (2..=21).collect::<Vec<u32>>());
        assert!(store.version_path(SESSION, &record.id, 1).is_none());
        let newest = store.version_path(SESSION, &record.id, 21).unwrap();
        assert_eq!(fs::read(newest).unwrap(), b"version 21");
        let folder = temp.0.join(SESSION).join(&record.id);
        assert!(!folder.join("1.html").exists());
    }

    #[test]
    fn version_numbers_never_repeat_after_pruning() {
        let temp = Temp::new("repeat");
        let store = temp.store();
        for n in 1..=22u32 {
            let body = format!("version {n}");
            store
                .show(SESSION, PATH, Some("Report"), body.as_bytes(), u64::from(n))
                .unwrap();
        }

        let next = store.show(SESSION, PATH, None, b"again", 99).unwrap();

        assert_eq!(next.version, 23);
    }

    #[test]
    fn drops_old_versions_over_64_mib_but_keeps_the_newest() {
        let temp = Temp::new("bytes");
        let store = temp.store();
        let size = 15 * 1024 * 1024;

        for n in 1..=5u8 {
            store
                .show(SESSION, PATH, Some("Big"), &vec![n; size], u64::from(n))
                .unwrap();
        }

        let record = store.list(SESSION).unwrap().remove(0);
        let total: u64 = record.versions.iter().map(|version| version.bytes).sum();
        assert!(total <= MAX_ARTIFACT_BYTES);
        assert_eq!(numbers(&record), vec![2, 3, 4, 5]);
        assert!(!temp
            .0
            .join(SESSION)
            .join(&record.id)
            .join("1.html")
            .exists());
    }

    #[test]
    fn one_version_over_the_byte_cap_is_still_kept() {
        let temp = Temp::new("lone");
        let store = ArtifactStore::with_limits(temp.0.clone(), MAX_VERSIONS, 4);

        store
            .show(SESSION, PATH, Some("Big"), b"0123456789", 1)
            .unwrap();

        assert_eq!(numbers(&store.list(SESSION).unwrap()[0]), vec![1]);
    }

    #[test]
    fn a_show_whose_index_cannot_be_written_keeps_the_versions_it_had() {
        let temp = Temp::new("failed-index");
        let store = ArtifactStore::with_limits(temp.0.clone(), 1, MAX_ARTIFACT_BYTES);
        let id = store
            .show(SESSION, PATH, Some("Report"), b"one", 1)
            .unwrap()
            .artifact
            .id;
        let session_dir = temp.0.join(SESSION);
        // The session's folder cannot be written, so the page can be stored but the index cannot.
        fs::set_permissions(&session_dir, fs::Permissions::from_mode(0o555)).unwrap();

        let shown = store.show(SESSION, PATH, None, b"two", 2);

        fs::set_permissions(&session_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(shown.is_err());
        // The index still lists version 1, so its file must still be there: with a limit of one
        // version, pruning before the index was written would have deleted it.
        let listed = store.list(SESSION).unwrap();
        assert_eq!(numbers(&listed[0]), vec![1]);
        let first = store.version_path(SESSION, &id, 1).unwrap();
        assert_eq!(fs::read(first).unwrap(), b"one");
        // And the version that was never listed leaves no file behind.
        assert!(!session_dir.join(&id).join("2.html").exists());
    }

    #[test]
    fn refuses_the_51st_artifact() {
        let temp = Temp::new("fifty");
        let store = temp.store();
        for n in 0..MAX_ARTIFACTS {
            let path = format!("/work/{n}.html");
            store
                .show(SESSION, &path, Some("Page"), b"a", n as u64)
                .unwrap();
        }

        let refused = store.show(SESSION, "/work/extra.html", Some("Page"), b"a", 99);
        let updated = store.show(SESSION, "/work/0.html", None, b"b", 100);

        assert_eq!(refused.unwrap_err(), TOO_MANY);
        assert_eq!(updated.unwrap().version, 2);
    }

    #[test]
    fn two_shows_at_once_for_one_path_make_one_artifact() {
        let temp = Temp::new("race");
        let store = Arc::new(temp.store());

        let handles: Vec<_> = [b"left".to_vec(), b"right".to_vec()]
            .into_iter()
            .map(|body| {
                let store = Arc::clone(&store);
                std::thread::spawn(move || store.show(SESSION, PATH, Some("Race"), &body, 1))
            })
            .collect();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let listed = store.list(SESSION).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(numbers(&listed[0]), vec![1, 2]);
    }

    #[test]
    fn version_path_is_only_for_listed_versions() {
        let temp = Temp::new("lookup");
        let store = temp.store();
        let id = store
            .show(SESSION, PATH, Some("Report"), b"a", 1)
            .unwrap()
            .artifact
            .id;

        assert!(store.version_path(SESSION, &id, 1).is_some());
        assert!(store.version_path("../x", &id, 1).is_none());
        assert!(store.version_path(SESSION, "../x", 1).is_none());
        assert!(store
            .version_path(SESSION, "a-0000000000000000", 1)
            .is_none());
        assert!(store.version_path(SESSION, &id, 0).is_none());
        assert!(store.version_path(SESSION, &id, 2).is_none());
    }

    #[test]
    fn ids_have_one_shape() {
        assert!(is_session_id("session-1794800000000-k3x9a"));
        assert!(!is_session_id(""));
        assert!(!is_session_id("a/b"));
        assert!(!is_session_id(".."));
        assert!(!is_session_id(&"a".repeat(81)));
        assert!(is_artifact_id("a-0123456789abcdef"));
        assert!(!is_artifact_id("a-0123456789ABCDEF"));
        assert!(!is_artifact_id("b-0123456789abcdef"));
        assert!(!is_artifact_id("a-0123"));
    }

    #[test]
    fn show_refuses_a_session_id_of_another_shape() {
        let temp = Temp::new("badid");
        let store = temp.store();

        assert!(store.show("../x", PATH, Some("T"), b"a", 1).is_err());
        assert!(fs::read_dir(&temp.0).unwrap().next().is_none());
    }

    #[test]
    fn rename_changes_the_title_only() {
        let temp = Temp::new("rename");
        let store = temp.store();
        let id = store
            .show(SESSION, PATH, Some("Old"), b"a", 1)
            .unwrap()
            .artifact
            .id;

        let renamed = store.rename(SESSION, &id, "  New name ").unwrap();

        assert_eq!(renamed.title, "New name");
        assert_eq!(numbers(&renamed), vec![1]);
        assert!(store.rename(SESSION, &id, "  ").is_err());
        assert!(store.rename(SESSION, "a-0000000000000000", "X").is_err());
    }

    #[test]
    fn delete_and_delete_session_remove_the_files() {
        let temp = Temp::new("delete");
        let store = temp.store();
        let one = store
            .show(SESSION, PATH, Some("One"), b"a", 1)
            .unwrap()
            .artifact
            .id;
        store
            .show(SESSION, "/work/two.html", Some("Two"), b"b", 2)
            .unwrap();

        store.delete(SESSION, &one).unwrap();

        assert_eq!(store.list(SESSION).unwrap().len(), 1);
        assert!(!temp.0.join(SESSION).join(&one).exists());
        store.delete_session(SESSION).unwrap();
        assert!(!temp.0.join(SESSION).exists());
        assert!(store.list(SESSION).unwrap().is_empty());
        // Deleting what is not there is not an error.
        store.delete_session(SESSION).unwrap();
    }

    #[test]
    fn sweep_removes_only_unknown_sessions_older_than_the_age() {
        let temp = Temp::new("sweep");
        let store = temp.store();
        store.show("known-1", PATH, Some("A"), b"a", 1).unwrap();
        store.show("gone-1", PATH, Some("B"), b"b", 1).unwrap();
        let known: HashSet<String> = ["known-1".to_string()].into_iter().collect();
        let day = Duration::from_secs(24 * 60 * 60);

        let young = store.sweep_orphans(&known, SystemTime::now(), day);
        let old = store.sweep_orphans(&known, SystemTime::now() + day + day, day);

        assert_eq!(young, 0);
        assert_eq!(old, 1);
        assert!(temp.0.join("known-1").exists());
        assert!(!temp.0.join("gone-1").exists());
    }

    #[test]
    fn pages_are_private_to_the_user() {
        let temp = Temp::new("mode");
        let store = temp.store();
        let id = store
            .show(SESSION, PATH, Some("A"), b"a", 1)
            .unwrap()
            .artifact
            .id;

        let page = store.version_path(SESSION, &id, 1).unwrap();

        assert_eq!(
            fs::metadata(page).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn an_index_that_does_not_parse_stops_show_and_reads_as_empty() {
        let temp = Temp::new("broken");
        let store = temp.store();
        fs::create_dir_all(temp.0.join(SESSION)).unwrap();
        fs::write(temp.0.join(SESSION).join("index.json"), b"{not json").unwrap();

        assert!(store.list(SESSION).unwrap().is_empty());
        assert!(store.show(SESSION, PATH, Some("A"), b"a", 1).is_err());
    }

    fn folder(name: &str) -> super::super::canvas::CanvasFolder {
        super::super::canvas::CanvasFolder {
            root: PathBuf::from(format!("/work/{name}")),
            relative: name.to_string(),
        }
    }

    #[test]
    fn the_same_folder_keeps_its_key() {
        let temp = Temp::new("canvas-key");
        let store = temp.store();
        let first = store
            .remember_canvas(SESSION, &folder("a"), "One", 1, 10)
            .unwrap();
        let second = store
            .remember_canvas(SESSION, &folder("a"), "Two", 12, 20)
            .unwrap();
        assert!(is_canvas_key(&first.key));
        assert_eq!(first.key, second.key);
        assert_eq!(second.title, "Two");
        assert_eq!(second.shown_at, 20);
        assert_eq!(second.artboards, 12);
        assert_eq!(store.canvases(SESSION).unwrap().len(), 1);
        assert_eq!(store.canvas(SESSION, &first.key), Some(second));
    }

    #[test]
    fn an_index_written_before_counts_reads_as_no_artboards() {
        let entries: Vec<CanvasEntry> = serde_json::from_str(
            r#"[{"key":"c-0123456789abcdef","folder":"/w/d","relative":"d","title":"T","shownAt":1}]"#,
        )
        .unwrap();
        assert_eq!(entries[0].artboards, 0);
    }

    #[test]
    fn lists_newest_first_and_forgets() {
        let temp = Temp::new("canvas-list");
        let store = temp.store();
        let old = store
            .remember_canvas(SESSION, &folder("a"), "A", 1, 10)
            .unwrap();
        let new = store
            .remember_canvas(SESSION, &folder("b"), "B", 1, 20)
            .unwrap();
        let keys: Vec<_> = store
            .canvases(SESSION)
            .unwrap()
            .into_iter()
            .map(|c| c.key)
            .collect();
        assert_eq!(keys, vec![new.key.clone(), old.key.clone()]);
        store.forget_canvas(SESSION, &new.key).unwrap();
        let keys: Vec<_> = store
            .canvases(SESSION)
            .unwrap()
            .into_iter()
            .map(|c| c.key)
            .collect();
        assert_eq!(keys, vec![old.key]);
        assert_eq!(store.canvas(SESSION, &new.key), None);
    }

    #[test]
    fn refuses_a_51st_canvas() {
        let temp = Temp::new("canvas-cap");
        let store = temp.store();
        for n in 0..MAX_CANVASES {
            store
                .remember_canvas(SESSION, &folder(&n.to_string()), "T", 1, n as u64)
                .unwrap();
        }
        assert_eq!(
            store.remember_canvas(SESSION, &folder("extra"), "T", 1, 99),
            Err(TOO_MANY_CANVASES.to_string())
        );
        // A folder already remembered still updates at the limit.
        assert!(store
            .remember_canvas(SESSION, &folder("0"), "New", 1, 100)
            .is_ok());
    }

    #[test]
    fn delete_session_removes_canvases() {
        let temp = Temp::new("canvas-delete");
        let store = temp.store();
        store
            .remember_canvas(SESSION, &folder("a"), "A", 1, 1)
            .unwrap();
        store.delete_session(SESSION).unwrap();
        assert_eq!(store.canvases(SESSION).unwrap(), vec![]);
    }

    #[test]
    fn an_unreadable_canvases_file_is_an_error_not_empty() {
        let temp = Temp::new("canvas-bad");
        let store = temp.store();
        store
            .remember_canvas(SESSION, &folder("a"), "A", 1, 1)
            .unwrap();
        fs::write(temp.0.join(SESSION).join("canvases.json"), "{").unwrap();
        assert!(store.canvases(SESSION).is_err());
        assert!(store
            .remember_canvas(SESSION, &folder("b"), "B", 1, 2)
            .is_err());
    }

    #[test]
    fn canvas_keys_have_one_shape() {
        assert!(is_canvas_key("c-0123456789abcdef"));
        assert!(!is_canvas_key("a-0123456789abcdef"));
        assert!(!is_canvas_key("c-0123456789ABCDEF"));
        assert!(!is_canvas_key("c-0123"));
        let temp = Temp::new("canvas-shape");
        let store = temp.store();
        assert_eq!(store.canvas("bad/session", "c-0123456789abcdef"), None);
        assert!(store.canvases("bad/session").is_err());
        assert!(store.forget_canvas(SESSION, "nope").is_err());
    }
}
