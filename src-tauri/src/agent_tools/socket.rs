//! The private Unix socket the stdio bridge connects to, and the per-session
//! tokens that say which session a connection speaks for.
//!
//! The socket sits in a directory only this user can enter (0700), is itself
//! 0600, and a connection must send a known token as its first line within
//! two seconds. Tokens are never logged or written to disk.

use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Read};
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};

/// macOS allows 104 bytes in a socket path, the terminating NUL included.
const MAX_SOCKET_PATH_BYTES: usize = 100;
const TOKEN_BYTES: usize = 32;
const FIRST_LINE_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_FIRST_LINE_BYTES: usize = 4096;

extern "C" {
    fn getuid() -> u32;
}

fn current_uid() -> u32 {
    // SAFETY: getuid takes no arguments, cannot fail and touches no memory.
    unsafe { getuid() }
}

/// Which token speaks for which app session.
#[derive(Default)]
pub struct Tokens {
    by_session: Mutex<HashMap<String, String>>,
}

impl Tokens {
    pub fn new() -> Self {
        Self::default()
    }

    /// A fresh token for a session; a second call replaces the first.
    pub fn issue(&self, app_session_id: &str) -> String {
        let token = random_token();
        self.by_session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(app_session_id.to_string(), token.clone());
        token
    }

    pub fn has_session(&self, app_session_id: &str) -> bool {
        self.by_session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(app_session_id)
    }

    pub fn forget(&self, app_session_id: &str) {
        self.by_session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(app_session_id);
    }

    /// The session a token belongs to. Every stored token is compared, and
    /// each comparison looks at every byte, so timing says nothing.
    pub fn session_of(&self, token: &str) -> Option<String> {
        let map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        let mut found = None;
        for (session, stored) in map.iter() {
            if constant_time_eq(stored.as_bytes(), token.as_bytes()) {
                found = Some(session.clone());
            }
        }
        found
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn random_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    // /dev/urandom cannot run dry on macOS; if it cannot be read at all there
    // is no safe token to make, so stop rather than issue a guessable one.
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .expect("/dev/urandom must be readable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `<data_dir>/agent-tools/s.sock`, or a short private path under `/tmp`
/// when that would not fit in a socket address.
pub fn socket_path(data_dir: &Path) -> PathBuf {
    let preferred = data_dir.join("agent-tools").join("s.sock");
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH_BYTES {
        return preferred;
    }
    let digest = Sha256::digest(data_dir.as_os_str().as_encoded_bytes());
    let short: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
    PathBuf::from(format!("/tmp/zorvo-{}-{short}", current_uid())).join("s.sock")
}

/// The bound socket. Dropping it removes the socket file.
pub struct Listener {
    inner: UnixListener,
    path: PathBuf,
}

impl Listener {
    pub fn bind(path: &Path) -> Result<Listener, String> {
        let dir = path
            .parent()
            .ok_or_else(|| "The tools socket has no folder.".to_string())?;
        prepare_dir(dir)?;
        if let Ok(meta) = fs::symlink_metadata(path) {
            if !meta.file_type().is_socket() {
                return Err("Something that is not a socket is in the way.".to_string());
            }
            if UnixStream::connect(path).is_ok() {
                return Err("Another Zorvo is already using this tools socket.".to_string());
            }
            fs::remove_file(path).map_err(|e| format!("Could not replace a stale socket: {e}"))?;
        }
        let inner = UnixListener::bind(path)
            .map_err(|e| format!("Could not open the tools socket: {e}"))?;
        // The directory is 0700 already, so nobody else could connect in the
        // moment before this.
        if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
            let _ = fs::remove_file(path);
            return Err(format!("Could not make the tools socket private: {e}"));
        }
        Ok(Listener {
            inner,
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Accepts connections until the socket fails. Each connection gets a
    /// thread that reads the token line and, when it names a live session,
    /// hands the stream on; anything else is closed without a word.
    pub fn accept_loop(
        self,
        tokens: Arc<Tokens>,
        on_connection: impl Fn(String, UnixStream) + Send + Sync + 'static,
    ) {
        let on_connection = Arc::new(on_connection);
        loop {
            let stream = match self.inner.accept() {
                Ok((stream, _)) => stream,
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::Interrupted | ErrorKind::ConnectionAborted
                    ) =>
                {
                    continue
                }
                Err(_) => break,
            };
            let tokens = Arc::clone(&tokens);
            let on_connection = Arc::clone(&on_connection);
            thread::spawn(move || {
                if let Some((session, stream)) = authenticate(stream, &tokens) {
                    on_connection(session, stream);
                }
            });
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn prepare_dir(dir: &Path) -> Result<(), String> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|e| format!("Could not make the tools folder: {e}"))?;
    let meta =
        fs::symlink_metadata(dir).map_err(|e| format!("Could not read the tools folder: {e}"))?;
    if !meta.is_dir() || meta.uid() != current_uid() {
        return Err("The tools folder is not yours.".to_string());
    }
    if meta.mode() & 0o077 != 0 {
        return Err("The tools folder is open to other users.".to_string());
    }
    Ok(())
}

/// Reads the first line, at most 2 seconds and 4096 bytes, one byte at a time
/// so nothing past the newline is consumed.
fn authenticate(mut stream: UnixStream, tokens: &Tokens) -> Option<(String, UnixStream)> {
    let deadline = Instant::now() + FIRST_LINE_TIMEOUT;
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let left = deadline.checked_duration_since(Instant::now())?;
        stream
            .set_read_timeout(Some(left.max(Duration::from_millis(1))))
            .ok()?;
        match stream.read(&mut byte) {
            Ok(1) => {}
            _ => return None,
        }
        if byte[0] == b'\n' {
            break;
        }
        if line.len() >= MAX_FIRST_LINE_BYTES {
            return None;
        }
        line.push(byte[0]);
    }
    let value: Value = serde_json::from_slice(&line).ok()?;
    let session = tokens.session_of(value.get("token")?.as_str()?)?;
    stream.set_read_timeout(None).ok()?;
    Some((session, stream))
}
