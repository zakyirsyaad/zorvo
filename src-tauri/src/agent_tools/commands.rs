//! Tauri commands for Zorvo's agent tools, and the helpers the session
//! commands use to hand a session its MCP server list.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use super::AgentTools;
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
