// Pure readers of what an agent sends, for the ACP engine: how a turn ended, and the two updates it reacts to.

const NOT_ENDED_NORMALLY = new Set(['refusal', 'max_tokens', 'max_turn_requests']);

export function turnEndNotice(stopReason: string | undefined, error: string | undefined): string | null {
  if (error) return `The agent's turn failed: ${error}`;
  if (stopReason && NOT_ENDED_NORMALLY.has(stopReason)) return `The agent stopped early (${stopReason}).`;
  return null;
}

export function isCommandsUpdate(update: unknown): update is { availableCommands: unknown } {
  return typeof update === 'object' && update !== null && (update as { sessionUpdate?: unknown }).sessionUpdate === 'available_commands_update';
}

/** The title in a session_info_update, if it carries a usable one. */
export function sessionTitleOf(update: unknown): string | undefined {
  if (typeof update !== 'object' || update === null) return undefined;
  const { sessionUpdate, title } = update as { sessionUpdate?: unknown; title?: unknown };
  if (sessionUpdate !== 'session_info_update' || typeof title !== 'string') return undefined;
  return title.trim() || undefined;
}
