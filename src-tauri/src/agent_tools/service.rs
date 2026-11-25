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

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};

use super::bridge::{SOCKET_VARIABLE, TOKEN_VARIABLE, TOOLS_VARIABLE};
use super::path::ToolsPath;
use super::peer::ProcessId;
use super::protocol::{
    handle_line, is_screen_tool, tool_result, tool_result_content, Step, MAX_LINE_BYTES,
};
use super::socket::{socket_path, Caller, Capabilities, Listener, Tokens};

static NEXT_CALL: AtomicU64 = AtomicU64::new(1);
static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);

const TIMEOUT_TEXT: &str = "Zorvo did not answer in time.";
const TOO_MANY_CALLS_TEXT: &str = "Too many tool calls are waiting; wait for one to finish.";
/// Calls one connection may have waiting at once.
const MAX_OPEN_CALLS_PER_CONNECTION: usize = 8;
/// A write that blocks this long (an agent that stopped reading) is given up.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

/// A valid tool call the webview has to answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub call_id: String,
    pub session_id: String,
    pub tool: String,
    pub args: Value,
}

/// A valid computer-use call. It never reaches the webview: `ScreenTools`
/// answers it with `respond` or `respond_content`.
#[derive(Debug, Clone)]
pub struct ScreenCall {
    pub call_id: String,
    pub session_id: String,
    /// The registry id of the session's agent, when the session said it.
    pub profile: Option<String>,
    pub path: ToolsPath,
    pub tool: String,
    pub args: Value,
}

/// What carries out computer-use calls (`computer_use::ScreenServer`).
pub trait ScreenTools: Send + Sync {
    /// Whether this server carries out `tool`.
    fn offers(&self, tool: &str) -> bool;
    /// Starts `call` without blocking: this runs on the connection's reader.
    fn call(&self, call: ScreenCall);
    /// `call_id` ended without an answer from here: it timed out, the agent
    /// cancelled it, or its session or connection went away.
    fn ended(&self, call_id: &str);
    /// The session stopped: what it was allowed ends with it.
    fn forget(&self, session: &str);
}

type Emit = Arc<dyn Fn(ToolCall) + Send + Sync>;
type Ended = Arc<dyn Fn(String) + Send + Sync>;

struct Connection {
    id: u64,
    caller: Caller,
    writer: Mutex<UnixStream>,
    /// A second handle to the same socket, used only to shut it down: it is
    /// outside the writer's mutex, so a blocked write cannot hold `close` up.
    shutter: UnixStream,
}

impl Connection {
    fn send(&self, line: &Value) {
        let mut text = line.to_string();
        text.push('\n');
        let mut writer = lock(&self.writer);
        let written = writer
            .write_all(text.as_bytes())
            .and_then(|_| writer.flush());
        drop(writer);
        // A write that failed or timed out may have left half a line behind:
        // anything sent after it would be unreadable, so the connection ends.
        if written.is_err() {
            self.close();
        }
    }

    fn close(&self) {
        let _ = self.shutter.shutdown(Shutdown::Both);
    }
}

/// Orders a call's two events: `ended` is never reported before the call
/// itself went out through `emit`.
#[derive(Default)]
struct CallState {
    inner: Mutex<CallPhase>,
}

#[derive(Default)]
struct CallPhase {
    emitted: bool,
    /// The call ended before `emit` returned; the emitter reports it.
    ended_early: bool,
}

/// A pending call taken out of the table: its id, its state and the backend that carried it out.
type Removed = (String, Arc<CallState>, Option<Arc<dyn ScreenTools>>);

