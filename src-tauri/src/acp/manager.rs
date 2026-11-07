//! Maps app sessions onto ACP sessions running in agent processes.
//!
//! One agent process can host several ACP sessions (a fork lives in the same
//! process as its source), so connections are shared and only killed when the
//! last app session using them stops.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use serde_json::{json, Value};

use super::connection::{error_message, AcpConnection, ConnectionEvent, EventSink};
use super::elicitation::{Pending, PendingElicitations};
use super::permission_response::permission_response;
use super::prompt_blocks::prompt_blocks;
use super::terminal_auth::{terminal_method, SignInAttempts, TerminalMethodError};
use crate::pty_session::validate_cwd;
use private_errors::private_credits_error;

mod elicitation_routes;
mod private_errors;
mod reopen;
mod routing;
mod sign_in;

pub use elicitation_routes::{
    UrlOpener, ELICITATION_GONE, ELICITATION_INVALID_PREFIX, ELICITATION_UNDELIVERED,
};
pub use reopen::{ReopenMethod, ReopenPurpose};
use routing::{answer, route_event};
use sign_in::{is_auth_required, offers_sign_in};

/// ACP protocol version this client speaks.
pub const PROTOCOL_VERSION: u64 = 1;
/// The first start may download an adapter through npx, so allow a long handshake.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(180);
pub(super) const SESSION_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// JSON-RPC "method not found", returned for client methods we do not offer.
const METHOD_NOT_FOUND: i64 = -32601;
/// Signing in may wait for the user to finish in a browser.
const AUTHENTICATE_TIMEOUT: Duration = Duration::from_secs(300);
/// Starts the error of a session that needs a sign-in; the agent's auth methods follow as JSON.
pub const AUTH_REQUIRED_PREFIX: &str = "ACP_AUTH_REQUIRED:";

/// How to start an ACP agent.
#[derive(Clone, PartialEq, Eq)]
pub struct AcpLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// A Zorvo Private session: the env holds the NEAR AI key. Only
    /// `private_mode::launch::private_launch` sets this.
    pub private: bool,
}

/// Prints the environment's names only: a private launch holds the NEAR AI key
/// in its env, and no `{:?}` may ever print it.
impl std::fmt::Debug for AcpLaunch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let env: Vec<(&str, &str)> = self
            .env
            .iter()
            .map(|(name, _)| (name.as_str(), "…"))
            .collect();
        f.debug_struct("AcpLaunch")
            .field("program", &self.program)
            .field("args", &self.args)
            .field("env", &env)
            .field("private", &self.private)
            .finish()
    }
}

/// What `authenticate` says for a method that signs in through a terminal.
const TERMINAL_METHOD_MESSAGE: &str = "This sign-in runs in a terminal";

/// Why opening a session failed: the agent answered with an error (its
/// message says it all), or the process or transport failed (the agent's
/// stderr helps explain that).
pub(super) enum OpenError {
    Agent(String),
    Transport(String),
}

/// What the agent reported when a session started, was reopened or was forked.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedSession {
    pub acp_session_id: String,
    pub agent_capabilities: Value,
    pub modes: Value,
    pub models: Value,
    pub config_options: Value,
    /// How an earlier session was reopened; absent for a start or a fork.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopened_with: Option<ReopenMethod>,
}

/// Events for the UI, already routed to the app session they belong to.
#[derive(Debug, Clone)]
pub enum AcpEvent {
    Update {
        session_id: String,
        update: Value,
    },
    PermissionRequest {
        session_id: String,
        request_id: Value,
        params: Value,
    },
    /// The prompt turn finished: `Ok(stopReason)` or `Err(message)`.
    TurnEnded {
        session_id: String,
        stop_reason: Result<String, String>,
    },
    Exited {
        session_id: String,
        code: Option<i32>,
    },
    /// The agent asks the user for input; `key` names the request in answers.
    Elicitation {
        session_id: String,
        key: String,
        view: Value,
    },
    /// The agent says the URL request `key` is done.
    ElicitationComplete {
        session_id: String,
        key: String,
    },
}

