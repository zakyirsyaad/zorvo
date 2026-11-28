//! The motions and videos a session showed, found again by their path: `motions.json` and
//! `videos.json` beside the session's `canvases.json`. Zorvo keeps no copy of either; the files
//! stay in the project, and forgetting an entry leaves them alone.

use std::fs;
use std::io::Read;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::store::{is_session_id, ArtifactStore, FAILED};
use crate::store::atomic_write;

const MOTIONS_FILE: &str = "motions.json";
const VIDEOS_FILE: &str = "videos.json";
const MOTION_KEY_PREFIX: &str = "m-";
const VIDEO_KEY_PREFIX: &str = "v-";
const KEY_HEX_CHARS: usize = 16;
pub const MAX_MOTIONS: usize = 50;
pub const MAX_VIDEOS: usize = 100;
pub const TOO_MANY_MOTIONS: &str =
    "This session already has 50 motions. The user can remove one in Zorvo.";
pub const TOO_MANY_VIDEOS: &str =
    "This session already has 100 videos. The user can remove one in Zorvo.";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionEntry {
    pub key: String,
    pub folder: String,
    pub relative: String,
    pub title: String,
    pub shown_at: u64,
    pub duration: f64,
    pub formats: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoEntry {
    pub key: String,
    pub path: String,
    pub relative: String,
    pub title: String,
    pub shown_at: u64,
}

fn is_key(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|hex| {
        hex.len() == KEY_HEX_CHARS
            && hex
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    })
}

pub fn is_motion_key(id: &str) -> bool {
    is_key(id, MOTION_KEY_PREFIX)
}

pub fn is_video_key(id: &str) -> bool {
    is_key(id, VIDEO_KEY_PREFIX)
}

fn new_key(prefix: &str) -> Result<String, String> {
    let mut bytes = [0u8; KEY_HEX_CHARS / 2];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| FAILED.to_string())?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{prefix}{hex}"))
}

/// What a motion entry is remembered with when it is shown.
pub struct ShownMotion<'a> {
    pub folder: &'a Path,
    pub relative: &'a str,
    pub title: &'a str,
    pub duration: f64,
    pub formats: Vec<String>,
}

impl ArtifactStore {
    pub(super) fn read_list<T: DeserializeOwned>(
        &self,
        session_id: &str,
        file: &str,
    ) -> Result<Vec<T>, String> {
        match fs::read(self.session_dir(session_id).join(file)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| FAILED.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(FAILED.to_string()),
        }
    }

