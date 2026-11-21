//! Tauri commands for Zorvo's agent tools, and the helpers the session
//! commands use to hand a session its MCP server list.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use super::path::{path_for, ToolsPath};
use super::socket::{Capabilities, ToolsRole};
use super::AgentTools;
use crate::acp::manager::AcpLaunch;
use crate::store::{AppStore, PersistedState};

/// The `mcpServers` for a session that is about to open: `[]` unless the
/// webview asked for tools (`agent_tools`) and the saved setting is on. Only
/// reads the state file when the webview asked.
pub fn servers_for_session(
    tools: &AgentTools,
    store: &AppStore,
    session_id: &str,
    agent_tools: bool,
) -> Result<SessionTools, String> {
    let none = SessionTools {
        servers: Value::Array(Vec::new()),
        env: Vec::new(),
        path: None,
        agent_tools: false,
    };
    if !agent_tools {
        return Ok(none);
    }
    let capabilities = capabilities_of(store, ToolsPath::Mcp)?;
    let servers = tools.servers_with(session_id, capabilities);
    let path = path_of_servers(&servers);
    Ok(SessionTools {
        agent_tools: path.is_some() && capabilities.agent_tools,
        servers,
        path,
        ..none
    })
}

/// What the saved settings give a session on `path`: Zorvo's agent tools,
/// computer use (macOS only), or neither.
fn capabilities_of(store: &AppStore, path: ToolsPath) -> Result<Capabilities, String> {
    Ok(capabilities_from(&store.load_state()?, path))
}

/// What the session gets: a worker's when `worker_tools` says so or the stored
/// session has an open worker link, else the settings'. `None` when a worker
/// is wanted but the Agent tools setting is off: it gets nothing.
///
/// The stored link keeps the role when the webview omits the flag on a reopen.
/// This guards against that omission, not against a hostile webview.
fn session_capabilities(
    state: &PersistedState,
    session_id: &str,
    path: ToolsPath,
    worker_tools: bool,
) -> Option<Capabilities> {
    let capabilities = capabilities_from(state, path);
    if !(worker_tools || is_open_worker(state, session_id)) {
        return Some(capabilities);
    }
    capabilities.agent_tools.then(|| Capabilities::worker(path))
}

fn capabilities_from(state: &PersistedState, path: ToolsPath) -> Capabilities {
    Capabilities {
        agent_tools: state.settings.agent_tools,
        computer_use: state.settings.computer_use && cfg!(target_os = "macos"),
        path,
        role: ToolsRole::Coordinator,
    }
}

/// Whether the stored session is a worker with an open link to its coordinator.
fn is_open_worker(state: &PersistedState, session_id: &str) -> bool {
    state
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .and_then(|session| session.delegated_from.as_ref())
        .is_some_and(|link| link.ended_at.is_none())
}

/// What a session that is about to open gets of Zorvo's tools.
#[derive(Debug, Clone)]
pub struct SessionTools {
    /// The `mcpServers` to send: Zorvo's entry on the MCP path, else `[]`.
    pub servers: Value,
    /// Variables for the agent's launch environment: set on the command path only.
    pub env: Vec<(String, String)>,
    /// Which path the session got; `None` when it gets no tools.
    pub path: Option<ToolsPath>,
    /// It gets Zorvo's agent tools, not only computer use.
    pub agent_tools: bool,
}

/// Decides what the session `session_id` of agent `profile_id` gets: nothing
/// unless the webview asked for tools (`agent_tools`) and the saved setting is
/// on; then an `mcpServers` entry, or, for an agent that ignores `mcpServers`,
/// the socket in its environment. Never both. Only reads the state file when
/// the webview asked.
///
/// `worker_tools` makes the session a worker, which sees `done` only. It
/// changes nothing unless `agent_tools` is also true, and a worker needs the
/// saved Agent tools setting on: with it off the session gets nothing, not
/// even computer use, since a worker's token never carries that.
pub fn tools_for_session(
    tools: &AgentTools,
    store: &AppStore,
    session_id: &str,
    profile_id: &str,
    agent_tools: bool,
    worker_tools: bool,
) -> Result<SessionTools, String> {
    let none = SessionTools {
        servers: Value::Array(Vec::new()),
        env: Vec::new(),
        path: None,
        agent_tools: false,
    };
    if !agent_tools {
        return Ok(none);
    }
    let path = path_for(profile_id);
    let state = store.load_state()?;
    let Some(capabilities) = session_capabilities(&state, session_id, path, worker_tools) else {
        return Ok(none);
    };
    if !capabilities.any() {
        return Ok(none);
    }
    tools.note_profile(session_id, profile_id);
    Ok(match path {
        ToolsPath::Mcp => {
            let servers = tools.servers_with(session_id, capabilities);
            let path = has_entries(&servers).then_some(ToolsPath::Mcp);
            SessionTools {
                servers,
                agent_tools: path.is_some() && capabilities.agent_tools,
                path,
                ..none
            }
        }
        ToolsPath::Command => {
            let env = tools.launch_env_with(session_id, capabilities);
            let path = (!env.is_empty()).then_some(ToolsPath::Command);
            SessionTools {
                env,
                agent_tools: path.is_some() && capabilities.agent_tools,
                path,
                ..none
            }
        }
    })
}