struct Pending {
    tool: String,
    args: Value,
    connection: Arc<Connection>,
    state: Arc<CallState>,
    /// The JSON-RPC id the agent used, to answer it and to match a cancel.
    rpc_id: Value,
    /// A call a backend server carries out: its end is reported to it, not the webview.
    backend: Option<Arc<dyn ScreenTools>>,
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
    /// Servers that carry out calls in the backend (computer use, motion rendering), each
    /// added once at start by `set_screen_tools`.
    backends: Mutex<Vec<Arc<dyn ScreenTools>>>,
    /// Each session's agent, by registry id, for the name computer use shows.
    profiles: Mutex<HashMap<String, String>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl AgentTools {
    /// Read the authenticated, still-pending browser request. UI-supplied arguments
    /// never stand in for the request received from the bound agent process.
    pub fn browser_call(&self, call_id: &str) -> Option<(String, Value)> {
        let pending = lock(&self.pending);
        let call = pending.get(call_id)?;
        (call.tool == "browser")
            .then(|| (call.connection.caller.session.clone(), call.args.clone()))
    }

    pub fn browser_owner(&self, call_id: &str) -> Option<String> {
        self.browser_call(call_id).map(|(session, _)| session)
    }
    /// How long a call may wait for the webview. Agents give up on a tool call
    /// on their own (Antigravity after 3 minutes, Qwen Code and Codex after 5),
    /// so Zorvo answers before the shortest of them.
    pub const CALL_TIMEOUT: Duration = Duration::from_secs(170);

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
            backends: Mutex::new(Vec::new()),
            profiles: Mutex::new(HashMap::new()),
        });
        let accepting = Arc::clone(&service);
        let tokens = Arc::clone(&service.tokens);
        thread::spawn(move || {
            // `accept_loop` never returns the listener, so its Drop cannot
            // remove the socket file: `shutdown` does that.
            listener.accept_loop(tokens, move |caller, stream| {
                accepting.serve(caller, stream)
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
            backends: Mutex::new(Vec::new()),
            profiles: Mutex::new(HashMap::new()),
        })
    }

    /// The `mcpServers` value for a session: one stdio entry with a fresh
    /// token, or `[]` when `enabled` is false or this instance is disabled.
    pub fn servers_for(&self, app_session_id: &str, enabled: bool) -> Value {
        self.servers_with(
            app_session_id,
            Capabilities::agent_tools_only(enabled, ToolsPath::Mcp),
        )
    }

    /// The same for a session with these capabilities: `[]` when it has none.
    pub fn servers_with(&self, app_session_id: &str, capabilities: Capabilities) -> Value {
        if !capabilities.any() || !self.enabled {
            return json!([]);
        }
        let token = self.tokens.issue(app_session_id, capabilities);
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

    /// What an agent on the command path gets in its environment instead of
    /// an `mcpServers` entry: the socket, a fresh token and the program that
    /// runs `zorvo tools`. Empty when `enabled` is false or this instance is
    /// disabled.
    pub fn launch_env_for(&self, app_session_id: &str, enabled: bool) -> Vec<(String, String)> {
        self.launch_env_with(
            app_session_id,
            Capabilities::agent_tools_only(enabled, ToolsPath::Command),
        )
    }

    /// The same for a session with these capabilities: empty when it has none.
    pub fn launch_env_with(
        &self,
        app_session_id: &str,
        capabilities: Capabilities,
    ) -> Vec<(String, String)> {
        if !capabilities.any() || !self.enabled {
            return Vec::new();
        }
        let token = self.tokens.issue(app_session_id, capabilities);
        vec![
            (
                SOCKET_VARIABLE.to_string(),
                self.socket.to_string_lossy().into_owned(),
            ),
            (TOKEN_VARIABLE.to_string(), token),
            (
                TOOLS_VARIABLE.to_string(),
                self.bridge.to_string_lossy().into_owned(),
            ),
        ]
    }

    /// Answers a waiting call. Unknown or already answered: nothing happens.
    pub fn respond(&self, call_id: &str, ok: bool, text: &str) {
        let entry = lock(&self.pending).remove(call_id);
        if let Some(entry) = entry {
            if entry.tool == "browser" && ok && entry.args["operation"] == "screenshot" {
                if let Ok(mut value) = serde_json::from_str::<Value>(text) {
                    if value["mimeType"] == "image/png" {
                        if let Some(data) = value
                            .get("base64")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                        {
                            let valid = data.len() <= 7 * 1024 * 1024
                                && base64::engine::general_purpose::STANDARD
                                    .decode(&data)
                                    .is_ok_and(|bytes| {
                                        bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                                            && bytes.len() <= 5 * 1024 * 1024
                                    });
                            if valid {
                                value.as_object_mut().unwrap().remove("base64");
                                entry.connection.send(&json!({"jsonrpc":"2.0","id":entry.rpc_id,"result":{"content":[{"type":"text","text":value.to_string()},{"type":"image","mimeType":"image/png","data":data}],"isError":false}}));
                                return;
                            }
                        }
                        entry.connection.send(&tool_result(
                            &entry.rpc_id,
                            false,
                            "The browser screenshot is invalid or exceeds 5 MiB.",
                        ));
                        return;
                    }
                }
            }
            entry.connection.send(&tool_result(&entry.rpc_id, ok, text));
        }
    }

    /// Answers a waiting call with MCP content blocks (text and images).
    pub fn respond_content(&self, call_id: &str, ok: bool, content: Vec<Value>) {
        let entry = lock(&self.pending).remove(call_id);
        if let Some(entry) = entry {
            entry
                .connection
                .send(&tool_result_content(&entry.rpc_id, ok, content));
        }
    }

    /// Whether `call_id` still waits for its answer.
    pub fn is_waiting(&self, call_id: &str) -> bool {
        lock(&self.pending).contains_key(call_id)
    }

    /// Adds a server that carries out the tools it `offers` in the backend. Called at start.
    pub fn set_screen_tools(&self, screen: Arc<dyn ScreenTools>) {
        lock(&self.backends).push(screen);
    }

    /// The backend server that carries out `tool`, if any.
    fn backend_for(&self, tool: &str) -> Option<Arc<dyn ScreenTools>> {
        lock(&self.backends)
            .iter()
            .find(|backend| backend.offers(tool))
            .cloned()
    }

    /// The session runs this registry agent; computer use shows its name.
    pub fn note_profile(&self, app_session_id: &str, profile_id: &str) {
        lock(&self.profiles).insert(app_session_id.to_string(), profile_id.to_string());
    }

    /// A fork runs its source's agent.
    pub fn copy_profile(&self, source_session_id: &str, app_session_id: &str) {
        let mut profiles = lock(&self.profiles);
        if let Some(profile) = profiles.get(source_session_id).cloned() {
            profiles.insert(app_session_id.to_string(), profile);
        }
    }

    /// Reports a call as ended, now when its event already went out, else
    /// right after `emit` returns (see `start_call`).
    fn report_ended(
        &self,
        call_id: String,
        state: &CallState,
        backend: Option<Arc<dyn ScreenTools>>,
    ) {
        if let Some(backend) = backend {
            backend.ended(&call_id);
            return;
        }
        let now = {
            let mut phase = lock(&state.inner);
            if phase.emitted {
                true
            } else {
                phase.ended_early = true;
                false
            }
        };
        if now {
            (self.ended)(call_id);
        }
    }

    /// The session runs in this agent process: only it and its descendants
    /// may use the session's token.
    pub fn bind_process(&self, app_session_id: &str, process: ProcessId) {
        self.tokens.bind_process(app_session_id, process);
    }

    /// The session stopped: its token is forgotten, its connections close and
    /// its waiting calls end.
    pub fn forget(&self, app_session_id: &str) {
        self.tokens.forget(app_session_id);
        lock(&self.profiles).remove(app_session_id);
        let doomed: Vec<Arc<Connection>> = lock(&self.connections)
            .values()
            .filter(|c| c.caller.session == app_session_id)
            .cloned()
            .collect();
        for connection in &doomed {
            connection.close();
        }
        self.end_pending(|p| p.connection.caller.session == app_session_id);
        let backends: Vec<Arc<dyn ScreenTools>> = lock(&self.backends).clone();
        for backend in backends {
            backend.forget(app_session_id);
        }
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
        let removed: Vec<Removed> = {
            let mut pending = lock(&self.pending);
            let ids: Vec<String> = pending
                .iter()
                .filter(|(_, p)| matches(p))
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id).map(|p| (id, p.state, p.backend)))
                .collect()
        };
        for (id, state, backend) in removed {
            self.report_ended(id, &state, backend);
        }
    }

    fn serve(self: &Arc<Self>, caller: Caller, stream: UnixStream) {
        let (Ok(writer), Ok(shutter)) = (stream.try_clone(), stream.try_clone()) else {
            return;
        };
        // The timeout belongs to the socket, so the other handles share it.
        if writer.set_write_timeout(Some(WRITE_TIMEOUT)).is_err() {
            return;
        }
        let connection = Arc::new(Connection {
            id: NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed),
            caller,
            writer: Mutex::new(writer),
            shutter,
        });
        lock(&self.connections).insert(connection.id, Arc::clone(&connection));
        // A session forgotten while this connection was being set up.
        if self.tokens_forgot(&connection.caller.session) {
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
        match handle_line(line, &connection.caller) {
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
        let screen = self.backend_for(&tool);
        if crate::agent_tools::tools::MOTION_TOOL_NAMES.contains(&tool.as_str()) && screen.is_none()
        {
            connection.send(&tool_result(&rpc_id, false, "Rendering is not available."));
            return;
        }
        if is_screen_tool(&tool) && screen.is_none() {
            connection.send(&tool_result(
                &rpc_id,
                false,
                "Computer use is not available.",
            ));
            return;
        }
        let call_id = NEXT_CALL.fetch_add(1, Ordering::Relaxed).to_string();
        let (stop, stopped) = mpsc::channel::<()>();
        let state = Arc::new(CallState::default());
        // Recorded before the event goes out, so a quick answer finds it. The
        // count and the insert share one lock, so the cap cannot be raced.
        {
            let mut pending = lock(&self.pending);
            let open = pending
                .values()
                .filter(|p| p.connection.id == connection.id)
                .count();
            if open >= MAX_OPEN_CALLS_PER_CONNECTION {
                drop(pending);
                connection.send(&tool_result(&rpc_id, false, TOO_MANY_CALLS_TEXT));
                return;
            }
            pending.insert(
                call_id.clone(),
                Pending {
                    tool: tool.clone(),
                    args: args.clone(),
                    connection: Arc::clone(connection),
                    state: Arc::clone(&state),
                    rpc_id: rpc_id.clone(),
                    backend: screen.clone(),
                    _timer_stop: stop,
                },
            );
        }
        let service = Arc::clone(self);
        let timed = call_id.clone();
        let spawned = thread::Builder::new().spawn(move || {
            // Disconnected means the entry left the table some other way.
            if let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(service.timeout) {
                service.time_out(&timed);
            }
        });
        if spawned.is_err() {
            lock(&self.pending).remove(&call_id);
            connection.send(&tool_result(&rpc_id, false, TOO_MANY_CALLS_TEXT));
            return;
        }
        if let Some(screen) = screen {
            let profile = lock(&self.profiles)
                .get(&connection.caller.session)
                .cloned();
            return screen.call(ScreenCall {
                call_id,
                session_id: connection.caller.session.clone(),
                profile,
                path: connection.caller.capabilities.path,
                tool,
                args,
            });
        }
        (self.emit)(ToolCall {
            call_id: call_id.clone(),
            session_id: connection.caller.session.clone(),
            tool,
            args,
        });
        // An end that came in during `emit` waited for it: report it now.
        let late = {
            let mut phase = lock(&state.inner);
            phase.emitted = true;
            phase.ended_early
        };
        if late {
            (self.ended)(call_id);
        }
    }

    fn time_out(&self, call_id: &str) {
        let entry = lock(&self.pending).remove(call_id);
        if let Some(entry) = entry {
            entry
                .connection
                .send(&tool_result(&entry.rpc_id, false, TIMEOUT_TEXT));
            self.report_ended(call_id.to_string(), &entry.state, entry.backend);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_write_that_cannot_finish_closes_the_connection() {
        let (ours, mut theirs) = UnixStream::pair().expect("pair");
        ours.set_write_timeout(Some(Duration::from_millis(50)))
            .expect("timeout");
        let connection = Connection {
            id: 1,
            caller: Caller {
                session: "s-1".to_string(),
                capabilities: Capabilities::agent_tools_only(true, ToolsPath::Mcp),
            },
            writer: Mutex::new(ours.try_clone().expect("clone")),
            shutter: ours,
        };

        // More than the socket holds, and nobody reads: the write times out mid-line.
        connection.send(&json!({ "text": "x".repeat(8 * 1024 * 1024) }));

        // A closed connection reads to its end; an open one would block until the timeout.
        theirs
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        let mut received = Vec::new();
        assert!(theirs.read_to_end(&mut received).is_ok());
        assert!(received.len() < 8 * 1024 * 1024);
    }
}