pub type AcpEventSink = Box<dyn Fn(AcpEvent) + Send + Sync>;

struct SessionEntry {
    connection: Arc<AcpConnection>,
    connection_key: u64,
    acp_session_id: String,
    agent_capabilities: Value,
    /// The sign-in methods the agent reported, offered again when it refuses a prompt.
    auth_methods: Value,
    /// The folder the session works in.
    cwd: PathBuf,
    /// A Zorvo Private session: NEAR AI's credit and key refusals are reported
    /// as `PRIVATE_CREDITS:` errors, and the session is never offered a sign-in.
    private: bool,
}

/// What opening a session learned that its entry keeps: the sign-in methods
/// the agent reported, and whether the launch was private.
struct EntryTraits {
    auth_methods: Value,
    private: bool,
}

#[derive(Default)]
struct Routes {
    /// app session id -> entry
    sessions: HashMap<String, SessionEntry>,
    /// (connection key, acp session id) -> app session id. Keyed by connection
    /// too: two agent processes may give their sessions the same id.
    by_acp_id: HashMap<(u64, String), String>,
    /// (connection key, acp session id) -> app session id, for an import whose
    /// `session/load` is replaying: only its `session/update`s are routed.
    /// Requests keep to `by_acp_id`, so one sent mid-replay is answered as
    /// during any open instead of waiting on a session that is not registered.
    replaying: HashMap<(u64, String), String>,
    /// connection key -> the app session `open()` is starting on it, for
    /// requests sent before the answer that routes the session.
    opening: HashMap<u64, String>,
    /// Elicitation requests not yet answered or finished.
    elicitations: PendingElicitations,
}

/// A session already taken off the routes by `AcpManager::detach`: its open
/// elicitations still to answer `cancel`, and its agent to kill when no other
/// session used it.
#[derive(Default)]
pub struct DetachedSession {
    requests: Vec<Pending>,
    connection: Option<Arc<AcpConnection>>,
}

impl DetachedSession {
    /// The second half of `AcpManager::stop`.
    pub fn end(self) {
        elicitation_routes::cancel_open(self.requests);
        if let Some(connection) = self.connection {
            connection.kill();
        }
    }
}

pub struct AcpManager {
    routes: Arc<Mutex<Routes>>,
    sink: Arc<AcpEventSink>,
    next_connection_key: AtomicU64,
    /// Terminal sign-ins still starting, so a cancel can end them.
    sign_ins: SignInAttempts,
    /// Opens the link of an accepted URL elicitation.
    url_opener: UrlOpener,
}

impl AcpManager {
    pub fn new(sink: AcpEventSink) -> Self {
        Self::with_url_opener(sink, Box::new(crate::windows::open_url))
    }

    /// A manager that opens elicitation links with `opener` (tests record them).
    pub fn with_url_opener(sink: AcpEventSink, opener: UrlOpener) -> Self {
        Self {
            routes: Arc::new(Mutex::new(Routes::default())),
            sink: Arc::new(sink),
            next_connection_key: AtomicU64::new(1),
            sign_ins: SignInAttempts::default(),
            url_opener: opener,
        }
    }

    /// The terminal sign-ins being started.
    pub fn sign_ins(&self) -> &SignInAttempts {
        &self.sign_ins
    }

    /// Starts an agent process, initializes ACP and opens a session in `cwd`.
    pub fn start(
        &self,
        app_session_id: &str,
        cwd: &str,
        launch: &AcpLaunch,
    ) -> Result<StartedSession, String> {
        self.open(app_session_id, cwd, launch, |connection, init, key| {
            let session = open_request(
                connection,
                init,
                "session/new",
                json!({ "cwd": cwd, "mcpServers": [] }),
                launch.private,
                self.route_on_answer(key, app_session_id, None, true, false),
            )?;
            started_session(session, init["agentCapabilities"].clone()).map_err(OpenError::Agent)
        })
    }

