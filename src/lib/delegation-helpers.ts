import type { AcpChoices } from './acp-draft';
import type { FirstMessage } from '../hooks/session-engine/useAcpEngine';
import type { AgentProfile, ChatMessage, Session, SessionWorktree } from '../types';
import {
  buildDelegatePrompt,
  delegateBlockedReason as delegationBlockedReason,
  delegateSessionName,
} from './delegation';
import type { SessionSpec } from './session-start';

/** The handoff's heading: a delegation, not a fork. */
export const HANDOFF_TITLE = '# Delegation handoff';

/** The line under the heading, before the conversation and the task. */
export const HANDOFF_NOTE =
  "Another agent's session delegated a task to you and waits for your answer. The task is in the message that follows.";

export function agentNameIn(agents: readonly AgentProfile[], profileId: string): string {
  return agents.find((agent) => agent.id === profileId)?.name ?? profileId;
}

/** What `blockedReasonFor` reads. */
export interface BlockedReasonDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  isBusy: (sessionId: string) => boolean;
  isWaiting: (sessionId: string) => boolean;
}

/** Why A cannot delegate, with the latest sessions and transcripts. */
export function blockedReasonFor(deps: BlockedReasonDeps, sourceId: string, agentId?: string): string | null {
  const source = deps.sessions.find((session) => session.id === sourceId);
  // A session that is gone has no delegation item to show.
  if (source === undefined) return '';
  return delegationBlockedReason({
    source,
    ...(agentId !== undefined ? { agentId } : {}),
    sessions: deps.sessions,
    isBusy: deps.isBusy,
    isWaiting: deps.isWaiting,
    hasMessages: (deps.transcripts[sourceId] ?? []).length > 0,
    agentNameOf: (profileId) => agentNameIn(deps.agents, profileId),
  });
}

export function lastMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  return messages[messages.length - 1];
}

export function lastUserMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') return message;
  }
  return undefined;
}

/** The last message that is whole: a reply still streaming (it holds the tool call) is left out. */
export function lastWholeMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'agent' || message.isComplete === true) return message;
  }
  return undefined;
}

/** A task for a worker whose last answer is still on its way to the coordinator. */
export function handoverPendingReason(agentName: string): string {
  return `${agentName}'s last answer has not reached this session yet. Give it the next task after its report arrives.`;
}

/** A worker's session name: the agent and the title, else the agent and the task's first line. */
export function workerNameOf(agentName: string, task: string, title?: string): string {
  return title ? `${agentName}: ${title}` : delegateSessionName(agentName, task);
}

/** The new worker's session spec and its first message, once its handoff file is written. */
export function workerLaunch(input: {
  id: string;
  agent: AgentProfile;
  source: Session;
  cwd: string;
  worktree: SessionWorktree | null;
  name: string;
  task: string;
  handle: string;
  now: number;
  handoffPath: string;
  attachments?: readonly string[];
}): { spec: SessionSpec; first: FirstMessage } {
  const spec: SessionSpec = {
    id: input.id,
    agent: input.agent,
    cwd: input.cwd,
    worktree: input.worktree,
    name: input.name,
    delegatedFrom: { sessionId: input.source.id, task: input.task, startedAt: input.now, handle: input.handle },
  };
  const first: FirstMessage = {
    text: input.task,
    ...(input.attachments !== undefined && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    context: buildDelegatePrompt(input.handoffPath),
  };
  return { spec, first };
}

export interface StartWorkerInput {
  agentId: string;
  task: string;
  title?: string;
  hasOwnWorktree?: boolean;
  attachments?: readonly string[];
  choices?: AcpChoices;
  /** The coordinator's own agent asks, from inside its turn. */
  byAgent?: boolean;
  /** The call ended while git worked: start nothing. */
  isCancelled?: () => boolean;
}

export type StartWorkerResult =
  | { ok: true; sessionId: string; sessionName: string; handle: string; folder: string }
  | { ok: false; reason: string; isInternal?: true; detail?: string };
