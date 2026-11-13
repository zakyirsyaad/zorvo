import type { ActionCard, ChatMessage, PermissionChoice } from '../types';
import type { FileStat } from './diff-stats';
import { withoutMarkdownMarks } from './markdown-marks';
import { usableQuestions } from './user-questions';
import { escapeVisible } from './visible-text';

/** How many files a compare column lists before "N more files". */
export const COLUMN_FILE_LIMIT = 3;

/** The files a column lists: the most changed first (ties by path), and how many are left out. */
export function columnFiles(
  stats: readonly FileStat[],
  limit: number = COLUMN_FILE_LIMIT,
): { shown: FileStat[]; more: number } {
  const ordered = [...stats].sort(
    (a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path),
  );
  return { shown: ordered.slice(0, limit), more: Math.max(0, ordered.length - limit) };
}

/** "1 more file" or "4 more files". */
export function moreFilesLabel(count: number): string {
  return count === 1 ? '1 more file' : `${count} more files`;
}

/** One line of an agent's words: runs of space and line breaks folded, then control characters shown; never markdown. */
function oneLine(text: string): string {
  return escapeVisible(text.replace(/\s+/g, ' ').trim());
}

/** An agent's prose as one plain line. */
function proseLine(text: string): string {
  return oneLine(withoutMarkdownMarks(text));
}

/** The agent's newest words in a chat, as plain text; null when it has said nothing yet. */
export function lastAgentText(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'agent') continue;
    const text = proseLine(message.content ?? '');
    if (text) return text;
  }
  return null;
}

/** What the newest open form or page request asks, in one line; null when none is open. */
export function openFormPrompt(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const elicitation = messages[index].elicitation;
    if (elicitation?.status === 'pending') return proseLine(elicitation.message ?? '') || null;
  }
  return null;
}

/** A request open in a compare column: one answered there, or one that needs the session opened. */
export type ColumnRequest =
  | { kind: 'plain'; cardId: string; line: string; reject: PermissionChoice; allowOnce: PermissionChoice }
  | { kind: 'open'; line: string };

/**
 * How a column shows what its agent waits for. A plain permission (no questions, with a reject and an
 * allow-once choice) is answered in the column, by those two choices only; a question or a form is not, and
 * asks to be opened. Its one line is the command, else the files it would edit, else the agent's prompt.
 */
export function columnRequest(pendingCard: ActionCard | null, formPrompt: string | null): ColumnRequest | null {
  if (pendingCard) {
    const questions = usableQuestions(pendingCard.questions);
    if (questions) return { kind: 'open', line: oneLine(questions[0]?.question ?? pendingCard.prompt) };
    const options = pendingCard.options ?? [];
    const allowOnce = options.find((option) => option.kind === 'allow_once');
    const reject = options.find((option) => option.kind.startsWith('reject'));
    const subject =
      pendingCard.commandSnippet ?? (pendingCard.edits?.map((edit) => edit.path).join(', ') || pendingCard.prompt || pendingCard.title);
    const line = oneLine(subject);
    if (allowOnce && reject) return { kind: 'plain', cardId: pendingCard.id, line, reject, allowOnce };
    return { kind: 'open', line };
  }
  return formPrompt === null ? null : { kind: 'open', line: formPrompt };
}
