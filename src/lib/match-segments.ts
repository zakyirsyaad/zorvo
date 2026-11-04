/** A piece of a text, and whether it is one of the query's matches. */
export interface MatchSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Splits `text` around every case-insensitive occurrence of `query`, to show
 * the matches of a search in bold. A plain `indexOf`, so a query holding
 * regex characters such as `(` or `*` is taken as text and cannot throw.
 */
export function matchSegments(text: string, query: string): MatchSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [{ text, isMatch: false }];
  const haystack = text.toLowerCase();
  const segments: MatchSegment[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) segments.push({ text: text.slice(from, at), isMatch: false });
    segments.push({ text: text.slice(at, at + needle.length), isMatch: true });
    from = at + needle.length;
  }
  if (from < text.length) segments.push({ text: text.slice(from), isMatch: false });
  return segments.length > 0 ? segments : [{ text, isMatch: false }];
}
