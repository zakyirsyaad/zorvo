import type { Session } from '../types';
import { delegateSessionName, type MentionAgentStatus } from './delegation';
import { isArchived } from './session-helpers';
import { escapeVisible } from './visible-text';

/** A tool call the backend hands the webview to answer (`agent-tool-call`). */
export interface AgentToolCall {
  callId: string;
  sessionId: string;
  tool: string;
  args: unknown;
}

/**
 * Whether a session is opened with Zorvo's tools. A compare run's agents work
 * side by side, a delegated session is already somebody's helper, and a
 * session an agent opened must not open more (one level), so none of them
 * gets the tools; a plain session and a fork do.
 */
export function sessionGetsAgentTools(
  session: ToolsSubject,
  sessions: readonly (ToolsSubject & Pick<Session, 'id'>)[] = [],
): boolean {
  // A fork of a session without the tools has none either: forking a session an agent
  // opened, or a delegate, must not be a way around the one level. A source that is gone
  // cannot be judged, and the walk ends on a loop a hand-edited file could hold.
  const seen = new Set<string>();
  let current: ToolsSubject | undefined = session;
  while (current !== undefined) {
    if (current.compareRunId || current.delegatedFrom || current.openedBy) return false;
    const sourceId: string | null | undefined = current.forkedFrom;
    if (sourceId == null || seen.has(sourceId)) return true;
    seen.add(sourceId);
    current = sessions.find((candidate) => candidate.id === sourceId);
  }
  return true;
}

/** What decides whether a session gets Zorvo's tools. */
type ToolsSubject = Pick<Session, 'compareRunId' | 'delegatedFrom' | 'openedBy' | 'forkedFrom'> &
  Partial<Pick<Session, 'id'>>;

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

/** A session this session opened, as `list_agents` reports it. */
export interface ListedOpened {
  agent: string;
  title: string;
  state: 'idle' | 'working';
  folder: string;
}

/** A folder Zorvo knows: its name and its path, as the folder list holds them. */
export interface KnownFolder {
  name: string;
  path: string;
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
  /** The independent sessions this session opened. */
  opened?: readonly ListedOpened[];
  /** The other folders a session may be opened in. */
  folders?: readonly KnownFolder[];
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
  return JSON.stringify({ agents, opened: input.opened ?? [], folders: input.folders ?? [] });
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

// --- Sessions an agent opens (`start_session`).

/** How many sessions one session opened may be in a turn at once. */
export const MAX_RUNNING_OPENED = 3;

/** The listed sessions that `openerId`'s agent opened, oldest first. */
export function openedSessionsOf(openerId: string, sessions: readonly Session[]): Session[] {
  return sessions
    .filter((session) => session.openedBy?.sessionId === openerId && !isArchived(session))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** A path as the folder list would hold it: one trailing slash is not a difference. */
function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Every folder Zorvo knows but the caller's own: where else a session may be opened. */
export function otherFolders(workspaces: readonly KnownFolder[], callerCwd: string): KnownFolder[] {
  const own = withoutTrailingSlash(callerCwd);
  return workspaces.filter((workspace) => workspace.path !== own);
}

/**
 * The folder a call names. Only a path that is, character for character, one
 * of the listed folders is taken: nothing is normalised or resolved here, so a
 * path that merely leads to a known folder is refused, and the backend checks
 * the folder again when the session starts. The error never repeats what was
 * asked for: it is the agent's text.
 */
export function resolveFolder(
  wanted: string,
  input: { workspaces: readonly KnownFolder[]; callerCwd: string },
): { path: string } | { error: string } {
  const asked = withoutTrailingSlash(wanted);
  if (asked !== '' && asked === withoutTrailingSlash(input.callerCwd)) {
    return { error: 'That is this session\'s own folder. Leave "folder" out to work here.' };
  }
  const others = otherFolders(input.workspaces, input.callerCwd);
  if (others.length === 0) return { error: 'No other folder can be used.' };
  const found = others.find((workspace) => workspace.path === asked);
  if (found) return { path: found.path };
  return {
    error: `That folder is not one Zorvo knows. Use a path from list_agents' folders: ${others
      .map((workspace) => escapeVisible(workspace.name))
      .join(', ')}.`,
  };
}

/** The new session's name: the title when the agent gave one, else its agent and the brief's first line. */
export function sessionTitleOf(agentName: string, brief: string, title?: string): string {
  const given = title?.trim() ?? '';
  return given !== '' ? given : delegateSessionName(agentName, brief);
}

/** Why another session cannot be opened now, or null. */
export function openRefusal(input: { runningOpened: number }): string | null {
  return input.runningOpened >= MAX_RUNNING_OPENED
    ? 'Three sessions this session opened are still working. Wait for one to finish.'
    : null;
}

/** `start_session`'s answer once the session is open. */
export function openedResultText(result: { sessionName: string; folder: string }): string {
  return JSON.stringify({
    opened: true,
    session: result.sessionName,
    folder: result.folder,
    note: 'It works on its own and does not report back.',
  });
}
