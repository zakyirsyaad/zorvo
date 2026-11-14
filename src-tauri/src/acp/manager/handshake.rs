//! The free functions around opening a connection: the `initialize`
//! handshake, the request that opens a session and how its refusal reads, and
//! the small helpers over `initialize`'s answer.

use std::sync::Arc;

use serde_json::{json, Value};

use super::elicitation_routes;
use super::private_errors::private_credits_error;
use super::routing::answer;
use super::sign_in::{is_auth_required, offers_sign_in};
use super::{
    AcpLaunch, OpenError, StartedSession, AUTH_REQUIRED_PREFIX, HANDSHAKE_TIMEOUT,
    METHOD_NOT_FOUND, PROTOCOL_VERSION,
};
use crate::acp::connection::{error_message, AcpConnection, ConnectionEvent, EventSink};
use crate::acp::terminal_auth::{terminal_method, TerminalMethodError};

/// Opens a session for `launch`; an "authentication required" answer becomes
/// an error carrying [`AUTH_REQUIRED_PREFIX`] and the agent's auth methods,
/// and a Zorvo Private launch's credit or key refusal a `PRIVATE_CREDITS:` one
/// (see [`agent_error`]). A successful answer also goes to `on_answer`, on the
/// reader thread.
pub(in crate::acp) fn open_request(
    connection: &AcpConnection,
    init: &Value,
    method: &str,
    params: Value,
    launch: &AcpLaunch,
    on_answer: impl FnOnce(&Value) + Send + 'static,
) -> Result<Value, OpenError> {
    match connection
        .request_raw_with(method, params, HANDSHAKE_TIMEOUT, on_answer)
        .map_err(OpenError::Transport)?
    {
        Ok(result) => Ok(result),
        Err(error) => Err(OpenError::Agent(agent_error(
            method,
            init,
            &error,
            launch.private,
        ))),
    }
}

/// The error a request the agent refused reads as: for a `private` launch
/// whose credits are used up or whose key was refused, `PRIVATE_CREDITS:`
/// (never a sign-in, since NEAR AI has none to offer); else the sign-in error
/// the UI parses when it is about signing in; else `<method> failed: <its message>`.
pub(in crate::acp) fn agent_error(
    method: &str,
    init: &Value,
    error: &Value,
    private: bool,
) -> String {
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
pub(super) fn is_terminal_method(init: &Value, method_id: &str) -> bool {
    // Refused or not, a method found here is one only a terminal can run.
    !matches!(
        terminal_method(init, method_id),
        Err(TerminalMethodError::NotOffered)
    )
}

/// The sign-in methods `initialize` reported, always as a JSON array.
pub(in crate::acp) fn auth_methods_of(init: &Value) -> Value {
    match &init["authMethods"] {
        Value::Array(methods) => Value::Array(methods.clone()),
        _ => Value::Array(Vec::new()),
    }
}

/// The error the UI reads as "sign in first": [`AUTH_REQUIRED_PREFIX`] and the methods.
pub(in crate::acp) fn auth_required_error(auth_methods: &Value) -> String {
    format!("{}{}", AUTH_REQUIRED_PREFIX, auth_methods)
}

/// Ends a connection that failed to open and says why. A transport failure
/// gets the agent's stderr tail; an agent's own answer (sign-in JSON
/// included, which the UI parses) is kept as it is.
pub(in crate::acp) fn failure_message(connection: &AcpConnection, error: OpenError) -> String {
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
pub(in crate::acp) fn spawn_unrouted(
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
pub(in crate::acp) fn initialize(connection: &AcpConnection) -> Result<Value, String> {
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

pub(super) fn started_session(
    response: Value,
    agent_capabilities: Value,
) -> Result<StartedSession, String> {
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
        tools_path: None,
    })
}
