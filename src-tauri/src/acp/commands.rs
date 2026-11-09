//! Tauri commands and the event bridge for ACP sessions.
//!
//! The webview names a profile; the backend decides which program runs, from
//! the detected profile, with the user's login-shell environment.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::State;

use super::manager::{AcpEvent, AcpLaunch, AcpManager, ReopenPurpose, StartedSession};
use super::private_sessions::{note_if_private, open_session, without_private};
use super::probe::{ProbedAgent, SignInProbe};
use super::qwen_log::{self, QwenApiError};
use super::session_list::ListedSessions;
use super::terminal_auth::{is_sign_in_terminal_id, CANCELLED_MESSAGE};
use crate::env_resolver::cached_user_env;
use crate::files::ensure_known_workspace;
use crate::installer::commands::versions_in_use;
use crate::private_mode::launch::{ensure_qwen, offered_model, private_launch};
use crate::private_mode::service::PrivateMode;
use crate::private_mode::{PrivateError, PRIVATE_CREDITS_PREFIX};
use crate::profiles::{agent_profile_from, with_system_tools, AgentProfile};
use crate::pty_session::PtySessionManager;
use crate::registry::{
    self,
    resolve::{canonical_agent_id, missing_reason, SystemTools},
};
use crate::store::AppStore;

/// The single event channel the UI listens on for every ACP session.
pub const ACP_EVENT: &str = "acp-event";

/// The JSON the UI receives for one manager event.
pub fn event_payload(event: &AcpEvent) -> Value {
    match event {
        AcpEvent::Update { session_id, update } => {
            json!({ "sessionId": session_id, "kind": "update", "update": update })
        }
        AcpEvent::PermissionRequest {
            session_id,
            request_id,
            params,
        } => json!({
            "sessionId": session_id,
            "kind": "permission",
            "requestId": request_id,
            "toolCall": params["toolCall"],
            "options": params["options"],
        }),
        AcpEvent::TurnEnded {
            session_id,
            stop_reason,
        } => match stop_reason {
            Ok(reason) => {
                json!({ "sessionId": session_id, "kind": "turn-end", "stopReason": reason })
            }
            Err(error) => json!({ "sessionId": session_id, "kind": "turn-end", "error": error }),
        },
        AcpEvent::Exited { session_id, code } => {
            json!({ "sessionId": session_id, "kind": "exit", "code": code })
        }
        AcpEvent::Elicitation {
            session_id,
            key,
            view,
        } => json!({ "sessionId": session_id, "kind": "elicitation", "key": key, "request": view }),
        AcpEvent::ElicitationComplete { session_id, key } => {
            json!({ "sessionId": session_id, "kind": "elicitation-complete", "key": key })
        }
    }
}

/// Resolves how to launch an installed ACP agent for `profile_id` (a legacy
/// id is mapped first), at the version in `versions` when the catalog has it.
fn launch_for(profile_id: &str, versions: &BTreeMap<String, String>) -> Result<AcpLaunch, String> {
    launch_of(resolved_profile(profile_id, versions)?)
}

/// The profile `profile_id` launches from, at `versions`, on this Mac now.
fn resolved_profile(
    profile_id: &str,
    versions: &BTreeMap<String, String>,
) -> Result<AgentProfile, String> {
    with_system_tools(|catalog, tools| {
        profile_to_launch(catalog, tools, profile_id, versions, registry::unix_now())
    })
}

/// How to launch `profile` with the user's environment and the registry's variables.
fn launch_of(profile: AgentProfile) -> Result<AcpLaunch, String> {
    // A GUI app does not inherit the login shell's PATH, so hand the agent the
    // user's real environment (nvm, Homebrew, ...).
    let user_env = || {
        cached_user_env()
            .map(|m| m.into_iter().collect())
            .unwrap_or_default()
    };
    // Stands in for the login shell's PATH when that could not be read.
    let process_path = std::env::var("PATH").ok();
    launch_from(profile, user_env, process_path.as_deref(), |id, version| {
        registry::catalog().launch_env(id, version)
    })
}

