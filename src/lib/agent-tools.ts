import type { Session } from '../types';

/** What an agent is told when it calls one of Zorvo's tools before the tools are wired up. */
export const NOT_READY = "Zorvo's tools are not available in this version.";

/** A tool call the backend hands the webview to answer (`agent-tool-call`). */
export interface AgentToolCall {
  callId: string;
  sessionId: string;
  tool: string;
  args: unknown;
}

/**
 * Whether a session is opened with Zorvo's tools. A compare run's agents work
 * side by side and a delegated session is already somebody's helper, so
 * neither gets the tools; a plain session and a fork do.
 */
export function sessionGetsAgentTools(session: Pick<Session, 'compareRunId' | 'delegatedFrom'>): boolean {
  return !session.compareRunId && !session.delegatedFrom;
}