fn has_entries(servers: &Value) -> bool {
    servers.as_array().is_some_and(|list| !list.is_empty())
}

/// The path a session opened with `servers` got: a fork cannot be given an
/// environment, so it is on the MCP path or has no tools.
pub fn path_of_servers(servers: &Value) -> Option<ToolsPath> {
    has_entries(servers).then_some(ToolsPath::Mcp)
}

/// `launch` with `env` put last in its environment, and any earlier entry of
/// the same name removed, so nothing the registry entry carries can stand in
/// for Zorvo's socket, token or program.
pub fn with_tools_env(launch: AcpLaunch, env: &[(String, String)]) -> AcpLaunch {
    if env.is_empty() {
        return launch;
    }
    let kept = launch
        .env
        .into_iter()
        .filter(|(name, _)| !env.iter().any(|(ours, _)| ours == name));
    AcpLaunch {
        env: kept.chain(env.iter().cloned()).collect(),
        ..launch
    }
}

/// Passes `opened` through; a session that did not open forgets the token it
/// was issued.
pub fn forget_if_failed<T>(
    tools: &AgentTools,
    session_id: &str,
    opened: Result<T, String>,
) -> Result<T, String> {
    if opened.is_err() {
        tools.forget(session_id);
    }
    opened
}

/// The webview's answer to a tool call it received as `agent-tool-call`.
#[tauri::command(async)]
pub fn agent_tool_respond(
    tools: State<'_, Arc<AgentTools>>,
    call_id: String,
    ok: bool,
    text: String,
) {
    tools.respond(&call_id, ok, &text);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{DelegationLinkRecord, SessionRecord};

    fn state(computer_use: bool, sessions: Vec<SessionRecord>) -> PersistedState {
        let mut state = PersistedState::default();
        state.settings.agent_tools = true;
        state.settings.computer_use = computer_use;
        state.sessions = sessions;
        state
    }

    fn linked(id: &str, ended_at: Option<i64>) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            delegated_from: Some(DelegationLinkRecord {
                session_id: "boss".to_string(),
                ended_at,
                ..DelegationLinkRecord::default()
            }),
            ..SessionRecord::default()
        }
    }

    fn role(state: &PersistedState, id: &str, flag: bool) -> ToolsRole {
        session_capabilities(state, id, ToolsPath::Mcp, flag)
            .expect("capabilities")
            .role
    }

    #[test]
    fn an_open_worker_link_keeps_the_role_without_the_flag() {
        let state = state(
            false,
            vec![
                linked("open", None),
                linked("ended", Some(9)),
                SessionRecord {
                    id: "plain".to_string(),
                    ..SessionRecord::default()
                },
            ],
        );
        assert_eq!(role(&state, "open", false), ToolsRole::Worker);
        assert_eq!(role(&state, "ended", false), ToolsRole::Coordinator);
        assert_eq!(role(&state, "plain", false), ToolsRole::Coordinator);
        assert_eq!(role(&state, "missing", false), ToolsRole::Coordinator);
        assert_eq!(role(&state, "missing", true), ToolsRole::Worker);
        assert_eq!(role(&state, "ended", true), ToolsRole::Worker);
    }

    #[test]
    fn a_worker_never_carries_computer_use_and_needs_the_setting() {
        let on = state(true, vec![linked("open", None)]);
        let worker = session_capabilities(&on, "open", ToolsPath::Mcp, true).unwrap();
        assert!(worker.agent_tools);
        assert!(!worker.computer_use);
        let coordinator = session_capabilities(&on, "other", ToolsPath::Mcp, false).unwrap();
        assert_eq!(coordinator.computer_use, cfg!(target_os = "macos"));

        let mut off = state(true, vec![linked("open", None)]);
        off.settings.agent_tools = false;
        assert_eq!(
            session_capabilities(&off, "open", ToolsPath::Mcp, false),
            None
        );
        assert_eq!(session_capabilities(&off, "x", ToolsPath::Mcp, true), None);
    }
}
