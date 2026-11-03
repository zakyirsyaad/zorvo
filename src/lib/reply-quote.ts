/** A longer selection is cut, so one drag cannot flood the message. */
export const MAX_QUOTE_CHARS = 4000;

const NO_MESSAGE_BOX = 'There is no message box for this session.';
const MESSAGE_BOX_DISABLED = 'The message box is not available right now.';
const HELD_ELSEWHERE = 'The message holds comments for another session. Go back to it, or clear the message.';

/** Drops blank lines around the text; prose also loses the spaces at its ends, code keeps its indentation. */
function trimmed(text: string, isCode: boolean): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const kept = lines.map((line) => line.trimEnd()).join('\n');
  return isCode ? kept : kept.trim();
}

/**
 * The selected text as a markdown quote, with a blank line after it to write on.
 * It is what the chat shows, not the reply's markdown: list marks and link targets are not in it.
 */
export function replyQuote(text: string, isCode: boolean): string {
  const body = trimmed(text, isCode);
  if (body === '') return '';
  const cut = body.length > MAX_QUOTE_CHARS ? `${body.slice(0, MAX_QUOTE_CHARS)}…` : body;
  const lines = isCode ? ['```', ...cut.split('\n'), '```'] : cut.split('\n');
  return `${lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')}\n\n`;
}

/** Why Reply cannot add to the message box, the same cases that stop review comments. */
export function replyBlockedReason(state: {
  isComposerHidden: boolean;
  isComposerDisabled: boolean;
  /** The box holds another session's review comments, which the quote would join. */
  isHeldElsewhere: boolean;
}): string | undefined {
  if (state.isComposerHidden) return NO_MESSAGE_BOX;
  if (state.isComposerDisabled) return MESSAGE_BOX_DISABLED;
  if (state.isHeldElsewhere) return HELD_ELSEWHERE;
  return undefined;
}
