/**
 * What an agent on the command path is told about Zorvo's tools. It ignores
 * ACP's `mcpServers`, so it cannot see a tool list: it runs `zorvo tools` from
 * its shell, and this text, sent as hidden context, is how it learns of it.
 * The wording is the one a spike showed Pi act on (2026-11-13).
 */
export const COMMAND_PATH_CONTEXT =
  'Zorvo, the app this session runs in, gives you commands for working with other agents and for showing pages. ' +
  'Run them with your shell tool, exactly as written: "$ZORVO_TOOLS" tools <tool> \'<json arguments>\'. ' +
  'Run "$ZORVO_TOOLS" tools alone to see every tool. ' +
  'list_agents shows the agents you can use. ' +
  'start_worker {"agent": "<id>", "task": "<text>"} starts another agent as a worker and returns at once, ' +
  'so end your turn: its result arrives later as a message; ' +
  'send {"handle": "<handle>", "message": "<text>"} gives a worker you started a further task. ' +
  'start_session {"agent": "<id>", "brief": "<text>"} opens a separate session that does not report back; ' +
  'read_session {"handle": "<handle>"} reads its last answer and stop_session stops it. ' +
  'show_artifact {"path": "<file.html>", "title": "<text>"} shows the user a web page you wrote; run artifact_guide first. ' +
  'Use the agent tools only when the user asks for another agent or a new session, ' +
  'and show_artifact when a page explains something better than text. Do not mention this note.';

/**
 * What an agent with Zorvo's MCP server is told about showing pages. Qwen Code loads MCP
 * tools on demand and did not surface the server's instructions (seen with 0.25.2 and
 * 0.27.2, 2026-11-19), so neither the tool's description nor the instructions reached it
 * before it answered; this hidden context does.
 */
export const MCP_PATH_CONTEXT =
  'Zorvo, the app this session runs in, can show the user a web page beside the chat. ' +
  'When your answer is better seen than read (a report, a summary of what changed, a comparison, a chart, ' +
  'a diagram, a dashboard, a mockup of a screen, or something the user can click through), show it as a page ' +
  'without being asked: call artifact_guide once, write one self-contained .html file, then call show_artifact ' +
  'with its path. Both are tools of the zorvo MCP server; if your tools are loaded on demand, find them with ' +
  'tool_search first. To have another agent work for you, call start_worker and end your turn: ' +
  'its result arrives as a message; send gives a worker you started a further task. ' +
  'Keep answers that are short text or code in the chat. Do not mention this note.';

/** Which of Zorvo's ways in a session has, and so which note it is due. */
export type ToolsPath = 'command' | 'mcp';

/** The tools context for `path`, then the message's own hidden context when it has one. */
export function withToolsContext(context: string | undefined, path: ToolsPath): string {
  const note = path === 'mcp' ? MCP_PATH_CONTEXT : COMMAND_PATH_CONTEXT;
  return context ? `${note}\n\n${context}` : note;
}
