import { MAX_QUOTE_CHARS } from "./reply-quote";

/** "lines 4–9" (an en dash), or "line 4". */
function rangeWords(first: number, last: number): string {
  return first === last ? `line ${first}` : `lines ${first}–${last}`;
}

/** The viewer's button over a selection: "Add lines 4–9 to prompt". */
export function lineRangeLabel(first: number, last: number): string {
  return `Add ${rangeWords(first, last)} to prompt`;
}

/** Three backticks, or one more than the longest run inside, so the text cannot close its own fence. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * A range of a file's lines for the message: the path and the range, then the lines fenced in the
 * file's language. `path` is relative to the Files tab's folder; a long range is cut, like Reply.
 */
export function lineQuote(path: string, first: number, last: number, lines: readonly string[], fence: string): string {
  const text = lines.join("\n");
  const body = text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS)}…` : text;
  const ticks = fenceFor(body);
  return `\`${path}\` ${rangeWords(first, last)}:\n\n${ticks}${fence}\n${body}\n${ticks}`;
}
