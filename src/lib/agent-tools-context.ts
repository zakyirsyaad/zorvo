import { escapeVisible } from './visible-text';

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
  'show_artifact {"path": "<file.html>", "title": "<text>"} shows the user a web page you wrote; run artifact_guide first; add "kind":"canvas" with a folder path for several screens. ' +
  'For websites, call browser {"operation":"tabs.open","url":"https://example.com/"} to open Zorvo\'s native Browser panel. To scroll the active WebKit tab down, call browser {"operation":"scroll","deltaY":800}; a tabID is optional for the active WebKit tab. Use browser_guide for advanced parameters, rather than before every simple action. Browser access asks for its own session grant. Do not start a local HTTP server just to open a remote page. ' +
  'show_visual {"title": "<text>", "path": "<file.svg or file.html>"} puts a picture (a flow, an architecture, a mockup) inside your reply; run artifact_guide {"kind":"visual"} first. ' +
  'Use delegation and session tools only when the user asks for another agent or a new session, ' +
  'and show_artifact when a page explains something better than text. Do not mention this note.';

/**
 * What an agent with Zorvo's MCP server is told about showing pages. Qwen Code loads MCP
 * tools on demand and did not surface the server's instructions (seen with 0.25.2 and
 * 0.27.2, 2026-11-19), so neither the tool's description nor the instructions reached it
 * before it answered; this hidden context does.
 */
export const MCP_PATH_CONTEXT =
  'Zorvo, the app this session runs in, can show the user a web page beside the chat. ' +
  'When a picture explains your answer better than a list (a flow, an architecture, a mockup of a card), ' +
  'show it inside your reply with show_visual: call artifact_guide with kind visual once, then pass an SVG or an HTML fragment as code. ' +
  'When your answer is better seen than read (a report, a summary of what changed, a comparison, a chart, ' +
  'a diagram, a dashboard, a mockup of a screen, or something the user can click through), show it as a page ' +
  'without being asked: call artifact_guide once, write one self-contained .html file, then call show_artifact ' +
  'with its path. Both are tools of the zorvo MCP server; if your tools are loaded on demand, find them with ' +
  'your agent\'s tool discovery first. For browsing websites call browser from the same server directly: {"operation":"tabs.open","url":"https://example.com/"} opens the native Browser panel after its session grant; {"operation":"scroll","deltaY":800} scrolls its active WebKit tab down. A tabID is optional for the active WebKit tab. Use browser_guide for advanced parameters, rather than before every simple action. Do not start a local HTTP server just to open a remote page. Several screens, a flow or variants of one screen go on a canvas: call artifact_guide with kind canvas, then show_artifact with kind canvas. To have another agent work for you, call start_worker and end your turn: its result arrives as a message; send gives a worker you started a further task. Keep answers that are short text or code in the chat. Do not mention this note.';

/** Which of Zorvo's ways in a session has, and so which note it is due. */
export type ToolsPath = 'command' | 'mcp';

/** A worker's note: which way in it has and the agent that gave it the task. */
export interface WorkerNote {
  role: 'worker';
  path: ToolsPath;
  /** The name of the coordinator's agent, as it goes into the note. */
  coordinator: string;
}

/** What a session is due: its coordinator's note for a path, or a worker's own. */
export type ToolsNote = ToolsPath | WorkerNote;

/** How every worker's note starts; the coordinator's name follows. */
const WORKER_OPENING = 'You are a worker. ';

/**
 * What a worker is told: who gave it the task, to do only that, and to end with `done`. Its agent's
 * name comes from the registry, so it goes through `escapeVisible` before it is part of a sentence.
 */
export function workerContext(path: ToolsPath, coordinatorAgentName: string): string {
  const report =
    path === 'mcp'
      ? 'call the done tool once with outcome succeeded or failed and a short summary: what you did, what you found, what is left.'
      : 'run "$ZORVO_TOOLS" tools done \'{"outcome":"succeeded","summary":"<what you did, what you found, what is left>"}\' once, with outcome succeeded or failed and a short summary.';
  return (
    `${WORKER_OPENING}${escapeVisible(coordinatorAgentName)}, in another Zorvo session, gave you this task and cannot see this chat. ` +
    `Do only this task. When you finish, ${report} ` +
    'Use failed when the work is not done. Then end your turn.'
  );
}

/** The note due for `note`, then the message's own hidden context when it has one. */
export function withToolsContext(context: string | undefined, note: ToolsNote): string {
  const text =
    typeof note !== 'string'
      ? workerContext(note.path, note.coordinator)
      : note === 'mcp'
        ? MCP_PATH_CONTEXT
        : COMMAND_PATH_CONTEXT;
  return context ? `${text}\n\n${context}` : text;
}

/**
 * A title shorter than this can be an agent's own even when a note starts with it ("Zorvo"). Both
 * fixed notes share their first 37 characters, so a real cut of one is longer.
 */
const MIN_NOTE_TITLE_CHARS = 40;

/**
 * Whether an agent's title for a session is cut from Zorvo's own hidden note. The note goes first
 * in the first prompt, and an agent that names a session after the start of that prompt (Claude
 * Code's adapter does, before any answer) would show the user text they never wrote.
 */
export function isToolsContextTitle(title: string): boolean {
  const cut = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(…|\.{3})$/, '')
    .trimEnd();
  if (cut.startsWith(WORKER_OPENING.trimEnd())) return true;
  if (cut.length < MIN_NOTE_TITLE_CHARS) return false;
  return [MCP_PATH_CONTEXT, COMMAND_PATH_CONTEXT].some((note) => note.startsWith(cut) || cut.startsWith(note));
}