    pub(super) fn write_list<T: Serialize>(
        &self,
        session_id: &str,
        file: &str,
        list: &[T],
    ) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        fs::create_dir_all(&dir).map_err(|_| FAILED.to_string())?;
        let bytes = serde_json::to_vec_pretty(list).map_err(|_| FAILED.to_string())?;
        let tmp = dir.join(format!("{file}.{}.tmp", std::process::id()));
        atomic_write(&dir.join(file), &tmp, &bytes).map_err(|_| FAILED.to_string())
    }

    /// Remembers a shown motion: the same canonical folder keeps its key.
    pub fn remember_motion(
        &self,
        session_id: &str,
        shown: ShownMotion<'_>,
        now: u64,
    ) -> Result<MotionEntry, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let folder = shown.folder.to_string_lossy().into_owned();
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<MotionEntry> = self.read_list(session_id, MOTIONS_FILE)?;
        let entry = if let Some(existing) = entries.iter_mut().find(|e| e.folder == folder) {
            existing.relative = shown.relative.to_string();
            existing.title = shown.title.to_string();
            existing.shown_at = now;
            existing.duration = shown.duration;
            existing.formats = shown.formats;
            existing.clone()
        } else {
            if entries.len() >= MAX_MOTIONS {
                return Err(TOO_MANY_MOTIONS.to_string());
            }
            let entry = MotionEntry {
                key: new_key(MOTION_KEY_PREFIX)?,
                folder,
                relative: shown.relative.to_string(),
                title: shown.title.to_string(),
                shown_at: now,
                duration: shown.duration,
                formats: shown.formats,
            };
            entries.push(entry.clone());
            entry
        };
        self.write_list(session_id, MOTIONS_FILE, &entries)?;
        Ok(entry)
    }

    /// Remembers a shown video: the same canonical file keeps its key.
    pub fn remember_video(
        &self,
        session_id: &str,
        path: &Path,
        relative: &str,
        title: &str,
        now: u64,
    ) -> Result<VideoEntry, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let path = path.to_string_lossy().into_owned();
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<VideoEntry> = self.read_list(session_id, VIDEOS_FILE)?;
        let entry = if let Some(existing) = entries.iter_mut().find(|e| e.path == path) {
            existing.relative = relative.to_string();
            existing.title = title.to_string();
            existing.shown_at = now;
            existing.clone()
        } else {
            if entries.len() >= MAX_VIDEOS {
                return Err(TOO_MANY_VIDEOS.to_string());
            }
            let entry = VideoEntry {
                key: new_key(VIDEO_KEY_PREFIX)?,
                path,
                relative: relative.to_string(),
                title: title.to_string(),
                shown_at: now,
            };
            entries.push(entry.clone());
            entry
        };
        self.write_list(session_id, VIDEOS_FILE, &entries)?;
        Ok(entry)
    }

    /// Newest shown first.
    pub fn motions(&self, session_id: &str) -> Result<Vec<MotionEntry>, String> {
        self.sorted(session_id, MOTIONS_FILE, |entry: &MotionEntry| {
            entry.shown_at
        })
    }

    /// Newest shown first.
    pub fn videos(&self, session_id: &str) -> Result<Vec<VideoEntry>, String> {
        self.sorted(session_id, VIDEOS_FILE, |entry: &VideoEntry| entry.shown_at)
    }

    fn sorted<T: DeserializeOwned>(
        &self,
        session_id: &str,
        file: &str,
        shown_at: impl Fn(&T) -> u64,
    ) -> Result<Vec<T>, String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<T> = self.read_list(session_id, file)?;
        entries.sort_by_key(|entry| std::cmp::Reverse(shown_at(entry)));
        Ok(entries)
    }

    pub fn motion(&self, session_id: &str, key: &str) -> Option<MotionEntry> {
        if !is_motion_key(key) {
            return None;
        }
        self.motions(session_id)
            .ok()?
            .into_iter()
            .find(|entry| entry.key == key)
    }

    pub fn video(&self, session_id: &str, key: &str) -> Option<VideoEntry> {
        if !is_video_key(key) {
            return None;
        }
        self.videos(session_id)
            .ok()?
            .into_iter()
            .find(|entry| entry.key == key)
    }

    /// Forgets a motion or a video by its key; the files stay.
    pub fn forget_media(&self, session_id: &str, key: &str) -> Result<(), String> {
        if !is_session_id(session_id) {
            return Err(FAILED.to_string());
        }
        let lock = self.lock_for(session_id);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        if is_motion_key(key) {
            let kept: Vec<MotionEntry> = self
                .read_list::<MotionEntry>(session_id, MOTIONS_FILE)?
                .into_iter()
                .filter(|entry| entry.key != key)
                .collect();
            return self.write_list(session_id, MOTIONS_FILE, &kept);
        }
        if is_video_key(key) {
            let kept: Vec<VideoEntry> = self
                .read_list::<VideoEntry>(session_id, VIDEOS_FILE)?
                .into_iter()
                .filter(|entry| entry.key != key)
                .collect();
            return self.write_list(session_id, VIDEOS_FILE, &kept);
        }
        Err(FAILED.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    fn shown<'a>(folder: &'a Path, title: &'a str) -> ShownMotion<'a> {
        ShownMotion {
            folder,
            relative: "promo",
            title,
            duration: 15.0,
            formats: vec!["wide".to_string()],
        }
    }

    #[test]
    fn the_same_folder_keeps_its_key() {
        let data = Temp::new("motion-store");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        let folder = data.0.join("promo");
        let first = store
            .remember_motion("s1", shown(&folder, "One"), 1)
            .expect("first");
        let again = store
            .remember_motion("s1", shown(&folder, "Two"), 2)
            .expect("again");
        assert_eq!(first.key, again.key);
        assert!(is_motion_key(&first.key));
        assert_eq!(
            store.motion("s1", &first.key).map(|e| e.title),
            Some("Two".to_string())
        );
        assert_eq!(store.motions("s1").expect("list").len(), 1);
    }

    #[test]
    fn videos_are_kept_newest_first_and_forgotten_by_key() {
        let data = Temp::new("video-store");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        let a = store
            .remember_video("s1", &data.0.join("a.mp4"), "a.mp4", "A", 1)
            .expect("a");
        let b = store
            .remember_video("s1", &data.0.join("b.mp4"), "b.mp4", "B", 2)
            .expect("b");
        let listed: Vec<String> = store
            .videos("s1")
            .expect("list")
            .into_iter()
            .map(|e| e.key)
            .collect();
        assert_eq!(listed, vec![b.key.clone(), a.key.clone()]);
        store.forget_media("s1", &a.key).expect("forget");
        assert!(store.video("s1", &a.key).is_none());
        assert!(store.video("s1", &b.key).is_some());
        assert!(store.forget_media("s1", "x-1").is_err());
    }

    #[test]
    fn refuses_a_bad_session_id() {
        let data = Temp::new("motion-store-bad");
        let store = ArtifactStore::new(data.0.join("artifacts"));
        assert!(store
            .remember_motion("../x", shown(&data.0, "T"), 1)
            .is_err());
        assert!(store.motions("../x").is_err());
    }
}
