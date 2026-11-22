import { escapeVisible } from './visible-text';

/** Most messages one session holds; a sixth is refused until one leaves. */
export const MAX_QUEUED_MESSAGES = 5;

export const QUEUE_FULL_NOTE = 'Five messages are waiting. Remove one to add another.';

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: readonly string[];
}

/** Why a session's queue is not sending by itself: the last turn failed, the agent is gone, or it waits for the user's answer. */
export type QueueHold = 'failed' | 'ended' | 'waiting' | 'refused';

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
  if (hold === 'refused') return `Not sent: ${agentName} did not take the last message.`;
  if (hold === 'waiting') return 'Waits for your answer in the chat.';
  return null;
}

export const queuedAnnouncement = (agentName: string): string =>
  `Message queued. It is sent when ${agentName} finishes.`;

export const SENT_ANNOUNCEMENT = 'Queued message sent.';

/** A rewind removes the whole queue: the conversation it was written for changed. */
export const rewindNotice = (count: number): string =>
  count === 1 ? '1 queued message was removed with the rewind.' : `${count} queued messages were removed with the rewind.`;