    /// Spawns the agent, initializes ACP, opens a session with `open_session`
    /// (which gets the connection's key) and registers it. On failure the
    /// process is killed and its stderr tail is added to the error.
    fn open(
        &self,
        app_session_id: &str,
        cwd: &str,
        launch: &AcpLaunch,
        open_session: impl FnOnce(&AcpConnection, &Value, u64) -> Result<StartedSession, OpenError>,
    ) -> Result<StartedSession, String> {
        validate_cwd(cwd)?;
        let connection_key = self.next_connection_key.fetch_add(1, Ordering::SeqCst);
        let connection = AcpConnection::spawn(
            &launch.program,
            &launch.args,
            cwd,
            &launch.env,
            |connection| self.connection_sink(connection_key, connection),
        )?;
        self.set_opening(connection_key, Some(app_session_id));

        let opened = initialize(&connection)
            .map_err(OpenError::Transport)
            .and_then(|init| {
                open_session(&connection, &init, connection_key)
                    .map(|started| (started, auth_methods_of(&init)))
            });
        let (started, auth_methods) = match opened {
            Ok(opened) => opened,
            Err(error) => {
                // Its requests can no longer be answered.
                self.set_opening(connection_key, None);
                if let Ok(mut routes) = self.routes.lock() {
                    routes.elicitations.take_session(app_session_id);
                    // An import that never answered: its replay has nowhere to go.
                    routes
                        .replaying
                        .retain(|_, routed| routed != app_session_id);
                }
                return Err(failure_message(&connection, error));
            }
        };
        let traits = EntryTraits {
            auth_methods,
            private: launch.private,
        };
        self.register(
            app_session_id,
            connection,
            connection_key,
            &started,
            traits,
            cwd,
        );
        self.set_opening(connection_key, None);
        Ok(started)
    }

    /// Marks connection `connection_key` as opening `app_session_id`, or no longer opening.
    fn set_opening(&self, connection_key: u64, app_session_id: Option<&str>) {
        if let Ok(mut routes) = self.routes.lock() {
            match app_session_id {
                Some(id) => routes.opening.insert(connection_key, id.to_string()),
                None => routes.opening.remove(&connection_key),
            };
        }
    }

    /// Signs in to the agent with one of the methods it reported, in a
    /// short-lived process. Methods that need a secret (an API key in the
    /// environment) are for the user to set up outside the app.
    pub fn authenticate(
        &self,
        cwd: &str,
        launch: &AcpLaunch,
        method_id: &str,
    ) -> Result<(), String> {
        validate_cwd(cwd)?;
        let connection = spawn_unrouted(cwd, launch, |_, _| {})?;
        let result = initialize(&connection).and_then(|init| {
            if is_terminal_method(&init, method_id) {
                return Err(TERMINAL_METHOD_MESSAGE.to_string());
            }
            connection.request(
                "authenticate",
                json!({ "methodId": method_id }),
                AUTHENTICATE_TIMEOUT,
            )
        });
        connection.kill();
        result.map(|_| ())
    }

    /// Forks `source` into a new app session hosted by the same agent process.
    pub fn fork(
        &self,
        source_app_id: &str,
        new_app_id: &str,
        cwd: &str,
    ) -> Result<StartedSession, String> {
        let (connection, connection_key, acp_id, capabilities, traits) =
            self.with_entry(source_app_id, |e| {
                (
                    Arc::clone(&e.connection),
                    e.connection_key,
                    e.acp_session_id.clone(),
                    e.agent_capabilities.clone(),
                    // The fork lives in its source's process, so it is as private as its source.
                    EntryTraits {
                        auth_methods: e.auth_methods.clone(),
                        private: e.private,
                    },
                )
            })?;
        // The UI offers fork only when the agent can, but don't rely on it.
        if !capabilities["sessionCapabilities"]["fork"].is_object() {
            return Err("This agent cannot fork sessions".to_string());
        }
        let response = connection.request_with(
            "session/fork",
            json!({ "sessionId": acp_id, "cwd": cwd, "mcpServers": [] }),
            SESSION_REQUEST_TIMEOUT,
            self.route_on_answer(connection_key, new_app_id, None, false, false),
        )?;
        let started = started_session(response, capabilities)?;
        self.register(
            new_app_id,
            connection,
            connection_key,
            &started,
            traits,
            cwd,
        );
        Ok(started)
    }

