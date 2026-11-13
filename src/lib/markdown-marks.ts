import { fromMarkdown } from 'mdast-util-from-markdown';

/**
 * An agent's prose as plain text, for the places that show its words without rendering them (a compare
 * column's last message). The text is read by the parser the chat renders with, so it says what the chat
 * says: marks go, words stay, and code is exactly what the agent wrote, whatever its ticks or fences.
 */

/** What the reader needs of a markdown node. */
interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
}

/** Blocks that hold other blocks; their parts read one under another. */
const BLOCK_CONTAINERS: ReadonlySet<string> = new Set(['root', 'blockquote', 'list', 'listItem']);

/**
 * How much of a text is parsed. The places that show it show a few lines, and a reply can be long
 * and is read again each time it grows.
 */
export const MAX_PARSED_CHARS = 2000;

function textOf(node: MarkdownNode): string {
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if (node.type === 'break') return '\n';
  // Text, inline code, a code block and raw HTML carry their own words.
  if (typeof node.value === 'string') return node.value;
  const parts = (node.children ?? []).map(textOf);
  return BLOCK_CONTAINERS.has(node.type) ? parts.filter((part) => part !== '').join('\n') : parts.join('');
}

/** The start of `text`, cut where no character is split in two. */
function startOf(text: string): string {
  if (text.length <= MAX_PARSED_CHARS) return text;
  const cut = text.slice(0, MAX_PARSED_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The start of `text` without markdown's marks, one block per line: emphasis, headings, quotes, list
 * markers, link targets, escapes, code ticks and fences are gone, and what they held is kept. Code is
 * never rewritten. It is CommonMark as the chat reads it, so `__init__` outside code loses its
 * underscores here as it is bold there.
 */
export function withoutMarkdownMarks(text: string): string {
  return textOf(fromMarkdown(startOf(text)) as MarkdownNode);
}