/// The profile that launches `profile_id` (a legacy id is mapped first) from
/// `catalog` and `tools` at time `now`.
fn profile_to_launch(
    catalog: &registry::Catalog,
    tools: &SystemTools,
    profile_id: &str,
    versions: &BTreeMap<String, String>,
    now: u64,
) -> Result<AgentProfile, String> {
    let id = canonical_agent_id(profile_id);
    agent_profile_from(catalog, tools, id, versions, now).ok_or_else(|| {
        match catalog.unsupported_agent_name(id, versions, now) {
            Some(name) => format!("{name} is not available for this Mac"),
            None => format!("Unknown agent profile '{profile_id}'"),
        }
    })
}

/// How to launch `profile` over ACP, or why it cannot run. The agent gets
/// `user_env` with the profile's dirs around its `PATH` (`process_path` when
/// `user_env` has none), and then the variables `registry_env` gives for its
/// id and version; both are read only once the profile can run.
fn launch_from(
    profile: AgentProfile,
    user_env: impl FnOnce() -> BTreeMap<String, String>,
    process_path: Option<&str>,
    registry_env: impl FnOnce(&str, &str) -> BTreeMap<String, String>,
) -> Result<AcpLaunch, String> {
    if let Some(reason) = missing_reason(&profile) {
        return Err(reason);
    }
    if !profile.detected {
        return Err(format!("{} is not installed", profile.name));
    }
    let program = profile
        .acp_program_path
        .ok_or_else(|| format!("Could not locate the program that runs {}", profile.name))?;
    let mut env = user_env();
    // Zorvo's runtime and prerequisite dirs go around the user's PATH. Without
    // the login shell's env, the process PATH stands in (as in
    // `agent_profiles`) rather than leave the agent only Zorvo's dirs.
    if let Some(path) = agent_path(
        &profile.acp_path_prepend,
        env.get("PATH").map(String::as_str),
        process_path,
        &profile.acp_path_append,
    ) {
        env.insert("PATH".to_string(), path);
    }
    if let Some(version) = &profile.version {
        env.extend(registry_env(&profile.id, version));
    }
    Ok(AcpLaunch {
        program,
        args: profile.acp_args,
        env: env.into_iter().collect(),
        private: false,
        mcp_servers: Vec::new(),
    })
}

/// `prepend`, the user's `PATH` entries, then `append`, joined with `:`;
/// `None` when there is nothing to add, so the user's `PATH` is left alone.
/// Without the login shell's `PATH` the process `PATH` stands in (as in
/// `agent_profiles`), so the agent still finds `git` and `sh`.
fn agent_path(
    prepend: &[String],
    login_path: Option<&str>,
    process_path: Option<&str>,
    append: &[String],
) -> Option<String> {
    if prepend.is_empty() && append.is_empty() {
        return None;
    }
    let user_entries = login_path
        .or(process_path)
        .unwrap_or_default()
        .split(':')
        .filter(|entry| !entry.is_empty());
    let entries: Vec<&str> = prepend
        .iter()
        .map(String::as_str)
        .chain(user_entries)
        .chain(append.iter().map(String::as_str))
        .collect();
    Some(entries.join(":"))
}

/// [`launch_for`] at the versions the user has in use.
fn launch_with_store(store: &AppStore, profile_id: &str) -> Result<AcpLaunch, String> {
    launch_for(profile_id, &versions_in_use(store))
}

/// [`launch_with_store`] for an agent that runs in `cwd`, which must be one of
/// the user's workspaces: a folder they opened, a session's folder or a
/// session worktree (remembered when it is made).
fn launch_in_workspace(store: &AppStore, cwd: &str, profile_id: &str) -> Result<AcpLaunch, String> {
    ensure_known_workspace(cwd, |path| store.is_known_workspace(path))?;
    launch_with_store(store, profile_id)
}

/// What a private launch reports when there is no key to run on: the same
/// error text the agent process gives when credits run out.
fn credits_empty_error() -> String {
    format!("{PRIVATE_CREDITS_PREFIX}{}", json!({ "reason": "empty" }))
}

/// What an own-key launch reports when the key is no longer in the Keychain.
fn own_key_missing_error() -> String {
    format!("{PRIVATE_CREDITS_PREFIX}{}", json!({ "reason": "key" }))
}