    /// Sends a user prompt. Returns once sent; the turn ends with `TurnEnded`.
    pub fn prompt(
        &self,
        app_session_id: &str,
        text: &str,
        attachments: &[String],
    ) -> Result<(), String> {
        let (connection, acp_id, capabilities, auth_methods, private) =
            self.with_entry(app_session_id, |e| {
                (
                    Arc::clone(&e.connection),
                    e.acp_session_id.clone(),
                    e.agent_capabilities.clone(),
                    e.auth_methods.clone(),
                    e.private,
                )
            })?;
        let supports_images = capabilities["promptCapabilities"]["image"] == Value::Bool(true);
        let prompt = prompt_blocks(text, attachments, supports_images)?;
        let sink = Arc::clone(&self.sink);
        let session_id = app_session_id.to_string();
        connection.send_request(
            "session/prompt",
            json!({ "sessionId": acp_id, "prompt": prompt }),
            Box::new(move |result| {
                // An agent can open a session signed out and refuse only the
                // prompt (Claude Code does): the UI then asks for a sign-in.
                // A private session is never asked to sign in: used-up credits
                // and a refused key come first, as `PRIVATE_CREDITS:` errors.
                let stop_reason = result
                    .map(|r| r["stopReason"].as_str().unwrap_or("end_turn").to_string())
                    .map_err(|e| {
                        if let Some(credits) = private.then(|| private_credits_error(&e)).flatten()
                        {
                            credits
                        } else if is_auth_required(&e, offers_sign_in(&auth_methods)) {
                            auth_required_error(&auth_methods)
                        } else {
                            error_message(&e)
                        }
                    });
                sink(AcpEvent::TurnEnded {
                    session_id,
                    stop_reason,
                });
            }),
        )
    }

    /// Cancels the turn, after answering the session's open elicitations
    /// `cancel`; returns their keys, so the UI dismisses exactly those.
    pub fn cancel(&self, app_session_id: &str) -> Result<Vec<String>, String> {
        let cancelled = self.cancel_open_elicitations(app_session_id);
        let (connection, acp_id) = self.connection_for(app_session_id)?;
        connection.notify("session/cancel", json!({ "sessionId": acp_id }))?;
        Ok(cancelled)
    }

    /// Answers a permission request; `None` cancels it. `answers` are the typed
    /// answers of Qwen Code's `ask_user_question`, sent next to the outcome once
    /// checked (see `permission_response`).
    pub fn respond_permission(
        &self,
        app_session_id: &str,
        request_id: &Value,
        option_id: Option<&str>,
        answers: Option<&BTreeMap<String, String>>,
    ) -> Result<(), String> {
        // Checked before the connection is looked up, so bad input is refused on its own terms.
        let response = permission_response(option_id, answers)?;
        let (connection, _) = self.connection_for(app_session_id)?;
        connection.respond(request_id, response)
    }

    pub fn set_mode(&self, app_session_id: &str, mode_id: &str) -> Result<(), String> {
        let (connection, acp_id) = self.connection_for(app_session_id)?;
        connection
            .request(
                "session/set_mode",
                json!({ "sessionId": acp_id, "modeId": mode_id }),
                SESSION_REQUEST_TIMEOUT,
            )
            .map(|_| ())
    }

    /// Sets the model of a session whose agent reported `models` (the unstable
    /// `session/set_model`; agents that moved to a model config option use
    /// `set_config_option` instead). An agent that does not know the model refuses it.
    pub fn set_model(&self, app_session_id: &str, model_id: &str) -> Result<(), String> {
        let (connection, acp_id) = self.connection_for(app_session_id)?;
        connection
            .request(
                "session/set_model",
                json!({ "sessionId": acp_id, "modelId": model_id }),
                SESSION_REQUEST_TIMEOUT,
            )
            .map(|_| ())
    }

