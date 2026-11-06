import { statusWord, type ActivityEntry } from './activity';
import type { ChatMessage } from '../types';

/** The entries of one of your prompts and what the agent did for it. */
export interface ActivityTurn {
  /** Counted from your first prompt; null for what came before it (a history imported from the agent). */
  number: number | null;
  /** When you sent the prompt; null when the history gives no time. */
  startedAt: number | null;
  /** The prompt, whitespace collapsed; empty for the entries before the first prompt. */
  prompt: string;
  /** In the order the agent did them. */
  entries: ActivityEntry[];
}

/**
 * The entries grouped by the prompt they answered, newest turn first, each turn's entries oldest first. Derived from
 * the transcript, like the entries themselves, so a rewind takes its turns with it. A turn with no entries is left out.
 */
export function activityTurns(entries: readonly ActivityEntry[], messages: readonly ChatMessage[]): ActivityTurn[] {
  const turnOf = new Map<string, number>();
  const turns: ActivityTurn[] = [{ number: null, startedAt: null, prompt: '', entries: [] }];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({
        number: turns.length,
        startedAt: message.hasKnownTime === false ? null : message.timestamp,
        prompt: message.content.replace(/\s+/g, ' ').trim(),
        entries: [],
      });
    }
    turnOf.set(message.id, turns.length - 1);
  }
  for (const entry of entries) turns[turnOf.get(entry.messageId) ?? 0].entries.push(entry);
  return turns.filter((turn) => turn.entries.length > 0).reverse();
}

const VERBS = {
  read: ['Read', 'Read'],
  changed: ['Edited', 'Edit'],
  touched: ['Touched', 'Touch'],
  command: ['Ran', 'Run'],
} as const;

/**
 * What a row says the agent did. Past tense only for a tool that completed, since a row claims an action only then
 * (an agent can send a diff before a permission is refused); otherwise it says what the tool was for.
 */
export function activityVerb(entry: ActivityEntry): string {
  if (entry.kind === 'permission') return 'Asked';
  const [done, meant] = VERBS[entry.kind === 'file' ? entry.action : 'command'];
  return entry.status === 'completed' ? done : meant;
}

const RESULT_WORDS: Record<string, string> = { Read: 'Done', Changed: 'Done', Touched: 'Done', Rejected: 'You denied' };

/** How it ended, beside the verb: `statusWord`, with a finished file as "Done" and your refusal as "You denied". */
export function activityResult(entry: ActivityEntry, isBusy: boolean): string {
  const word = statusWord(entry, isBusy);
  return RESULT_WORDS[word] ?? word;
}

export type DotTone = 'done' | 'failed' | 'running' | 'waiting' | 'open';

/** The timeline dot's look: filled when it went through, edged by what else happened. */
export function dotTone(entry: ActivityEntry, isBusy: boolean): DotTone {
  if (entry.kind === 'permission') {
    return ({ allowed: 'done', rejected: 'failed', waiting: 'waiting', unanswered: 'open' } as const)[entry.answer];
  }
  if (entry.status === 'completed') return 'done';
  if (entry.status === 'failed') return 'failed';
  return isBusy ? 'running' : 'open';
}
