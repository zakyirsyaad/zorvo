//! The client of cua-driver's private worker.
//!
//! The worker is `cua-driver __private-worker --generation <id>`: one JSON
//! object per line on its stdin and stdout, which only Zorvo holds. It answers
//! one request before it reads the next and has no way to cancel one, so this
//! client keeps its own queue, writes one request at a time, and ends a call
//! that is already running by killing the worker.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// The only worker protocol this client speaks.
pub const WORKER_PROTOCOL_VERSION: u64 = 1;
/// The longest line read from the worker (screenshots travel as base64).
pub const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
/// How long the worker gets to answer `initialize`.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
/// The longest life and idle time a bound session may have. The worker takes
/// these as its ceiling in `initialize`; Zorvo ends sessions itself, so the
/// driver's own expiry should never be what ends one.
const SESSION_TTL_SECONDS: u64 = 365 * 24 * 60 * 60;

/// A driver session the worker issued a handle for.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SessionHandle(String);

/// One request this client was asked to make.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CallId(u64);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DriverError {
    /// The worker is gone: it exited, was killed, or never started.
    Exited,
    /// The worker wrote a line over `MAX_LINE_BYTES`; it was killed.
    LineTooLong,
    /// The worker does not speak the protocol, or is not the pinned release.
    Protocol(String),
    /// The worker answered the request with an error.
    Refused(String),
    /// The call was abandoned before its answer.
    Abandoned,
}

/// What `start` needs besides the command.
pub struct StartOptions<'a> {
    /// 1 to 128 characters of `[A-Za-z0-9-]`, fresh for every start.
    pub generation: String,
    pub host_bundle_id: &'a str,
    /// The pinned release; `None` accepts any (tests).
    pub driver_version: Option<&'a str>,
}

struct Queued {
    id: u64,
    line: String,
}

#[derive(Default)]
struct State {
    next_id: u64,
    queue: VecDeque<Queued>,
    /// The request the worker is answering now.
    running: Option<u64>,
    answers: HashMap<u64, Result<Value, DriverError>>,
    /// Set once; every later request fails with it.
    dead: Option<DriverError>,
}

struct Inner {
    generation: String,
    state: Mutex<State>,
    changed: Condvar,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
}

pub struct DriverClient {
    inner: Arc<Inner>,
    pid: u32,
}

impl Inner {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Writes the next queued request when the worker is free.
    fn pump(&self) {
        let next = {
            let mut state = self.state();
            if state.running.is_some() || state.dead.is_some() {
                return;
            }
            let Some(next) = state.queue.pop_front() else {
                return;
            };
            state.running = Some(next.id);
            next
        };
        let written = {
            let mut stdin = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
            match stdin.as_mut() {
                Some(pipe) => pipe
                    .write_all(next.line.as_bytes())
                    .and_then(|()| pipe.flush())
                    .is_ok(),
                None => false,
            }
        };
        if !written {
            self.fail(DriverError::Exited);
        }
    }

    /// Marks the worker dead; every waiting and later call ends with `error`.
    fn fail(&self, error: DriverError) {
        let mut state = self.state();
        if state.dead.is_none() {
            state.dead = Some(error);
        }
        state.queue.clear();
        state.running = None;
        drop(state);
        self.changed.notify_all();
    }

