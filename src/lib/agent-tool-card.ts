/**
 * The card Zorvo shows when an agent calls one of its tools for the first time
 * in a session: who asks, whom the task is for, where, and the task itself.
 * Zorvo makes it, not the agent's own permission request: some agents allow
 * MCP tools without asking, and the card must not depend on that.
 */
import type { ActionCard, ChatMessage, ZorvoToolRequest } from '../types';
import { withCardOnReply, type AcpReducerContext } from './acp-events';
import { escapeVisible } from './visible-text';

export const ALLOW_SESSION = 'zorvo-allow-session';
export const DENY = 'zorvo-deny';

export interface ToolCardInput {
  cardId: string;
  sessionId: string;
  callerName: string;
  targetName: string;
  targetId: string;
  folder: string;
  task: string;
  now: number;
}

/**
 * The task with its line breaks kept and every other control or bidi character
 * made visible: a task is often several lines, and `escapeVisible` alone would
 * fold them into one.
 */
function visibleTask(task: string): string {
  return task
    .split(/\r\n|\r|\n/)
    .map((line) => escapeVisible(line))
    .join('\n');
}

export function toolCard(input: ToolCardInput): ActionCard {
  return {
    id: input.cardId,
    sessionId: input.sessionId,
    title: `${input.callerName} wants to give ${input.targetName} a task`,
    // Shown as text: the user must read exactly what the other agent will read.
    prompt: visibleTask(input.task),
    status: 'pending',
    timestamp: input.now,
    options: [
      { optionId: ALLOW_SESSION, name: 'Allow for this session', kind: 'allow_always' },
      { optionId: DENY, name: 'Deny', kind: 'reject_once' },
    ],
    zorvoTool: {
      tool: 'delegate',
      callerName: input.callerName,
      targetName: input.targetName,
      targetId: input.targetId,
      folder: input.folder,
    },
  };
}

/** The card on the agent's open reply, or on a new agent message. */
export function withToolCard(messages: ChatMessage[], card: ActionCard, ctx: AcpReducerContext): ChatMessage[] {
  return withCardOnReply(messages, card, ctx);
}

/** Withdrawn: the call ended before the user answered (a timeout, a cancel, a stopped session). */
export type ToolCardOutcome = 'approved' | 'rejected' | 'withdrawn';

export function settleToolCard(messages: ChatMessage[], cardId: string, outcome: ToolCardOutcome): ChatMessage[] {
  if (!messages.some((message) => message.actionCard?.id === cardId)) return messages;
  return messages.map((message) => {
    const card = message.actionCard;
    if (card?.id !== cardId) return message;
    const settled: ActionCard =
      outcome === 'approved'
        ? { ...card, status: 'approved', chosenOptionId: ALLOW_SESSION }
        : outcome === 'rejected'
          ? { ...card, status: 'rejected', chosenOptionId: DENY }
          : { ...card, status: 'rejected', chosenOptionId: undefined };
    return { ...message, actionCard: settled };
  });
}

/** The mark of a card read back from a transcript, when it is whole. */
export function usableZorvoTool(mark: unknown): ZorvoToolRequest | undefined {
  if (typeof mark !== 'object' || mark === null) return undefined;
  const { tool, callerName, targetName, targetId, folder } = mark as Record<string, unknown>;
  if (tool !== 'delegate') return undefined;
  if (![callerName, targetName, targetId, folder].every((value) => typeof value === 'string')) return undefined;
  return mark as ZorvoToolRequest;
}

/** What a settled Zorvo card says. */
export function settledWords(card: ActionCard): string {
  if (card.status === 'approved') return 'Allowed for this session';
  return card.chosenOptionId === DENY ? 'Denied' : 'Not answered';
}
