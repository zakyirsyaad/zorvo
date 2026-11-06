import { Fragment } from "react";
import { matchSegments, segmentsOf, type MatchRange } from "../../lib/match-segments";

export interface HighlightedProps {
  text: string;
  /** What was searched for; its matches in `text` show in bold. */
  query?: string;
  /** The matches as [start, end) offsets into `text`, when they were found in a longer text; wins over `query`. */
  ranges?: readonly MatchRange[];
}

/** A text with the matches of a search in bold, for menus that filter as you type. */
export function Highlighted({ text, query = "", ranges }: HighlightedProps) {
  const segments = ranges ? segmentsOf(text, ranges) : matchSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.isMatch ? (
          <mark key={index} className="bg-transparent font-semibold text-fg">
            {segment.text}
          </mark>
        ) : (
          // Plain text, not a span: an element's edge drops its spaces from the accessible name ("my file" read as "myfile").
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
