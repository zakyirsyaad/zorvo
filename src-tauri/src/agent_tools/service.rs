//! `AgentTools`: the running tool server. It owns the socket, the tokens and
//! the calls that wait for the webview's answer.
//!
//! One reader thread serves each connection. Every write to a connection goes
//! through that connection's mutex, so an answer and a timeout never
//! interleave bytes. A call leaves the pending table exactly once: by
//! `respond` (nothing else is said), or by a timeout, the agent's
//! `notifications/cancelled`, `forget` or the connection closing, each of
//! which reports it through the `ended` callback.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::protocol::{handle_line, tool_result, Step, MAX_LINE_BYTES};
use super::socket::{socket_path, Listener, Tokens};

static NEXT_CALL: AtomicU64 = AtomicU64::new(1);
static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);

const TIMEOUT_TEXT: &str = "Zorvo did not answer in time.";

/// A valid tool call the webview has to answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub call_id: String,
    pub session_id: String,
    pub tool: String,
    pub args: Value,
}

type Emit = Arc<dyn Fn(ToolCall) + Send + Sync>;
type Ended = Arc<dyn Fn(String) + Send + Sync>;

struct Connection {
    id: u64,
    session: String,
    writer: Mutex<UnixStream>,
}

impl Connection {
    fn send(&self, line: &Value) {
        let mut text = line.to_string();
        text.push('\n');
        let mut writer = lock(&self.writer);
        let _ = writer.write_all(text.as_bytes());
        let _ = writer.flush();
    }

    fn close(&self) {
        let _ = lock(&self.writer).shutdown(Shutdown::Both);
    }
}

struct Pending {
    connection: Arc<Connection>,
    /// The JSON-RPC id the agent used, to answer it and to match a cancel.
    rpc_id: Value,
    /// Dropped with the entry, which wakes the timer thread so it exits.
    _timer_stop: mpsc::Sender<()>,
}

