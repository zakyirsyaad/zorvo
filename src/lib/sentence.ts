/**
 * The end of a sentence: a stop, question or exclamation mark, an ellipsis or a full-width stop, maybe followed by
 * closing quotes or brackets ('Says "go."', "Says “go.”", "(all of them.)").
 */
const SENTENCE_END = /[.!?…。！？][\p{Pe}\p{Pf}"']*$/u;

/** An agent's own words, trimmed and closed with a full stop when they have no end of their own; blank gives "". */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}
