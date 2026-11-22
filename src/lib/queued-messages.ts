import { escapeVisible } from './visible-text';

/** Most messages one session holds; a sixth is refused until one leaves. */
export const MAX_QUEUED_MESSAGES = 5;

export const QUEUE_FULL_NOTE = 'Five messages are waiting. Remove one to add another.';

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: readonly string[];
}

/** Why a session's queue is not sending by itself: the last turn failed, or the agent is gone. */
export type QueueHold = 'failed' | 'ended';

export const isFull = (list: readonly QueuedMessage[]): boolean => list.length >= MAX_QUEUED_MESSAGES;

/** The list with `message` last; unchanged when it is full. */
export function addMessage(list: readonly QueuedMessage[], message: QueuedMessage): readonly QueuedMessage[] {
  return isFull(list) ? list : [...list, message];
}

export const removeMessage = (list: readonly QueuedMessage[], id: string): readonly QueuedMessage[] =>
  list.filter((message) => message.id !== id);

export function moveToFront(list: readonly QueuedMessage[], id: string): readonly QueuedMessage[] {
  const picked = list.find((message) => message.id === id);
  return picked ? [picked, ...removeMessage(list, id)] : list;
}

export function takeFirst(
  list: readonly QueuedMessage[],
): { first: QueuedMessage; rest: readonly QueuedMessage[] } | null {
  const [first, ...rest] = list;
  return first ? { first, rest } : null;
}

/** A message as one plain line: nothing is markdown, and characters that hide or reshape text show. */
export const previewOf = (text: string): string => escapeVisible(text.replace(/\s+/g, ' ').trim());

export function queueHoldNote(hold: QueueHold | null, agentName: string): string | null {
  if (hold === 'failed') return 'Not sent: the last turn failed.';
  if (hold === 'ended') return `Not sent: ${agentName} has ended.`;
  return null;
}

export const queuedAnnouncement = (agentName: string): string =>
  `Message queued. It is sent when ${agentName} finishes.`;

export const SENT_ANNOUNCEMENT = 'Queued message sent.';

export const droppedNotice = (count: number): string =>
  count === 1
    ? 'One queued message was dropped because the conversation changed.'
    : `${count} queued messages were dropped because the conversation changed.`;