pub struct AgentTools {
    tokens: Arc<Tokens>,
    socket: PathBuf,
    bridge: PathBuf,
    timeout: Duration,
    pending: Mutex<HashMap<String, Pending>>,
    connections: Mutex<HashMap<u64, Arc<Connection>>>,
    emit: Emit,
    ended: Ended,
    /// False for `disabled()`: no socket, and `servers_for` offers nothing.
    enabled: bool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl AgentTools {
    /// How long a call may wait for the webview. Qwen Code and Codex give up
    /// at 5 minutes, so Zorvo answers first.
    pub const CALL_TIMEOUT: Duration = Duration::from_secs(240);

    /// Binds the socket and starts accepting. `bridge` is the program an
    /// agent runs (the app's own executable in production); `emit` receives
    /// every valid call and `ended` the id of every call that ends without a
    /// `respond`.
    pub fn start(
        data_dir: &Path,
        bridge: PathBuf,
        emit: impl Fn(ToolCall) + Send + Sync + 'static,
        ended: impl Fn(String) + Send + Sync + 'static,
    ) -> Result<Arc<AgentTools>, String> {
        Self::start_with_timeout(data_dir, bridge, Self::CALL_TIMEOUT, emit, ended)
    }

    pub fn start_with_timeout(
        data_dir: &Path,
        bridge: PathBuf,
        timeout: Duration,
        emit: impl Fn(ToolCall) + Send + Sync + 'static,
        ended: impl Fn(String) + Send + Sync + 'static,
    ) -> Result<Arc<AgentTools>, String> {
        let socket = socket_path(data_dir);
        let listener = Listener::bind(&socket)?;
        let service = Arc::new(AgentTools {
            tokens: Arc::new(Tokens::new()),
            socket,
            bridge,
            timeout,
            pending: Mutex::new(HashMap::new()),
            connections: Mutex::new(HashMap::new()),
            emit: Arc::new(emit),
            ended: Arc::new(ended),
            enabled: true,
        });
        let accepting = Arc::clone(&service);
        let tokens = Arc::clone(&service.tokens);
        thread::spawn(move || {
            // `accept_loop` never returns the listener, so its Drop cannot
            // remove the socket file: `shutdown` does that.
            listener.accept_loop(tokens, move |session, stream| {
                accepting.serve(session, stream)
            });
        });
        Ok(service)
    }

    /// An instance with no socket, for when `start` failed: every session
    /// gets `[]` and nothing is ever emitted.
    pub fn disabled() -> Arc<AgentTools> {
        Arc::new(AgentTools {
            tokens: Arc::new(Tokens::new()),
            socket: PathBuf::new(),
            bridge: PathBuf::new(),
            timeout: Self::CALL_TIMEOUT,
            pending: Mutex::new(HashMap::new()),
            connections: Mutex::new(HashMap::new()),
            emit: Arc::new(|_| {}),
            ended: Arc::new(|_| {}),
            enabled: false,
        })
    }

    /// The `mcpServers` value for a session: one stdio entry with a fresh
    /// token, or `[]` when `enabled` is false or this instance is disabled.
    pub fn servers_for(&self, app_session_id: &str, enabled: bool) -> Value {
        if !enabled || !self.enabled {
            return json!([]);
        }
        let token = self.tokens.issue(app_session_id);
        json!([{
            "name": "zorvo",
            "command": self.bridge.to_string_lossy(),
            "args": ["mcp-bridge"],
            "env": [
                { "name": "ZORVO_MCP_SOCKET", "value": self.socket.to_string_lossy() },
                { "name": "ZORVO_MCP_TOKEN", "value": token }
            ]
        }])
    }

    /// Answers a waiting call. Unknown or already answered: nothing happens.
    pub fn respond(&self, call_id: &str, ok: bool, text: &str) {
        let entry = lock(&self.pending).remove(call_id);
        if let Some(entry) = entry {
            entry.connection.send(&tool_result(&entry.rpc_id, ok, text));
        }
    }

    /// The session stopped: its token is forgotten, its connections close and
    /// its waiting calls end.
    pub fn forget(&self, app_session_id: &str) {
        self.tokens.forget(app_session_id);
        let doomed: Vec<Arc<Connection>> = lock(&self.connections)
            .values()
            .filter(|c| c.session == app_session_id)
            .cloned()
            .collect();
        for connection in &doomed {
            connection.close();
        }
        self.end_pending(|p| p.connection.session == app_session_id);
    }

    /// Removes the socket file and closes every connection. Call it when the
    /// app exits.
    pub fn shutdown(&self) {
        if self.enabled {
            let _ = std::fs::remove_file(&self.socket);
        }
        let all: Vec<Arc<Connection>> = lock(&self.connections).values().cloned().collect();
        for connection in all {
            connection.close();
        }
    }

    /// Removes every pending call that matches and reports each as ended.
    fn end_pending(&self, matches: impl Fn(&Pending) -> bool) {
        let removed: Vec<String> = {
            let mut pending = lock(&self.pending);
            let ids: Vec<String> = pending
                .iter()
                .filter(|(_, p)| matches(p))
                .map(|(id, _)| id.clone())
                .collect();
            for id in &ids {
                pending.remove(id);
            }
            ids
        };
        for id in removed {
            (self.ended)(id);
        }
    }

    fn serve(self: &Arc<Self>, session: String, stream: UnixStream) {
        let Ok(writer) = stream.try_clone() else {
            return;
        };
        let connection = Arc::new(Connection {
            id: NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed),
            session,
            writer: Mutex::new(writer),
        });
        lock(&self.connections).insert(connection.id, Arc::clone(&connection));
        // A session forgotten while this connection was being set up.
        if self.tokens_forgot(&connection.session) {
            connection.close();
        }
        let mut reader = BufReader::new(stream);
        while let Some(line) = read_line(&mut reader) {
            match line {
                Line::TooLong => connection.send(&json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": { "code": -32600, "message": "The message is too large." }
                })),
                Line::Text(text) => self.handle(&connection, &text),
            }
        }
        lock(&self.connections).remove(&connection.id);
        self.end_pending(|p| p.connection.id == connection.id);
    }

    fn tokens_forgot(&self, session: &str) -> bool {
        // `issue` always stores a token for a live session; a missing one
        // means `forget` ran in between.
        !self.tokens.has_session(session)
    }

    fn handle(self: &Arc<Self>, connection: &Arc<Connection>, line: &str) {
        match handle_line(line) {
            Step::Reply(value) => connection.send(&value),
            Step::Silent => {}
            Step::Cancel { request_id } => {
                self.end_pending(|p| p.connection.id == connection.id && p.rpc_id == request_id);
            }
            Step::Call { id, tool, args } => self.start_call(connection, id, tool, args),
        }
    }

    fn start_call(
        self: &Arc<Self>,
        connection: &Arc<Connection>,
        rpc_id: Value,
        tool: String,
        args: Value,
    ) {
        let call_id = NEXT_CALL.fetch_add(1, Ordering::Relaxed).to_string();
        let (stop, stopped) = mpsc::channel::<()>();
        // Recorded before the event goes out, so a quick answer finds it.
        lock(&self.pending).insert(
            call_id.clone(),
            Pending {
                connection: Arc::clone(connection),
                rpc_id: rpc_id.clone(),
                _timer_stop: stop,
            },
        );
        let service = Arc::clone(self);
        let timed = call_id.clone();
        thread::spawn(move || {
            // Disconnected means the entry left the table some other way.
            if let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(service.timeout) {
                service.time_out(&timed);
            }
        });
        (self.emit)(ToolCall {
            call_id,
            session_id: connection.session.clone(),
            tool,
            args,
        });
    }

    fn time_out(&self, call_id: &str) {
        let entry = lock(&self.pending).remove(call_id);
        if let Some(entry) = entry {
            entry
                .connection
                .send(&tool_result(&entry.rpc_id, false, TIMEOUT_TEXT));
            (self.ended)(call_id.to_string());
        }
    }
}

enum Line {
    Text(String),
    TooLong,
}

/// One line, read at most `MAX_LINE_BYTES` at a time: a longer line is
/// discarded up to its newline without being kept, and reported as
/// `TooLong`. `None` at the end of the stream or on a read error.
fn read_line(reader: &mut BufReader<UnixStream>) -> Option<Line> {
    let mut buf = Vec::new();
    let read = reader
        .by_ref()
        .take(MAX_LINE_BYTES as u64 + 1)
        .read_until(b'\n', &mut buf)
        .ok()?;
    if read == 0 {
        return None;
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
    } else if buf.len() > MAX_LINE_BYTES {
        discard_rest_of_line(reader)?;
        return Some(Line::TooLong);
    }
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    // Invalid UTF-8 cannot be JSON: hand it on lossily and let it fail to parse.
    Some(Line::Text(String::from_utf8_lossy(&buf).into_owned()))
}

fn discard_rest_of_line(reader: &mut BufReader<UnixStream>) -> Option<()> {
    loop {
        let chunk = reader.fill_buf().ok()?;
        if chunk.is_empty() {
            return Some(());
        }
        match chunk.iter().position(|b| *b == b'\n') {
            Some(at) => {
                reader.consume(at + 1);
                return Some(());
            }
            None => {
                let len = chunk.len();
                reader.consume(len);
            }
        }
    }
}
