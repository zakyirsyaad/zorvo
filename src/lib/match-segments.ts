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
  return segmentsOf(text, matchRanges(text, query));
}

/** A matched stretch of a text: [start, end) offsets. */
export type MatchRange = readonly [number, number];

/** Where `query` occurs in `text`, case-insensitively and without overlaps; none for a blank query. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const haystack = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    ranges.push([at, at + needle.length]);
  }
  return ranges;
}

/** The ranges of a longer text that fall in its part [start, end), shifted to that part's own offsets. */
export function rangesWithin(ranges: readonly MatchRange[], start: number, end: number): Array<[number, number]> {
  return ranges
    .map(([from, to]): [number, number] => [Math.max(from, start) - start, Math.min(to, end) - start])
    .filter(([from, to]) => to > from);
}

/** `text` split around sorted, non-overlapping `ranges`. */
export function segmentsOf(text: string, ranges: readonly MatchRange[]): MatchSegment[] {
  const segments: MatchSegment[] = [];
  let from = 0;
  for (const [start, end] of ranges) {
    if (start > from) segments.push({ text: text.slice(from, start), isMatch: false });
    segments.push({ text: text.slice(start, end), isMatch: true });
    from = end;
  }
  if (from < text.length) segments.push({ text: text.slice(from), isMatch: false });
  return segments.length > 0 ? segments : [{ text, isMatch: false }];
}
