/**
 * An agent's prose with the marks markdown adds around its words taken away, for the places that show
 * its words as plain text (a compare column's last message). Nothing is rendered, and code is never
 * rewritten: it loses its delimiters only.
 */

/** Stands in for text held back while the prose around it loses its marks; a private-use character no prose holds. */
const HELD = '\uE000';
const HELD_SPAN = /\uE000(\d+)\uE000/g;

/** A line that opens a fenced block: three or more ticks (with no tick after them on the line) or tildes. */
const OPENING_FENCE = /^\s{0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;
/** A line that could close one: a run of ticks or tildes and nothing else. */
const CLOSING_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
/** A line indented as code. It is left as written, so prose this deep in a list keeps its marks. */
const INDENTED_CODE = /^(?: {4}|\t)/;
/** Punctuation a backslash escapes: the character is meant as itself. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * What may stand before an opening mark and after a closing one. A star inside a word, a glob or a URL
 * (`2*3*4`, a path with a star for a folder) has neither, so it is left alone.
 */
const BEFORE = String.raw`(^|[\s(\[{"'\uE000])`;
const AFTER = String.raw`(?=$|[\s.,;:!?)\]}"'\uE000])`;
const BOLD = new RegExp(String.raw`${BEFORE}\*\*(?=\S)([^\n]*?\S)\*\*${AFTER}`, 'g');
const ITALIC = new RegExp(String.raw`${BEFORE}\*(?=[^\s*])([^*\n]*?[^\s*])\*${AFTER}`, 'g');

/** Whether `line` closes the block `fence` opened: the same character, at least as many of them, and no info string. */
function closesFence(line: string, fence: string): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1];
  return run !== undefined && run[0] === fence[0] && run.length >= fence.length;
}

/** Where a run of exactly `length` ticks starts at or after `from`; -1 when the line has none. */
function closingTicks(line: string, from: number, length: number): number {
  let index = from;
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1;
      continue;
    }
    let end = index;
    while (line[end] === '`') end += 1;
    if (end - index === length) return index;
    index = end;
  }
  return -1;
}

/** A code span's content as markdown reads it: one space of padding on each side goes, unless it is all spaces. */
function spanContent(code: string): string {
  const isPadded = code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '';
  return isPadded ? code.slice(1, -1) : code;
}

/**
 * A line with what must stay as written held back: each code span (a run of ticks, the code, a run of
 * the same length) without its ticks, and each escaped character without its backslash.
 */
function holdLiterals(line: string): { text: string; kept: string[] } {
  const kept: string[] = [];
  let text = '';
  let index = 0;
  const hold = (literal: string) => {
    text += `${HELD}${kept.push(literal) - 1}${HELD}`;
  };
  while (index < line.length) {
    const char = line[index];
    if (char === '\\' && ESCAPABLE.test(line[index + 1] ?? '')) {
      hold(line[index + 1]);
      index += 2;
    } else if (char === '`') {
      let run = index;
      while (line[run] === '`') run += 1;
      const close = closingTicks(line, run, run - index);
      if (close === -1) {
        // Ticks that open no span are text.
        text += line.slice(index, run);
        index = run;
      } else {
        hold(spanContent(line.slice(run, close)));
        index = close + (run - index);
      }
    } else {
      text += char;
      index += 1;
    }
  }
  return { text, kept };
}

/** A line of prose without its marks: a quote's mark, a heading's hashes, a link's target, bold and italic asterisks. */
function proseWithoutMarks(line: string): string {
  return line
    .replace(/^\s{0,3}(?:>\s?)+/, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(BOLD, '$1$2')
    .replace(ITALIC, '$1$2');
}

/** One line outside a fence. */
function lineWithoutMarks(line: string): string {
  if (line.includes(HELD) || INDENTED_CODE.test(line)) return line;
  const { text, kept } = holdLiterals(line);
  return proseWithoutMarks(text).replace(HELD_SPAN, (_whole, index: string) => kept[Number(index)] ?? '');
}

/**
 * `text` without markdown's marks: code ticks and fences, bold and italic asterisks, heading hashes,
 * quote marks, a link's target and a backslash that escapes. The words stay.
 *
 * Code is never rewritten. A span loses its ticks, a fenced block its two fence lines, and an indented
 * line nothing; what is inside reads as the agent wrote it. Underscores are left alone, since
 * `snake_case` and `__init__` are far more common than `_emphasis_`.
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
