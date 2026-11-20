import type { AgentProfile, ChatMessage } from '../types';
import { delegateBlockedReason as delegationBlockedReason } from './delegation';
import type { DelegationDeps } from '../hooks/useDelegation';

/** The handoff's heading: a delegation, not a fork. */
export const HANDOFF_TITLE = '# Delegation handoff';

/** The line under the heading, before the conversation and the task. */
export const HANDOFF_NOTE =
  "Another agent's session delegated a task to you and waits for your answer. The task is in the message that follows.";

export function agentNameIn(agents: readonly AgentProfile[], profileId: string): string {
  return agents.find((agent) => agent.id === profileId)?.name ?? profileId;
}

/** Why A cannot delegate, with the latest sessions and transcripts. */
export function blockedReasonFor(deps: DelegationDeps, sourceId: string, agentId?: string): string | null {
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
