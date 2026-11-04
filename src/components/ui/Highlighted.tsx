import { Fragment } from "react";
import { matchSegments } from "../../lib/match-segments";

export interface HighlightedProps {
  text: string;
  /** What was searched for; its matches in `text` show in bold. */
  query: string;
}

/** A text with the matches of a search in bold, for menus that filter as you type. */
export function Highlighted({ text, query }: HighlightedProps) {
  return (
    <>
      {matchSegments(text, query).map((segment, index) =>
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