    /// Kills the worker and waits for it, so no zombie is left.
    fn kill(&self) {
        // No request is written from here on, whatever the reader does next.
        self.fail(DriverError::Exited);
        // The child first: a write stuck on a worker that stopped reading
        // holds the stdin lock, and only the child's end releases it.
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        let _ = child.kill();
        let _ = child.wait();
        drop(child);
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn on_line(&self, line: &[u8]) {
        let Ok(message) = serde_json::from_slice::<Value>(line) else {
            return self.fail(DriverError::Protocol(
                "The driver wrote a line that is not JSON.".into(),
            ));
        };
        if message.get("protocol_version").and_then(Value::as_u64) != Some(WORKER_PROTOCOL_VERSION)
        {
            return self.fail(DriverError::Protocol(
                "The driver speaks another protocol version.".into(),
            ));
        }
        if message.get("generation").and_then(Value::as_str) != Some(self.generation.as_str()) {
            return self.fail(DriverError::Protocol(
                "The driver answered for another generation.".into(),
            ));
        }
        let id = message.get("request_id").and_then(Value::as_u64);
        let mut state = self.state();
        // The worker answers only the one request it was given.
        let Some(id) = id.filter(|id| state.running == Some(*id)) else {
            return;
        };
        state.running = None;
        let answer = if message.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(message.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(DriverError::Refused(
                message
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("The driver refused the request.")
                    .to_string(),
            ))
        };
        state.answers.entry(id).or_insert(answer);
        drop(state);
        self.changed.notify_all();
        self.pump();
    }
}

/// Reads one line of at most `MAX_LINE_BYTES`. `Ok(None)` is end of input;
/// `Err` is a line over the limit.
fn read_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> Result<Option<()>, DriverError> {
    line.clear();
    loop {
        let available = match reader.fill_buf() {
            Ok([]) => return Ok(None),
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Ok(None),
        };
        let (take, done) = match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => (index + 1, true),
            None => (available.len(), false),
        };
        if line.len() + take > MAX_LINE_BYTES {
            return Err(DriverError::LineTooLong);
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        if done {
            return Ok(Some(()));
        }
    }
}

fn read_answers(inner: Arc<Inner>, stdout: impl Read) {
    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    loop {
        match read_line(&mut reader, &mut line) {
            Ok(Some(())) => {
                inner.on_line(&line);
                // A worker that broke the protocol is not left running.
                if inner.state().dead.is_some() {
                    return inner.kill();
                }
            }
            // `kill` (at the latest when the client is dropped) reaps the worker.
            Ok(None) => return inner.fail(DriverError::Exited),
            Err(error) => {
                inner.fail(error);
                return inner.kill();
            }
        }
    }
}

impl DriverClient {
    /// Starts the worker and runs `initialize`. `command` is the driver with
    /// its environment already set; this adds the arguments and the pipes.
    pub fn start(
        mut command: Command,
        options: StartOptions<'_>,
    ) -> Result<Arc<DriverClient>, DriverError> {
        let mut child = command
            .args(["__private-worker", "--generation", &options.generation])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| DriverError::Exited)?;
        // The pid of the process Zorvo started, never the one the worker reports.
        let pid = child.id();
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DriverError::Exited);
        };
        let inner = Arc::new(Inner {
            generation: options.generation,
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
            stdin: Mutex::new(Some(stdin)),
            child: Mutex::new(child),
        });
        let reader = Arc::clone(&inner);
        thread::spawn(move || read_answers(reader, stdout));

        let initialize = json!({
            "configured_driver": {
                "claude_code_compatibility": false,
                "authorization": {
                    "allowed_modes": ["standard"],
                    "compatibility_mode": "standard",
                    "compatibility_capability_manifest_path": null,
                    "compatibility_bounded_manifest_path": null,
                    "unrestricted_acknowledged": false,
                    "max_session_ttl_seconds": SESSION_TTL_SECONDS,
                    "max_idle_ttl_seconds": SESSION_TTL_SECONDS,
                },
            },
            "host_bundle_id": options.host_bundle_id,
        });
        let client = DriverClient { inner, pid };
        // `initialize` must be request 0, and it is: nothing was queued before.
        let call = client.begin("initialize", None, Some(initialize), None);
        let ready = match client.wait_for(call, Some(Instant::now() + STARTUP_TIMEOUT)) {
            Ok(ready) => ready,
            Err(error) => {
                client.inner.kill();
                return Err(error);
            }
        };
        let version = ready
            .pointer("/metadata/driver_version")
            .and_then(Value::as_str);
        let problem = if ready.get("ready").and_then(Value::as_bool) != Some(true) {
            Some("The driver did not report that it is ready.".to_string())
        } else if options.driver_version.is_some() && version != options.driver_version {
            Some("The driver is not the release Zorvo pins.".to_string())
        } else {
            None
        };
        if let Some(problem) = problem {
            client.inner.kill();
            return Err(DriverError::Protocol(problem));
        }
        Ok(Arc::new(client))
    }

    /// The pid of the worker process Zorvo started.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Whether the worker can still take requests.
    pub fn is_alive(&self) -> bool {
        self.inner.state().dead.is_none()
    }

    fn begin(
        &self,
        operation: &str,
        name: Option<&str>,
        arguments: Option<Value>,
        session: Option<&SessionHandle>,
    ) -> CallId {
        let mut state = self.inner.state();
        let id = state.next_id;
        state.next_id += 1;
        let mut request = json!({
            "protocol_version": WORKER_PROTOCOL_VERSION,
            "request_id": id,
            "generation": self.inner.generation,
            "operation": operation,
        });
        if let Some(name) = name {
            request["name"] = json!(name);
        }
        if let Some(arguments) = arguments {
            request["arguments"] = arguments;
        }
        if let Some(session) = session {
            request["session_handle"] = json!(session.0);
        }
        if state.dead.is_none() {
            state.queue.push_back(Queued {
                id,
                line: format!("{request}\n"),
            });
        }
        drop(state);
        self.inner.pump();
        CallId(id)
    }

    /// Waits for `call`'s answer, for ever or until `deadline`.
    fn wait_for(&self, call: CallId, deadline: Option<Instant>) -> Result<Value, DriverError> {
        let mut state = self.inner.state();
        loop {
            if let Some(answer) = state.answers.remove(&call.0) {
                return answer;
            }
            if let Some(error) = &state.dead {
                return Err(error.clone());
            }
            state = match deadline {
                None => self.inner.changed.wait(state),
                Some(deadline) => {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        return Err(DriverError::Exited);
                    }
                    self.inner
                        .changed
                        .wait_timeout(state, left)
                        .map(|(state, _)| state)
                        .map_err(|e| std::sync::PoisonError::new(e.into_inner().0))
                }
            }
            .unwrap_or_else(|e| e.into_inner());
        }
    }

    /// Blocks until `call` has its answer. The caller owns the time limit and
    /// ends a call that takes too long with `abandon`.
    pub fn wait(&self, call: CallId) -> Result<Value, DriverError> {
        self.wait_for(call, None)
    }

    /// The worker's tool list.
    pub fn list(&self) -> Result<Value, DriverError> {
        let call = self.begin("list", None, None, None);
        self.wait(call)
    }

    /// Binds a driver session named `label`; the cursor's badge shows it.
    pub fn bind_session(&self, label: &str) -> Result<SessionHandle, DriverError> {
        let options = json!({
            "public_session": label,
            "mode": "standard",
            "ttl_seconds": SESSION_TTL_SECONDS,
            "idle_ttl_seconds": SESSION_TTL_SECONDS,
            "capability_manifest_path": null,
            "bounded_manifest_path": null,
        });
        let call = self.begin("bind_session", None, Some(options), None);
        self.wait(call)?
            .get("session_handle")
            .and_then(Value::as_str)
            .map(|handle| SessionHandle(handle.to_string()))
            .ok_or_else(|| DriverError::Protocol("The driver returned no session handle.".into()))
    }

    /// Ends a driver session. Nothing waits for the answer.
    pub fn close_session(&self, handle: &SessionHandle) {
        let call = self.begin("close_session", None, None, Some(handle));
        self.forget(call);
    }

    /// Queues a tool call of `session`. `wait` returns its MCP-shaped result.
    pub fn begin_call(&self, session: &SessionHandle, tool: &str, arguments: Value) -> CallId {
        self.begin("call", Some(tool), Some(arguments), Some(session))
    }

    /// Ends `call` without its answer: a queued call is dropped, and a call
    /// the worker is running kills the worker, since nothing else stops it.
    pub fn abandon(&self, call: CallId) {
        let mut state = self.inner.state();
        if let Some(index) = state.queue.iter().position(|queued| queued.id == call.0) {
            state.queue.remove(index);
            state.answers.insert(call.0, Err(DriverError::Abandoned));
            drop(state);
            return self.inner.changed.notify_all();
        }
        if state.running != Some(call.0) {
            return;
        }
        state.answers.insert(call.0, Err(DriverError::Abandoned));
        // Dead before the lock is released: if the worker's answer arrives
        // now, the reader must not go on to write the next queued call to a
        // worker that is about to be killed for this one.
        state.dead = Some(DriverError::Exited);
        state.queue.clear();
        state.running = None;
        drop(state);
        self.inner.changed.notify_all();
        self.inner.kill();
    }

    /// Drops the answer of a call nobody waits for, when it arrives.
    fn forget(&self, call: CallId) {
        let inner = Arc::clone(&self.inner);
        thread::spawn(move || {
            let mut state = inner.state();
            loop {
                if state.answers.remove(&call.0).is_some() || state.dead.is_some() {
                    return;
                }
                state = inner.changed.wait(state).unwrap_or_else(|e| e.into_inner());
            }
        });
    }

    /// Kills the worker and waits for it. Every call in flight fails.
    pub fn kill(&self) {
        self.inner.kill();
    }
}

impl Drop for DriverClient {
    fn drop(&mut self) {
        self.inner.kill();
    }
}
