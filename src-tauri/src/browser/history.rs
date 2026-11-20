//! A small local-device visit list. This is separate from cookies and each
//! tab's back/forward list; clearing suggestions does not reload open pages.
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const MAX_VISITS: usize = 30;
const MAX_BYTES: u64 = 512 * 1024;
static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub url: String,
    pub title: String,
    pub visited_at: u64,
}

#[derive(Default)]
struct Saved {
    loaded: bool,
    visits: Vec<Visit>,
}

pub struct BrowserHistory {
    path: PathBuf,
    saved: Mutex<Saved>,
    generation: AtomicU64,
}

impl BrowserHistory {
    pub fn new(root: &Path) -> Self {
        Self {
            path: root.join("browser-visits.json"),
            saved: Mutex::new(Saved::default()),
            generation: AtomicU64::new(0),
        }
    }

    pub fn list(&self) -> Result<Vec<Visit>, String> {
        let mut saved = self
            .saved
            .lock()
            .map_err(|_| "Browser history is unavailable.")?;
        self.load(&mut saved)?;
        Ok(saved.visits.clone())
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut saved = self
            .saved
            .lock()
            .map_err(|_| "Browser history is unavailable.")?;
        write_private(&self.path, &[])?;
        self.generation.fetch_add(1, Ordering::Release);
        saved.loaded = true;
        saved.visits.clear();
        Ok(())
    }

    fn generation(&self) -> u64 {
        // Native page-load callbacks must not wait for a worker's disk flush.
        self.generation.load(Ordering::Acquire)
    }

    fn record(&self, visit: Visit, generation: u64) -> Result<bool, String> {
        let mut saved = self
            .saved
            .lock()
            .map_err(|_| "Browser history is unavailable.")?;
        // An earlier page-load callback queued before Clear must not bring the
        // erased list back when its blocking worker eventually gets scheduled.
        if self.generation() != generation {
            return Ok(false);
        }
        self.load(&mut saved)?;
        let mut next = saved.visits.clone();
        if next
            .iter()
            .any(|row| row.url == visit.url && row.visited_at > visit.visited_at)
        {
            return Ok(false);
        }
        next.retain(|row| row.url != visit.url);
        next.insert(0, visit);
        next.sort_by_key(|row| std::cmp::Reverse(row.visited_at));
        next.truncate(MAX_VISITS);
        write_private(&self.path, &next)?;
        saved.visits = next;
        Ok(true)
    }

    fn load(&self, saved: &mut Saved) -> Result<(), String> {
        if saved.loaded {
            return Ok(());
        }
        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                saved.loaded = true;
                return Ok(());
            }
            Err(_) => return Err("Browser history could not be read.".into()),
        };
        let mut bytes = vec![];
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Browser history could not be read.")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Browser history is too large. Clear it to start again.".into());
        }
        let visits: Vec<Visit> = serde_json::from_slice(&bytes)
            .map_err(|_| "Browser history could not be read. Clear it to start again.")?;
        let mut clean = vec![];
        for visit in visits {
            if let Some(visit) = clean_visit(&visit.url, &visit.title, visit.visited_at) {
                if !clean.iter().any(|row: &Visit| row.url == visit.url) {
                    clean.push(visit);
                }
            }
        }
        clean.sort_by_key(|row| std::cmp::Reverse(row.visited_at));
        clean.truncate(MAX_VISITS);
        saved.visits = clean;
        saved.loaded = true;
        Ok(())
    }
}