/// The launch of a session: `base()` (today's [`launch_in_workspace`]) for
/// `None`, byte for byte. For `Some(model)` it is `base()` first (the workspace
/// and install checks), then a private Qwen Code launch on NEAR AI. Once a
/// private model is named, every failure is an error: this never falls back to a
/// plain launch, which would run the session on the user's own account.
fn session_launch(
    session_id: &str,
    base: impl FnOnce() -> Result<AcpLaunch, String>,
    private: &PrivateMode,
    profile_id: &str,
    private_model_id: Option<&str>,
    own_key: bool,
    session_cap: Option<u64>,
) -> Result<AcpLaunch, String> {
    let launch = base()?;
    let Some(model_id) = private_model_id else {
        return Ok(launch);
    };
    // Before anything is read or asked: another agent never sees a token.
    ensure_qwen(profile_id)?;
    let models = private.models_for_launch(own_key)?;
    if !offered_model(model_id, &models) {
        return Err(PrivateError::UnknownModel.into());
    }
    // A cap makes its own NEAR AI key; the key never reaches the agent, only the proxy.
    if !own_key {
        if let Some(credits) = session_cap {
            private.ensure_session_cap(session_id, credits)?;
        }
    }
    let issued = private
        .issue_proxy_token(session_id, model_id, own_key)
        .map_err(|error| match error {
            PrivateError::NoKey | PrivateError::NoDevice if own_key => own_key_missing_error(),
            PrivateError::NoKey | PrivateError::NoDevice => credits_empty_error(),
            other => other.into(),
        })?;
    let mcp_script = private.mcp_script();
    Ok(private_launch(
        launch,
        profile_id,
        model_id,
        &models,
        &issued,
        mcp_script.as_deref(),
    )?)
}

/// [`launch_in_workspace`] for a session that may be private.
#[allow(clippy::too_many_arguments)]
fn launch_for_session(
    store: &AppStore,
    private: &PrivateMode,
    session_id: &str,
    cwd: &str,
    profile_id: &str,
    private_model_id: Option<&str>,
    own_key: bool,
    session_cap: Option<u64>,
) -> Result<AcpLaunch, String> {
    session_launch(
        session_id,
        || launch_in_workspace(store, cwd, profile_id),
        private,
        profile_id,
        private_model_id,
        own_key,
        session_cap,
    )
}

/// The ACP launch of `profile_id` in `cwd`, and the same program without the registry entry's own
/// arguments (`setup_args`), which runs the agent's interactive setup. Both come from the registry
/// alone; `cwd` must be one of the user's workspaces.
fn setup_launches_in_workspace(
    store: &AppStore,
    cwd: &str,
    profile_id: &str,
) -> Result<(AcpLaunch, AcpLaunch), String> {
    ensure_known_workspace(cwd, |path| store.is_known_workspace(path))?;
    let profile = resolved_profile(profile_id, &versions_in_use(store))?;
    let setup = AgentProfile {
        acp_args: profile.setup_args.clone(),
        ..profile.clone()
    };
    Ok((launch_of(profile)?, launch_of(setup)?))
}

/// Starts app session `session_id`. A `private_model_id` makes it a Zorvo
/// Private session on that model (Qwen Code only); the key never leaves the
/// backend.
// A command's arguments are the names the webview sends, so they stay separate.
#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn acp_start_session(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    private: State<'_, PrivateMode>,
    session_id: String,
    cwd: String,
    profile_id: String,
    private_model_id: Option<String>,
    private_own_key: Option<bool>,
    private_session_cap: Option<u64>,
) -> Result<StartedSession, String> {
    let launch = launch_for_session(
        &store,
        &private,
        &session_id,
        &cwd,
        &profile_id,
        private_model_id.as_deref(),
        private_own_key.unwrap_or(false),
        private_session_cap,
    )?;
    note_if_private(
        &private,
        private_model_id.is_some(),
        manager.start(&session_id, &cwd, &launch),
    )
}