    /// Sets a session config option (e.g. the model); returns the agent's updated options.
    pub fn set_config_option(
        &self,
        app_session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<Value, String> {
        let (connection, acp_id) = self.connection_for(app_session_id)?;
        let response = connection.request(
            "session/set_config_option",
            json!({ "sessionId": acp_id, "configId": config_id, "value": value }),
            SESSION_REQUEST_TIMEOUT,
        )?;
        Ok(response["configOptions"].clone())
    }

    /// The agent's own id for a running session, e.g. to find the agent's log of it.
    pub fn acp_session_id(&self, app_session_id: &str) -> Option<String> {
        self.with_entry(app_session_id, |e| e.acp_session_id.clone())
            .ok()
    }

    /// Whether the running session `app_session_id` is a Zorvo Private session
    /// (false for an unknown id).
    pub fn is_private_session(&self, app_session_id: &str) -> bool {
        self.with_entry(app_session_id, |e| e.private)
            .unwrap_or(false)
    }

    /// The app session ids of every running session, in no particular order.
    pub fn session_ids(&self) -> Vec<String> {
        self.routes
            .lock()
            .map(|routes| routes.sessions.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Stops every session; returns how many there were.
    pub fn stop_all(&self) -> usize {
        let ids = self.session_ids();
        ids.iter().for_each(|id| self.stop(id));
        ids.len()
    }

    /// Each running session's agent pid, by session id; sessions sharing an
    /// agent each list its pid.
    pub fn root_pids(&self) -> Vec<(String, u32)> {
        let mut roots: Vec<(String, u32)> = self
            .routes
            .lock()
            .map(|routes| {
                routes
                    .sessions
                    .iter()
                    .filter_map(|(id, entry)| Some((id.clone(), entry.connection.pid()?)))
                    .collect()
            })
            .unwrap_or_default();
        roots.sort();
        roots
    }

    /// The folder of every open session, one entry per session.
    pub fn session_folders(&self) -> Vec<PathBuf> {
        // Read even a poisoned map: answering "none" could switch a branch under a live agent.
        let routes = self
            .routes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        routes
            .sessions
            .values()
            .map(|entry| entry.cwd.clone())
            .collect()
    }

    /// True while a session's agent was started from a program under `dir`,
    /// or with a `PATH` entry under it (a prerequisite, Zorvo's uv or Node),
    /// so its files must not be deleted yet.
    pub fn is_running_under(&self, dir: &Path) -> bool {
        // Read even a poisoned map: answering "not running" could delete a live agent.
        let routes = self
            .routes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        routes.sessions.values().any(|entry| {
            let connection = &entry.connection;
            Path::new(connection.program()).starts_with(dir)
                || connection
                    .path_entries()
                    .iter()
                    .any(|path| Path::new(path).starts_with(dir))
        })
    }

    /// Forgets the session and answers its open elicitations `cancel`; kills
    /// the agent once no other session uses it.
    pub fn stop(&self, app_session_id: &str) {
        self.detach(app_session_id).end();
    }

    /// The first half of `stop`: takes the session off the routes at once, so
    /// a session started under the same id from now on is a new one, and
    /// returns what is left to end it. The orphan sweep detaches the sessions
    /// it lists while it lists them, and ends them later, off the main thread.
    pub fn detach(&self, app_session_id: &str) -> DetachedSession {
        let Ok(mut routes) = self.routes.lock() else {
            return DetachedSession::default();
        };
        let requests = routes.elicitations.take_session(app_session_id);
        // A session stopped while it opens: later requests are cancelled.
        routes
            .opening
            .retain(|_, opening| opening != app_session_id);
        let entry = routes.sessions.remove(app_session_id);
        // Also the route an answer made for a session still opening, not registered yet.
        routes
            .by_acp_id
            .retain(|_, routed| routed != app_session_id);
        // An import stopped while its replay streams: the rest goes nowhere.
        routes
            .replaying
            .retain(|_, routed| routed != app_session_id);
        let unused = entry.filter(|entry| {
            !routes
                .sessions
                .values()
                .any(|e| e.connection_key == entry.connection_key)
        });
        DetachedSession {
            requests,
            connection: unused.map(|entry| entry.connection),
        }
    }

    fn register(
        &self,
        app_session_id: &str,
        connection: Arc<AcpConnection>,
        key: u64,
        started: &StartedSession,
        traits: EntryTraits,
        cwd: &str,
    ) {
        if let Ok(mut routes) = self.routes.lock() {
            routes.by_acp_id.insert(
                (key, started.acp_session_id.clone()),
                app_session_id.to_string(),
            );
            routes.sessions.insert(
                app_session_id.to_string(),
                SessionEntry {
                    connection,
                    connection_key: key,
                    acp_session_id: started.acp_session_id.clone(),
                    agent_capabilities: started.agent_capabilities.clone(),
                    auth_methods: traits.auth_methods,
                    cwd: PathBuf::from(cwd),
                    private: traits.private,
                },
            );
        }
    }

    fn with_entry<T>(
        &self,
        app_session_id: &str,
        f: impl FnOnce(&SessionEntry) -> T,
    ) -> Result<T, String> {
        let routes = self
            .routes
            .lock()
            .map_err(|_| "Session lock poisoned".to_string())?;
        routes
            .sessions
            .get(app_session_id)
            .map(f)
            .ok_or_else(|| format!("Session '{}' not found", app_session_id))
    }

    fn connection_for(&self, app_session_id: &str) -> Result<(Arc<AcpConnection>, String), String> {
        self.with_entry(app_session_id, |e| {
            (Arc::clone(&e.connection), e.acp_session_id.clone())
        })
    }

    /// Routes the session an answer opens (`acp_session_id`, else the
    /// answer's `sessionId`) as the answer arrives, on the reader thread: an
    /// agent may ask about its new session in its very next message, before
    /// [`register`](Self::register) runs. For a session being opened
    /// (`while_opening`), nothing is routed once it was stopped meanwhile.
    /// `clears_replay` ends the replay route an import's load started, in the
    /// same lock, so no update is routed to the replay after the answer.
    fn route_on_answer(
        &self,
        connection_key: u64,
        app_session_id: &str,
        acp_session_id: Option<&str>,
        while_opening: bool,
        clears_replay: bool,
    ) -> impl FnOnce(&Value) + Send + 'static {
        let routes = Arc::clone(&self.routes);
        let app_session_id = app_session_id.to_string();
        let known = acp_session_id.map(str::to_string);
        move |answer| {
            let Some(acp_id) = known.or_else(|| answer["sessionId"].as_str().map(str::to_string))
            else {
                return;
            };
            if let Ok(mut routes) = routes.lock() {
                let key = (connection_key, acp_id.clone());
                if clears_replay {
                    routes.replaying.remove(&key);
                }
                let stopped =
                    while_opening && routes.opening.get(&connection_key) != Some(&app_session_id);
                if !stopped {
                    routes.by_acp_id.insert(key, app_session_id);
                }
            }
        }
    }

    /// Routes one connection's events to the app sessions it hosts.
    fn connection_sink(&self, connection_key: u64, connection: Weak<AcpConnection>) -> EventSink {
        let routes = Arc::clone(&self.routes);
        let sink = Arc::clone(&self.sink);
        Arc::new(move |event| route_event(&routes, &sink, &connection, connection_key, event))
    }
}

/// Opens a session; an "authentication required" answer becomes an error
/// carrying [`AUTH_REQUIRED_PREFIX`] and the agent's auth methods. A
/// successful answer also goes to `on_answer`, on the reader thread.
/// `private` is whether the launch is a Zorvo Private one (see [`agent_error`]).
pub(super) fn open_request(
    connection: &AcpConnection,
    init: &Value,
    method: &str,
    params: Value,
    private: bool,
    on_answer: impl FnOnce(&Value) + Send + 'static,
) -> Result<Value, OpenError> {
    match connection
        .request_raw_with(method, params, HANDSHAKE_TIMEOUT, on_answer)
        .map_err(OpenError::Transport)?
    {
        Ok(result) => Ok(result),
        Err(error) => Err(OpenError::Agent(agent_error(method, init, &error, private))),
    }
}

/// The error a request the agent refused reads as: for a `private` launch
/// whose credits are used up or whose key was refused, `PRIVATE_CREDITS:`
/// (never a sign-in, since NEAR AI has none to offer); else the sign-in error
/// the UI parses when it is about signing in; else `<method> failed: <its message>`.
pub(super) fn agent_error(method: &str, init: &Value, error: &Value, private: bool) -> String {
    if let Some(credits) = private.then(|| private_credits_error(error)).flatten() {
        return credits;
    }
    let auth_methods = auth_methods_of(init);
    // Only a request that opens a session may be refused for want of a sign-in on its code alone.
    let may_need_sign_in = matches!(method, "session/new" | "session/load" | "session/resume");
    if is_auth_required(error, may_need_sign_in && offers_sign_in(&auth_methods)) {
        auth_required_error(&auth_methods)
    } else {
        format!("{} failed: {}", method, error_message(error))
    }
}

/// Whether `method_id` is a `type: "terminal"` method, which only a terminal can run.
fn is_terminal_method(init: &Value, method_id: &str) -> bool {
    // Refused or not, a method found here is one only a terminal can run.
    !matches!(
        terminal_method(init, method_id),
        Err(TerminalMethodError::NotOffered)
    )
}

/// The sign-in methods `initialize` reported, always as a JSON array.
pub(super) fn auth_methods_of(init: &Value) -> Value {
    match &init["authMethods"] {
        Value::Array(methods) => Value::Array(methods.clone()),
        _ => Value::Array(Vec::new()),
    }
}

/// The error the UI reads as "sign in first": [`AUTH_REQUIRED_PREFIX`] and the methods.
pub(super) fn auth_required_error(auth_methods: &Value) -> String {
    format!("{}{}", AUTH_REQUIRED_PREFIX, auth_methods)
}

/// Ends a connection that failed to open and says why. A transport failure
/// gets the agent's stderr tail; an agent's own answer (sign-in JSON
/// included, which the UI parses) is kept as it is.
pub(super) fn failure_message(connection: &AcpConnection, error: OpenError) -> String {
    let stderr = connection.stderr_tail();
    connection.kill();
    match error {
        OpenError::Agent(message) => message,
        OpenError::Transport(message) if stderr.is_empty() => message,
        OpenError::Transport(message) => format!("{}\n{}", message, stderr),
    }
}

/// Spawns an agent that hosts no app session (a sign-in or a probe). Its
/// requests are refused here (an elicitation is cancelled), so the agent
/// never waits on us; its notifications go to `on_notification`.
pub(super) fn spawn_unrouted(
    cwd: &str,
    launch: &AcpLaunch,
    on_notification: impl Fn(&str, &Value) + Send + Sync + 'static,
) -> Result<Arc<AcpConnection>, String> {
    AcpConnection::spawn(
        &launch.program,
        &launch.args,
        cwd,
        &launch.env,
        |connection| -> EventSink {
            Arc::new(move |event| match event {
                ConnectionEvent::Request { id, method, .. } if method == "elicitation/create" => {
                    elicitation_routes::cancel_request(&connection, id)
                }
                ConnectionEvent::Request { id, .. } => answer(&connection, move |c| {
                    c.respond_error(&id, METHOD_NOT_FOUND, "Not available here")
                }),
                ConnectionEvent::Notification { method, params } => {
                    on_notification(&method, &params)
                }
                ConnectionEvent::Exited { .. } => {}
            })
        },
    )
}

/// Initializes ACP and returns the agent's answer: capabilities and auth methods.
pub(super) fn initialize(connection: &AcpConnection) -> Result<Value, String> {
    connection.request(
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false, "auth": { "terminal": true }, "elicitation": { "form": {}, "url": {} } },
            "clientInfo": { "name": "zorvo", "version": env!("CARGO_PKG_VERSION") },
        }),
        HANDSHAKE_TIMEOUT,
    )
}