fn write_private(path: &Path, visits: &[Visit]) -> Result<(), String> {
    let root = path
        .parent()
        .ok_or("Browser history folder is unavailable.")?;
    fs::create_dir_all(root).map_err(|_| "Browser history folder could not be created.")?;
    let temporary = root.join(format!(
        ".browser-visits-{}-{}.tmp",
        std::process::id(),
        NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Browser history could not be saved.")?;
        let bytes =
            serde_json::to_vec(visits).map_err(|_| "Browser history could not be saved.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Browser history could not be saved.")?;
        fs::rename(&temporary, path).map_err(|_| "Browser history could not be saved.")
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result.map_err(String::from)
}

fn clean_visit(raw: &str, title: &str, visited_at: u64) -> Option<Visit> {
    let url = super::navigation_url(raw).ok()?;
    let mut url = url::Url::parse(&url).ok()?;
    // Do not persist known credential-bearing URLs. Fragments can contain OAuth
    // tokens and are unnecessary for address suggestions, so omit them entirely.
    if url.query_pairs().any(|(key, _)| {
        let key = key.to_ascii_lowercase().replace(['-', '_'], "");
        key.starts_with("xamz")
            || key.starts_with("xgoog")
            || matches!(
                key.as_str(),
                "token"
                    | "accesstoken"
                    | "refreshtoken"
                    | "idtoken"
                    | "apikey"
                    | "key"
                    | "password"
                    | "secret"
                    | "authorization"
                    | "signature"
                    | "sig"
                    | "code"
                    | "awsaccesskeyid"
                    | "googleaccessid"
            )
    }) {
        return None;
    }
    url.set_fragment(None);
    let title: String = title
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .take(160)
        .collect();
    Some(Visit {
        url: url.into(),
        title,
        visited_at,
    })
}

/// Capture only metadata from an actual completed native load. Disk writes run
/// away from the UI thread and cannot be supplied by an untrusted page bridge.
pub(super) fn record(app: &AppHandle, url: String, title: String) {
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0);
    let Some(visit) = clean_visit(&url, &title, at) else {
        return;
    };
    let Some(history) = app
        .try_state::<Arc<BrowserHistory>>()
        .map(|history| Arc::clone(&history))
    else {
        return;
    };
    let generation = history.generation();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || match history.record(visit, generation) {
        Ok(true) => {
            let _ = app.emit("browser-history-changed", ());
        }
        Ok(false) => {}
        Err(error) => eprintln!("{error}"),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let id = NEXT_WRITE.fetch_add(1, Ordering::Relaxed);
            Self(
                std::env::temp_dir()
                    .join(format!("zorvo-browser-visits-{}-{id}", std::process::id())),
            )
        }
        fn store(&self) -> BrowserHistory {
            BrowserHistory::new(&self.0)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn suggestions_are_deduplicated_bounded_and_restored_without_touching_old_history() {
        let root = Temp::new();
        fs::create_dir_all(&root.0).unwrap();
        fs::write(root.0.join("browser-history.json"), "old history").unwrap();
        let store = root.store();
        for at in 0..35 {
            store
                .record(
                    clean_visit(&format!("https://example.com/{at}"), "Example", at).unwrap(),
                    0,
                )
                .unwrap();
        }
        store
            .record(
                clean_visit("https://example.com/34", "Latest", 40).unwrap(),
                0,
            )
            .unwrap();
        let visits = root.store().list().unwrap();
        assert_eq!(visits.len(), 30);
        assert_eq!(visits[0].title, "Latest");
        assert_eq!(visits[0].visited_at, 40);
        assert_eq!(
            fs::read_to_string(root.0.join("browser-history.json")).unwrap(),
            "old history"
        );
    }

    #[test]
    fn clear_is_persisted_and_drops_previously_queued_loads() {
        let root = Temp::new();
        let store = root.store();
        let visit = clean_visit("https://example.com/", "Example", 1).unwrap();
        store.record(visit.clone(), 0).unwrap();
        store.clear().unwrap();
        assert!(!store.record(visit, 0).unwrap());
        assert!(store.list().unwrap().is_empty());
        assert!(root.store().list().unwrap().is_empty());
        assert!(store
            .record(clean_visit("https://example.com/new", "New", 2).unwrap(), 1)
            .unwrap());
    }

    #[test]
    fn native_generation_read_does_not_wait_for_a_disk_worker_lock() {
        let root = Temp::new();
        let store = Arc::new(root.store());
        let held_by_worker = store.saved.lock().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let reader = Arc::clone(&store);
        let thread = std::thread::spawn(move || {
            send.send(reader.generation()).unwrap();
        });
        let observed = receive.recv_timeout(std::time::Duration::from_millis(250));
        // Release before joining, even if a regression makes the reader block.
        drop(held_by_worker);
        thread.join().unwrap();
        assert_eq!(observed.unwrap(), 0);
    }

    #[test]
    fn credentials_and_unsafe_urls_never_enter_suggestions() {
        for url in [
            "https://user:password@example.com/",
            "file:///etc/passwd",
            "https://example.com/?access_token=secret",
            "https://example.com/?api-key=secret",
            "https://example.com/?code=oauth",
            "https://example.com/file?X-Amz-Signature=synthetic-signature",
            "https://example.com/file?X-Amz-Security-Token=synthetic-token",
            "https://example.com/file?x_amz_credential=synthetic-credential",
            "https://example.com/file?X-Goog-Signature=synthetic-signature",
            "https://example.com/file?x-goog-credential=synthetic-credential",
            "https://example.com/file?AWSAccessKeyId=synthetic-key-id",
            "https://example.com/file?GoogleAccessId=synthetic-account",
        ] {
            assert!(clean_visit(url, "title", 1).is_none(), "{url}");
        }
        let visit = clean_visit(
            "https://example.com/?q=normal#access_token=secret",
            "title\u{202e}\n",
            1,
        )
        .unwrap();
        assert_eq!(visit.url, "https://example.com/?q=normal");
        assert_eq!(visit.title, "title");
    }

    #[cfg(unix)]
    #[test]
    fn history_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let root = Temp::new();
        let store = root.store();
        store.clear().unwrap();
        assert_eq!(
            fs::metadata(store.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
