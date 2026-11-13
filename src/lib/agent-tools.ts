import type { Session } from '../types';
import type { MentionAgentStatus } from './delegation';
import { escapeVisible } from './visible-text';

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

// --- What a tool call means. Pure: the hook that answers calls decides with these.

/** Answered to the agent when the user pressed Deny. */
export const DECLINED = 'The user declined.';
/** Answered for a tool a later phase builds. */
export const NOT_YET = 'This tool is not available yet.';
/** Answered for a session that gets no tools, or that Zorvo does not know. */
export const NO_SESSION = "This session cannot use Zorvo's tools.";

const MAX_LISTED_TASK_CHARS = 200;
const MAX_QUOTED_NAME_CHARS = 60;

export type DelegateState = 'idle' | 'working' | 'needs-answer';

/** One of the session's open delegates, as `list_agents` reports it. */
export interface ListedDelegate {
  agentId: string;
  state: DelegateState;
  task: string;
}

export interface ListedAgent {
  id: string;
  name: string;
  status: Exclude<MentionAgentStatus, 'not-installed'>;
  delegate?: { state: DelegateState; task: string };
}

/** `list_agents`' answer: the agents a task can go to, each with this session's delegate of it. */
export function listAgentsText(input: {
  agents: readonly { id: string; name: string; status: MentionAgentStatus }[];
  delegates: readonly ListedDelegate[];
}): string {
  const agents: ListedAgent[] = input.agents.flatMap((agent) => {
    if (agent.status === 'not-installed') return [];
    const delegate = input.delegates.find((candidate) => candidate.agentId === agent.id);
    return [
      {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        ...(delegate
          ? { delegate: { state: delegate.state, task: delegate.task.slice(0, MAX_LISTED_TASK_CHARS) } }
          : {}),
      },
    ];
  });
  return JSON.stringify({ agents });
}

/**
 * The agent a call names: an exact id, else the one agent whose name is the
 * same but for case and surrounding space. Part of a name is never enough: a
 * guess could start the wrong agent.
 */
export function resolveAgent(
  wanted: string,
  agents: readonly { id: string; name: string }[],
): { id: string } | { error: string } {
  if (agents.length === 0) return { error: 'No agent can take a task right now.' };
  const byId = agents.find((agent) => agent.id === wanted);
  if (byId) return { id: byId.id };
  const name = wanted.trim().toLowerCase();
  const byName = agents.filter((agent) => agent.name.trim().toLowerCase() === name);
  if (byName.length === 1) return { id: byName[0].id };
  const quoted = escapeVisible(wanted.slice(0, MAX_QUOTED_NAME_CHARS));
  return { error: `No agent called "${quoted}". Use one of: ${agents.map((agent) => agent.id).join(', ')}.` };
}

/** Why an agent in this state cannot be given a task, or null. */
export function statusRefusal(agentName: string, status: MentionAgentStatus): string | null {
  if (status === 'not-installed') return `${agentName} isn't installed.`;
  if (status === 'needs-sign-in') return `${agentName} needs a sign-in first. Ask the user to sign in.`;
  return null;
}

/** `delegate`'s answer once the task is on its way. */
export function delegateResultText(result: {
  kind: 'started' | 'sent';
  sessionName: string;
  agentName: string;
}): string {
  return JSON.stringify({
    [result.kind]: true,
    session: result.sessionName,
    note: `The answer arrives as a message when ${result.agentName} finishes. Do not wait for it.`,
  });
}

/** A valid `agent-tool-call` payload, or null. */
export function parseToolCall(payload: unknown): AgentToolCall | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { callId, sessionId, tool, args } = payload as Record<string, unknown>;
  if (typeof callId !== 'string' || typeof sessionId !== 'string' || typeof tool !== 'string') return null;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return { callId, sessionId, tool, args };
}