fn started_session(response: Value, agent_capabilities: Value) -> Result<StartedSession, String> {
    let acp_session_id = response["sessionId"]
        .as_str()
        .ok_or("The agent did not return a session id")?
        .to_string();
    Ok(StartedSession {
        acp_session_id,
        agent_capabilities,
        modes: response["modes"].clone(),
        models: response["models"].clone(),
        config_options: response["configOptions"].clone(),
        reopened_with: None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn credits_error() -> Value {
        json!({ "code": -32603, "message": "Internal error",
                "data": { "details": "402 api_key_limit_exceeded" } })
    }

    fn init_with_methods() -> Value {
        json!({ "authMethods": [{ "id": "browser", "name": "Browser" }] })
    }

    #[test]
    fn a_private_launch_reports_a_credit_refusal_of_a_session_request_as_private_credits() {
        for method in ["session/new", "session/load", "session/resume"] {
            let message = agent_error(method, &init_with_methods(), &credits_error(), true);

            assert_eq!(
                message, "PRIVATE_CREDITS:{\"reason\":\"empty\"}",
                "{method}"
            );
        }
    }

    #[test]
    fn a_private_launch_reports_a_refused_key_as_the_key_reason() {
        let error = json!({ "code": -32603, "message": "Internal error",
                            "data": { "details": "401 Invalid or expired API key" } });

        let message = agent_error("session/new", &init_with_methods(), &error, true);

        assert_eq!(message, "PRIVATE_CREDITS:{\"reason\":\"key\"}");
    }

    /// An agent with no sign-in methods: since main's `-32603` rule, "api_key" in the
    /// details reads as a sign-in for an agent that offers methods, whatever the launch.
    #[test]
    fn an_ordinary_launch_keeps_the_agents_error_text() {
        let message = agent_error("session/new", &json!({}), &credits_error(), false);

        assert_eq!(
            message,
            "session/new failed: Internal error (402 api_key_limit_exceeded)"
        );
    }

    #[test]
    fn a_private_launch_keeps_the_old_rules_for_other_errors() {
        let sign_in = json!({ "code": -32000, "message": "Authentication required" });
        let plain = json!({ "code": -32603, "message": "Internal error" });

        let needs_sign_in = agent_error("session/new", &init_with_methods(), &sign_in, true);
        let failed = agent_error("session/new", &init_with_methods(), &plain, true);

        assert!(
            needs_sign_in.starts_with(AUTH_REQUIRED_PREFIX),
            "{needs_sign_in}"
        );
        assert_eq!(failed, "session/new failed: Internal error");
    }

    #[test]
    fn debug_of_a_launch_shows_env_names_only_never_values() {
        let launch = AcpLaunch {
            program: "npx".to_string(),
            args: vec!["--acp".to_string()],
            env: vec![
                ("OPENAI_API_KEY".to_string(), "sk-secret".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string()),
            ],
            private: true,
        };

        let text = format!("{launch:?} {launch:#?}");

        assert!(!text.contains("sk-secret"), "{text}");
        assert!(!text.contains("/usr/bin"), "{text}");
        assert!(text.contains("OPENAI_API_KEY"), "{text}");
        assert!(text.contains("npx") && text.contains("--acp"), "{text}");
        assert!(text.contains("private: true"), "{text}");
    }

    #[test]
    fn a_credit_refusal_that_arrives_as_32000_is_not_a_sign_in_for_a_private_launch() {
        let error = json!({ "code": -32000, "message": "402 api_key_limit_exceeded" });

        let message = agent_error("session/new", &init_with_methods(), &error, true);

        assert_eq!(message, "PRIVATE_CREDITS:{\"reason\":\"empty\"}");
    }
}
