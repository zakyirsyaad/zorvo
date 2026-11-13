//! Which way a session's agent reaches Zorvo's tools: as an MCP server it
//! starts itself, or as a command it runs in its shell.

use serde::Serialize;

/// Registry ids of agents that ignore ACP's `mcpServers`, so they get the
/// command path. ACP has no capability that says so (stdio MCP is mandatory),
/// so this is what a spike observed: on 2026-11-13 `pi-acp` 0.0.34 with pi
/// 1.5.2 never started the server it was given, and ran `zorvo tools` from
/// hidden context. An agent leaves the list when a later version starts the
/// server.
pub const COMMAND_PATH_AGENTS: [&str; 1] = ["pi-acp"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolsPath {
    /// The agent starts `zorvo mcp-bridge` from `mcpServers`.
    Mcp,
    /// The agent runs `zorvo tools` with the socket in its environment.
    Command,
}

/// The path for the agent with registry id `profile_id`.
pub fn path_for(profile_id: &str) -> ToolsPath {
    if COMMAND_PATH_AGENTS.contains(&profile_id) {
        ToolsPath::Command
    } else {
        ToolsPath::Mcp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pi_is_on_the_command_path_and_others_on_mcp() {
        assert_eq!(path_for("pi-acp"), ToolsPath::Command);
        for id in [
            "qwen-code",
            "codex-acp",
            "claude-acp",
            "antigravity-acp",
            "",
        ] {
            assert_eq!(path_for(id), ToolsPath::Mcp, "{id}");
        }
    }

    #[test]
    fn a_path_serializes_as_its_lowercase_name() {
        assert_eq!(serde_json::to_value(ToolsPath::Mcp).unwrap(), "mcp");
        assert_eq!(serde_json::to_value(ToolsPath::Command).unwrap(), "command");
    }
}