/// Learns what an agent offers (modes, models, efforts, commands) before a
/// session starts, or that it needs a sign-in first. `needs_options` is for an
/// agent whose options are not known yet; otherwise the sign-in is what is checked.
#[tauri::command(async)]
pub fn acp_probe_agent(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    profile_id: String,
    cwd: String,
    needs_options: bool,
) -> Result<ProbedAgent, String> {
    manager.probe(
        &cwd,
        &launch_in_workspace(&store, &cwd, &profile_id)?,
        needs_options,
    )
}

/// Learns whether someone is signed in to an agent without ever opening a
/// session in it, so it is safe to run on its own (when Settings → Agents opens).
/// An agent that cannot report its sign-in comes back with `reportsStatus` false.
#[tauri::command(async)]
pub fn acp_probe_sign_in(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    profile_id: String,
    cwd: String,
) -> Result<SignInProbe, String> {
    manager.probe_sign_in(&cwd, &launch_in_workspace(&store, &cwd, &profile_id)?)
}

/// Signs in to an agent with one of the auth methods it reported.
#[tauri::command(async)]
pub fn acp_authenticate(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    profile_id: String,
    cwd: String,
    method_id: String,
) -> Result<(), String> {
    manager.authenticate(
        &cwd,
        &launch_in_workspace(&store, &cwd, &profile_id)?,
        &method_id,
    )
}

/// Reopens the agent's earlier session `acp_session_id` as app session
/// `session_id`, with `session/resume` or `session/load`, whichever the agent
/// offers. A private session is reopened with its `private_model_id` again; a
/// plain reopen of an id recorded as private is refused (`private_session`).
// A command's arguments are the names the webview sends, so they stay separate.
#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn acp_reopen_session(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    private: State<'_, PrivateMode>,
    session_id: String,
    cwd: String,
    profile_id: String,
    acp_session_id: String,
    private_model_id: Option<String>,
    private_own_key: Option<bool>,
    private_session_cap: Option<u64>,
) -> Result<StartedSession, String> {
    open_session(
        &private,
        &acp_session_id,
        private_model_id.as_deref(),
        || {
            launch_for_session(
                &store,
                &private,
                &session_id,
                &cwd,
                &profile_id,
                private_model_id.as_deref(),
                private_own_key.unwrap_or(false),
                private_session_cap,
            )
        },
        |launch| {
            manager.reopen(
                &session_id,
                &cwd,
                launch,
                &acp_session_id,
                ReopenPurpose::Continue,
            )
        },
    )
}

/// Imports the agent's earlier session `acp_session_id` as app session
/// `session_id`, with `session/load` when the agent offers it, so the history
/// Zorvo does not have is replayed into the chat. An import is never private,
/// so an id recorded as private is refused (`private_session`).
#[tauri::command(async)]
pub fn acp_import_session(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    private: State<'_, PrivateMode>,
    session_id: String,
    cwd: String,
    profile_id: String,
    acp_session_id: String,
) -> Result<StartedSession, String> {
    open_session(
        &private,
        &acp_session_id,
        None,
        || launch_in_workspace(&store, &cwd, &profile_id),
        |launch| {
            manager.reopen(
                &session_id,
                &cwd,
                launch,
                &acp_session_id,
                ReopenPurpose::Import,
            )
        },
    )
}

/// Lists the agent's sessions in `cwd`, for the draft to offer them, without
/// the ones that ran privately (they are never imported).
#[tauri::command(async)]
pub fn acp_list_sessions(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    private: State<'_, PrivateMode>,
    profile_id: String,
    cwd: String,
) -> Result<ListedSessions, String> {
    let listed = manager.list_sessions(&cwd, &launch_in_workspace(&store, &cwd, &profile_id)?)?;
    Ok(without_private(listed, &private))
}

/// Forks `source_session_id` into `session_id` in `cwd`, which must be one of
/// the user's workspaces (the source's folder or worktree is).
fn fork_in_workspace(
    manager: &AcpManager,
    store: &AppStore,
    source_session_id: &str,
    session_id: &str,
    cwd: &str,
) -> Result<StartedSession, String> {
    ensure_known_workspace(cwd, |path| store.is_known_workspace(path))?;
    manager.fork(source_session_id, session_id, cwd)
}

