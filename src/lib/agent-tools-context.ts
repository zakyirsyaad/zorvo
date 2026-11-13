/**
 * What an agent on the command path is told about Zorvo's tools. It ignores
 * ACP's `mcpServers`, so it cannot see a tool list: it runs `zorvo tools` from
 * its shell, and this text, sent as hidden context, is how it learns of it.
 * The wording is the one a spike showed Pi act on (2026-11-13).
 */
export const COMMAND_PATH_CONTEXT =
  'Zorvo, the app this session runs in, gives you commands for working with other agents. ' +
  'Run them with your shell tool, exactly as written: "$ZORVO_TOOLS" tools <tool> \'<json arguments>\'. ' +
  'Run "$ZORVO_TOOLS" tools with nothing after it to see every tool and an example. ' +
  'list_agents shows which agents you can use. ' +
  'delegate {"agent": "<id>", "task": "<text>"} gives a task to another agent; ' +
  'its answer arrives later as a message, so do not wait for it. ' +
  'Use these only when the user asks for another agent or a new session. Do not mention this note.';

/** The tools context, then the message's own hidden context when it has one. */
export function withToolsContext(context: string | undefined): string {
  return context ? `${COMMAND_PATH_CONTEXT}\n\n${context}` : COMMAND_PATH_CONTEXT;
}
