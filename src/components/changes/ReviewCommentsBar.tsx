import { Button } from "../ui/Button";
import { DraftBox, LineComment, type LinePlace } from "./LineComment";
import { parseDraftKey, draftKeyOf, type ReviewComments } from "../../hooks/useReviewComments";
import { targetLabel, type DiffTargetId, type DiffTargets, type FileStat } from "../../lib/diff-stats";
import type { ReviewComment } from "../../types";

const locationOf = ({ file, line }: LinePlace) => `${file}:${line}`;

/** The session's comments as a whole, and those no section can show: another target's, or a file gone from the diff. */
export function ReviewCommentsBar({ review, comments, target, targets, options, listed, onTargetChange, onFocusLost }: {
  review: ReviewComments;
  /** The session's comments, in order. */
  comments: readonly ReviewComment[];
  target: DiffTargetId;
  targets: DiffTargets;
  options: readonly DiffTargetId[];
  /** The files the diff lists, or null before the first answer. */
  listed: readonly FileStat[] | null;
  onTargetChange: (target: DiffTargetId) => void;
  onFocusLost: () => void;
}) {
  const paths = listed && new Set(listed.map((stat) => stat.path));
  const isGone = (place: LinePlace) => place.target === target && paths !== null && !paths.has(place.file);
  const hasSent = comments.some((comment) => comment.sentAt !== undefined);
  const elsewhere = comments.filter((comment) => comment.target !== target);
  const elsewhereTargets = [...new Set(elsewhere.map((comment) => comment.target))];
  const gone = comments.filter(isGone);
  const goneBoxes = review.draftKeys.flatMap((key) => {
    const place = parseDraftKey(key);
    return place && isGone(place) ? [place] : [];
  });
  if (!hasSent && elsewhere.length === 0 && gone.length === 0 && goneBoxes.length === 0) return null;

  return (
    <section aria-label="Review comments" className="flex max-h-64 shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-border p-2 text-xs">
      {hasSent && (
        <div className="flex justify-end">
          <Button variant="ghost" className="px-2 py-1" onClick={review.clearSent}>
            Clear sent
          </Button>
        </div>
      )}
      {gone.map((comment) => (
        <LineComment
          key={comment.id}
          comment={comment}
          status="outdated"
          review={review}
          location={locationOf(comment)}
          onRemoved={onFocusLost}
        />
      ))}
      {goneBoxes.map((place) => (
        <DraftBox key={draftKeyOf(place)} review={review} place={place} location={locationOf(place)} onDone={onFocusLost} />
      ))}
      {elsewhere.length > 0 && <h3 className="text-[11px] font-medium text-fg-secondary">Not in this diff</h3>}
      {elsewhereTargets.map((other) => (
        <div key={other} className="flex flex-col gap-1">
          {options.includes(other) ? (
            <Button variant="ghost" className="self-start px-2 py-1" onClick={() => onTargetChange(other)}>
              Show {targetLabel(other, targets)}
            </Button>
          ) : (
            <p className="text-[11px] text-fg-subtle">a comparison no longer available</p>
          )}
          {elsewhere
            .filter((comment) => comment.target === other)
            .map((comment) => (
              <LineComment
                key={comment.id}
                comment={comment}
                status="elsewhere"
                review={review}
                location={locationOf(comment)}
                onRemoved={onFocusLost}
              />
            ))}
        </div>
      ))}
    </section>
  );
}
