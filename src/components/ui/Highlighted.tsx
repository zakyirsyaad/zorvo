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
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
