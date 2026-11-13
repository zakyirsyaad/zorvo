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
/** A session in another folder: allowed this once, never in advance. */
export const ALLOW_ONCE = 'zorvo-allow-once';
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

/** One thing an agent asked for, waiting for the user's answer: a task for an agent, or a new session. */
export interface WaitingTask {
  kind: 'delegate' | 'start_session';
  targetName: string;
  targetId: string;
  /** The task, or the new session's brief. */
  task: string;
  /** A new session that gets a worktree of its own. */
  hasOwnWorktree?: boolean;
}

/** The card for one new session in the caller's own folder. */
function sessionCard(input: Omit<ToolCardInput, 'targetName' | 'targetId' | 'task'>, task: WaitingTask): ActionCard {
  const card = toolCard({ ...input, targetName: task.targetName, targetId: task.targetId, task: task.task });
  return {
    ...card,
    title: `${input.callerName} wants to open a ${task.targetName} session`,
    zorvoTool: {
      tool: 'start_session',
      callerName: input.callerName,
      targetName: task.targetName,
      targetId: task.targetId,
      folder: input.folder,
      ...(task.hasOwnWorktree ? { hasOwnWorktree: true as const } : {}),
    },
  };
}

function blockHeading(task: WaitingTask): string {
  if (task.kind === 'delegate') return `For ${task.targetName}:`;
  return task.hasOwnWorktree
    ? `New ${task.targetName} session, in its own worktree:`
    : `New ${task.targetName} session:`;
}

/**
 * The card for everything that waits in a session: one request reads as
 * itself, several are listed under a heading each, so the user sees all that
 * Allow would start.
 */
export function toolCardFor(
  input: Omit<ToolCardInput, 'targetName' | 'targetId' | 'task'>,
  tasks: readonly WaitingTask[],
): ActionCard {
  const [first] = tasks;
  const single =
    first.kind === 'start_session'
      ? sessionCard(input, first)
      : toolCard({ ...input, targetName: first.targetName, targetId: first.targetId, task: first.task });
  if (tasks.length === 1) return single;
  const areAllDelegations = tasks.every((task) => task.kind === 'delegate');
  return {
    ...single,
    title: areAllDelegations
      ? `${input.callerName} wants to give other agents ${tasks.length} tasks`
      : `${input.callerName} asks for ${tasks.length} things`,
    prompt: tasks.map((task) => `${blockHeading(task)}\n${visibleTask(task.task)}`).join('\n\n'),
  };
}

export interface FolderCardInput {
  cardId: string;
  sessionId: string;
  callerName: string;
  targetName: string;
  targetId: string;
  /** The other folder the session would work in. */
  folder: string;
  brief: string;
  hasOwnWorktree: boolean;
  now: number;
}

/**
 * The card for a session in another folder. It is asked every time, whatever
 * the session was allowed before: leave given for work in one project must not
 * let text the agent read start an agent in another.
 */
export function folderCard(input: FolderCardInput): ActionCard {
  return {
    id: input.cardId,
    sessionId: input.sessionId,
    title: `${input.callerName} wants to open a ${input.targetName} session in another folder`,
    prompt: visibleTask(input.brief),
    status: 'pending',
    timestamp: input.now,
    options: [
      { optionId: ALLOW_ONCE, name: 'Allow once', kind: 'allow_once' },
      { optionId: DENY, name: 'Deny', kind: 'reject_once' },
    ],
    zorvoTool: {
      tool: 'start_session',
      callerName: input.callerName,
      targetName: input.targetName,
      targetId: input.targetId,
      folder: input.folder,
      isOtherFolder: true,
      ...(input.hasOwnWorktree ? { hasOwnWorktree: true as const } : {}),
    },
  };
}

/** Replaces the card `cardId` with `card`, keeping its place in the chat. */
export function replaceToolCard(messages: ChatMessage[], cardId: string, card: ActionCard): ChatMessage[] {
  return messages.map((message) =>
    message.actionCard?.id === cardId ? { ...message, actionCard: card } : message,
  );
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
    // The card's own allowing option: for this session, or once.
    const allowing = card.options?.find((option) => option.kind.startsWith('allow'))?.optionId ?? ALLOW_SESSION;
    const settled: ActionCard =
      outcome === 'approved'
        ? { ...card, status: 'approved', chosenOptionId: allowing }
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
  if (tool !== 'delegate' && tool !== 'start_session') return undefined;
  if (![callerName, targetName, targetId, folder].every((value) => typeof value === 'string')) return undefined;
  return mark as ZorvoToolRequest;
}

/** What a settled Zorvo card says. */
export function settledWords(card: ActionCard): string {
  if (card.status === 'approved') {
    return card.chosenOptionId === ALLOW_ONCE ? 'Allowed once' : 'Allowed for this session';
  }
  return card.chosenOptionId === DENY ? 'Denied' : 'Not answered';
}
