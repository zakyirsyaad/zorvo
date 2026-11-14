//! Tauri commands for Zorvo's agent tools, and the helpers the session
//! commands use to hand a session its MCP server list.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use super::path::{path_for, ToolsPath};
use super::AgentTools;
use crate::acp::manager::AcpLaunch;
use crate::store::AppStore;

/// The `mcpServers` for a session that is about to open: `[]` unless the
/// webview asked for tools (`agent_tools`) and the saved setting is on. Only
/// reads the state file when the webview asked.
pub fn servers_for_session(
    tools: &AgentTools,
    store: &AppStore,
    session_id: &str,
    agent_tools: bool,
) -> Result<Value, String> {
    let enabled = agent_tools && store.load_state()?.settings.agent_tools;
    Ok(tools.servers_for(session_id, enabled))
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
}

/// Decides what the session `session_id` of agent `profile_id` gets: nothing
/// unless the webview asked for tools (`agent_tools`) and the saved setting is
/// on; then an `mcpServers` entry, or, for an agent that ignores `mcpServers`,
/// the socket in its environment. Never both. Only reads the state file when
/// the webview asked.
pub fn tools_for_session(
    tools: &AgentTools,
    store: &AppStore,
    session_id: &str,
    profile_id: &str,
    agent_tools: bool,
) -> Result<SessionTools, String> {
    let none = SessionTools {
        servers: Value::Array(Vec::new()),
        env: Vec::new(),
        path: None,
    };
    if !agent_tools || !store.load_state()?.settings.agent_tools {
        return Ok(none);
    }
    Ok(match path_for(profile_id) {
        ToolsPath::Mcp => {
            let servers = tools.servers_for(session_id, true);
            let path = has_entries(&servers).then_some(ToolsPath::Mcp);
            SessionTools {
                servers,
                path,
                ..none
            }
        }
        ToolsPath::Command => {
            let env = tools.launch_env_for(session_id, true);
            let path = (!env.is_empty()).then_some(ToolsPath::Command);
            SessionTools { env, path, ..none }
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
