//! Zorvo's own MCP server for agents: schemas and validation, the private
//! socket and the stdio bridge, and the MCP subset spoken over them.

pub mod bridge;
pub mod cli;
pub mod commands;
pub mod path;
pub mod protocol;
pub mod service;
pub mod socket;
pub mod tools;

pub use path::{path_for, ToolsPath};
pub use service::{AgentTools, ToolCall};