/// A fork of a private session lives in its source's process, so it is private
/// too and is recorded as such.
#[tauri::command(async)]
pub fn acp_fork_session(
    manager: State<'_, AcpManager>,
    store: State<'_, AppStore>,
    private: State<'_, PrivateMode>,
    source_session_id: String,
    session_id: String,
    cwd: String,
) -> Result<StartedSession, String> {
    let source_is_private = manager.is_private_session(&source_session_id);
    let result = fork_in_workspace(&manager, &store, &source_session_id, &session_id, &cwd);
    if source_is_private && result.is_ok() {
        // The fork lives in the source's process: it must keep that process's token alive.
        private.share_proxy_token(&source_session_id, &session_id);
    }
    note_if_private(&private, source_is_private, result)
}

/// Runs the sign-in command of `profile_id`'s terminal method `method_id` in a
/// PTY named `terminal_id`, in `cwd`, which must be one of the user's workspaces.
fn start_terminal_sign_in(
    manager: &AcpManager,
    pty: &PtySessionManager,
    store: &AppStore,
    profile_id: &str,
    cwd: &str,
    method_id: &str,
    terminal_id: &str,
) -> Result<(), String> {
    if !is_sign_in_terminal_id(terminal_id) {
        return Err("Not a sign-in terminal id".to_string());
    }
    if pty.has_session(terminal_id) {
        return Err("That sign-in is already running".to_string());
    }
    let attempts = manager.sign_ins();
    attempts.begin(terminal_id)?;
    let result = launch_in_workspace(store, cwd, profile_id)
        .and_then(|launch| {
            manager.terminal_login_with(cwd, &launch, method_id, |connection| {
                attempts.track(terminal_id, connection)
            })
        })
        .and_then(|login| {
            if attempts.is_cancelled(terminal_id) {
                return Err(CANCELLED_MESSAGE.to_string());
            }
            pty.start_session(terminal_id, cwd, &login.program, &login.args, &login.env)
        });
    // Whatever went wrong, a sign-in the user cancelled reads as cancelled.
    let result = match result {
        Err(_) if attempts.is_cancelled(terminal_id) => Err(CANCELLED_MESSAGE.to_string()),
        other => other,
    };
    attempts.end(terminal_id);
    result
}

#[tauri::command(async)]
pub fn acp_start_terminal_sign_in(
    manager: State<'_, AcpManager>,
    pty: State<'_, PtySessionManager>,
    store: State<'_, AppStore>,
    profile_id: String,
    cwd: String,
    method_id: String,
    terminal_id: String,
) -> Result<(), String> {
    start_terminal_sign_in(
        &manager,
        &pty,
        &store,
        &profile_id,
        &cwd,
        &method_id,
        &terminal_id,
    )
}

/// Runs the agent's own interactive setup (Qwen Code: pick a provider) in a sign-in terminal, for
/// an agent whose `initialize` marks one. As [`start_terminal_sign_in`], but the UI names no
/// method: the program and its arguments come from the registry only.
fn start_agent_setup(
    manager: &AcpManager,
    pty: &PtySessionManager,
    store: &AppStore,
    profile_id: &str,
    cwd: &str,
    terminal_id: &str,
) -> Result<(), String> {
    if !is_sign_in_terminal_id(terminal_id) {
        return Err("Not a sign-in terminal id".to_string());
    }
    if pty.has_session(terminal_id) {
        return Err("That sign-in is already running".to_string());
    }
    let attempts = manager.sign_ins();
    attempts.begin(terminal_id)?;
    let result = setup_launches_in_workspace(store, cwd, profile_id)
        .and_then(|(launch, setup)| {
            manager.agent_setup_with(cwd, &launch, &setup, |connection| {
                attempts.track(terminal_id, connection)
            })
        })
        .and_then(|setup| {
            if attempts.is_cancelled(terminal_id) {
                return Err(CANCELLED_MESSAGE.to_string());
            }
            pty.start_session(terminal_id, cwd, &setup.program, &setup.args, &setup.env)
        });
    // Whatever went wrong, a setup the user cancelled reads as cancelled.
    let result = match result {
        Err(_) if attempts.is_cancelled(terminal_id) => Err(CANCELLED_MESSAGE.to_string()),
        other => other,
    };
    attempts.end(terminal_id);
    result
}

