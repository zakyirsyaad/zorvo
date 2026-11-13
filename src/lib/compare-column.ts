import type { ActionCard, ChatMessage, PermissionChoice } from '../types';
import type { FileStat } from './diff-stats';
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

/** Stands in for a code span while the prose around it loses its marks; a private-use character no prose holds. */
const HELD = '\uE000';
const HELD_SPAN = /\uE000(\d+)\uE000/g;
/** A line that opens a fenced block: three or more ticks (with no tick after them on the line) or tildes. */
const OPENING_FENCE = /^\s{0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;
/** A line that could close one: a run of ticks or tildes and nothing else. */
const CLOSING_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*$/;

/** Whether `line` closes the block `fence` opened: the same character, at least as many of them, and no info string. */
function closesFence(line: string, fence: string): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1];
  return run !== undefined && run[0] === fence[0] && run.length >= fence.length;
}

/** A line of prose without its marks: bold and italic asterisks, a heading's hashes, a quote's mark, a link's target. */
function proseWithoutMarks(line: string): string {
  return line
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '');
}

/** One line outside a fence: its code spans lose their ticks and nothing else, and the prose around them its marks. */
function lineWithoutMarks(line: string): string {
  if (line.includes(HELD)) return line;
  const spans: string[] = [];
  const held = line.replace(/`([^`\n]+)`/g, (_whole, code: string) => `${HELD}${spans.push(code) - 1}${HELD}`);
  return proseWithoutMarks(held).replace(HELD_SPAN, (_whole, index: string) => spans[Number(index)] ?? '');
}

/**
 * An agent's prose without the marks markdown adds around its words: code ticks and fences, bold and
 * italic asterisks, heading hashes, quote marks, and a link's target. The words stay; nothing is rendered.
 * Code is never rewritten: a span or a fenced block loses its delimiters only, so a glob with stars and
 * `[key](value)` read as the agent wrote them. Underscores are left alone, since `snake_case` and
 * `__init__` are far more common than `_emphasis_`.
 */
export function withoutMarkdownMarks(text: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    if (fence !== null) {
      // Inside a fence every line is code, a shorter fence included; the line that closes it goes, as the one that opened it did.
      const isClosing = closesFence(line, fence);
      if (isClosing) fence = null;
      lines.push(isClosing ? '' : line);
      continue;
    }
    const opening = OPENING_FENCE.exec(line);
    fence = opening?.[1] ?? opening?.[2] ?? null;
    lines.push(fence === null ? lineWithoutMarks(line) : '');
  }
  return lines.join('\n');
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