#[tauri::command(async)]
pub fn acp_start_agent_setup(
    manager: State<'_, AcpManager>,
    pty: State<'_, PtySessionManager>,
    store: State<'_, AppStore>,
    profile_id: String,
    cwd: String,
    terminal_id: String,
) -> Result<(), String> {
    start_agent_setup(&manager, &pty, &store, &profile_id, &cwd, &terminal_id)
}

/// Cancels a terminal sign-in that is still starting: the agent it reads the
/// method from is ended and no terminal starts. A running login is ended with
/// `terminate_session` instead.
#[tauri::command(async)]
pub fn acp_cancel_terminal_sign_in(manager: State<'_, AcpManager>, terminal_id: String) {
    manager.sign_ins().cancel(&terminal_id);
}

#[tauri::command(async)]
pub fn acp_prompt(
    manager: State<'_, AcpManager>,
    session_id: String,
    text: String,
    attachments: Option<Vec<String>>,
) -> Result<(), String> {
    manager.prompt(&session_id, &text, &attachments.unwrap_or_default())
}

/// Cancels the turn; returns the keys of the elicitations it answered `cancel`.
#[tauri::command(async)]
pub fn acp_cancel(
    manager: State<'_, AcpManager>,
    session_id: String,
) -> Result<Vec<String>, String> {
    manager.cancel(&session_id)
}

/// Answers a permission request with one of the agent's options (`None` cancels it).
/// `answers` is only for Qwen Code's `ask_user_question`: question number to answer,
/// checked in `permission_response` and never logged.
#[tauri::command(async)]
pub fn acp_respond_permission(
    manager: State<'_, AcpManager>,
    session_id: String,
    request_id: Value,
    option_id: Option<String>,
    answers: Option<BTreeMap<String, String>>,
) -> Result<(), String> {
    manager.respond_permission(
        &session_id,
        &request_id,
        option_id.as_deref(),
        answers.as_ref(),
    )
}

/// Answers an elicitation: `accept` (with the form's `content`), `decline` or `cancel`.
#[tauri::command(async)]
pub fn acp_respond_elicitation(
    manager: State<'_, AcpManager>,
    session_id: String,
    key: String,
    action: String,
    content: Option<Value>,
) -> Result<(), String> {
    manager.respond_elicitation(&session_id, &key, &action, content)
}

/// Opens the link of an accepted URL elicitation again.
#[tauri::command(async)]
pub fn acp_reopen_elicitation_url(
    manager: State<'_, AcpManager>,
    session_id: String,
    key: String,
) -> Result<(), String> {
    manager.reopen_elicitation_url(&session_id, &key)
}

#[tauri::command(async)]
pub fn acp_set_mode(
    manager: State<'_, AcpManager>,
    session_id: String,
    mode_id: String,
) -> Result<(), String> {
    manager.set_mode(&session_id, &mode_id)
}

#[tauri::command(async)]
pub fn acp_set_model(
    manager: State<'_, AcpManager>,
    session_id: String,
    model_id: String,
) -> Result<(), String> {
    manager.set_model(&session_id, &model_id)
}

#[tauri::command(async)]
pub fn acp_set_config_option(
    manager: State<'_, AcpManager>,
    session_id: String,
    config_id: String,
    value: String,
) -> Result<Value, String> {
    manager.set_config_option(&session_id, &config_id, &value)
}

/// The newest API error Qwen Code logged for the session since `since` (Unix
/// ms), read from Qwen's own log: it reports a failed request over ACP without
/// the error. `None` when the session is not running or the log has nothing.
#[tauri::command(async)]
pub fn acp_qwen_last_api_error(
    manager: State<'_, AcpManager>,
    session_id: String,
    since: Option<u64>,
) -> Option<QwenApiError> {
    let acp_session_id = manager.acp_session_id(&session_id)?;
    qwen_log::last_api_error(&acp_session_id, since.unwrap_or(0))
}

#[tauri::command(async)]
pub fn acp_stop_session(
    manager: State<'_, AcpManager>,
    private: State<'_, PrivateMode>,
    session_id: String,
) {
    private.release_proxy_token(&session_id);
    manager.stop(&session_id);
}

#[cfg(test)]
mod tests;
