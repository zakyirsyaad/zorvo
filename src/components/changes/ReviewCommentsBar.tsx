import { MessageSquare } from "lucide-react";
import { Button } from "../ui/Button";
import { DraftBox, LineComment, ownAddLabel, type CommentAdder } from "./LineComment";
import { draftKeyOf, parseDraftKey, type CommentAnchor, type ReviewComments } from "../../hooks/useReviewComments";
import { targetLabel, type DiffTargetId, type DiffTargets, type FileStat } from "../../lib/diff-stats";
import { isCounted, type CheckedComment, type FileRead } from "../../lib/review-comments";
import type { ReviewComment } from "../../types";

const commentsWord = (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`;

const locationOf = ({ file, line }: Pick<ReviewComment, "file" | "line">) => `${file}:${line}`;

/** The session's comments as a whole, and those no section can show: another target's, or a file gone from the diff. */
export function ReviewCommentsBar({ variant = "review", review, adder, checked, target, targets, options, reads, listed, onTargetChange, onFocusLost }: {
  /** `review` under the full diff review, `card` under the Changes tab's cards, where Add is smaller. */
  variant?: "review" | "card";
  review: ReviewComments;
  adder?: CommentAdder;
  /** The session's comments, in order, with their statuses on `target`. */
  checked: readonly CheckedComment[];
  target: DiffTargetId;
  targets: DiffTargets;
  options: readonly DiffTargetId[];
  /** What each commented file on `target` reads as. */
  reads: Readonly<Record<string, FileRead>>;
  /** The files the diff lists, or null before the first answer. A box has no read to go by. */
  listed: readonly FileStat[] | null;
  onTargetChange: (target: DiffTargetId) => void;
  onFocusLost: () => void;
}) {
  // Clear sent removes only what this bar is about: the Changes tab never lists another target's comments.
  const sentIds = new Set(checked.flatMap(({ comment }) => (comment.sentAt === undefined ? [] : [comment.id])));
  const hasSent = sentIds.size > 0;
  const elsewhere = checked.filter(({ status }) => status === "elsewhere");
  const elsewhereTargets = [...new Set(elsewhere.map(({ comment }) => comment.target))];
  const gone = checked.filter(({ comment, status }) => status !== "elsewhere" && reads[comment.file]?.status === "missing");
  const goneBoxes = review.draftKeys.flatMap((key): CommentAnchor[] => {
    const place = parseDraftKey(key);
    const isGone = place?.target === target && listed?.every((stat) => stat.path !== place.file);
    return place && isGone ? [place] : [];
  });
  const inMessage = adder?.inMessage ?? new Set<string>();
  const counted = adder ? checked.filter(({ comment, status }) => isCounted(comment, status, inMessage)) : [];
  // A comment's own Add points here too, so the reason shows for it with nothing to count.
  const hasOwnAdd = adder !== undefined && checked.some(({ comment, status }) => ownAddLabel(comment, status, inMessage) !== null);
  const reason = counted.length > 0 || hasOwnAdd ? adder?.blockedReason : undefined;
  if (!hasSent && !reason && counted.length === 0 && elsewhere.length === 0 && gone.length === 0 && goneBoxes.length === 0) return null;

  return (
    <section
      aria-label="Review comments"
      className="mx-4 mb-4 flex max-h-64 shrink-0 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-surface-2 px-3 py-2 text-ui"
    >
      {(hasSent || reason || counted.length > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {counted.length > 0 && (
            <>
              <MessageSquare aria-hidden="true" size={14} className="shrink-0 text-fg-muted" />
              <p className="min-w-0 flex-1 text-fg-secondary">{commentsWord(counted.length)} not in a message</p>
            </>
          )}
          {hasSent && (
            <Button variant="ghost" size="sm" onClick={() => review.clearSent(sentIds)}>
              Clear sent
            </Button>
          )}
          {adder && counted.length > 0 && (
            <Button
              variant={variant === "review" ? "primary" : "outline"}
              size={variant === "review" ? "md" : "sm"}
              disabled={adder.isWaiting || reason !== undefined}
              // The card's short "Add 2" starts its name, so Voice Control finds it by what it shows.
              aria-label={variant === "card" ? `Add ${commentsWord(counted.length)} to message` : undefined}
              aria-describedby={reason ? adder.reasonId : undefined}
              onClick={() => adder.add(counted)}
            >
              {variant === "review" ? `Add ${commentsWord(counted.length)} to message` : `Add ${counted.length}`}
            </Button>
          )}
        </div>
      )}
      {reason && (
        <p id={adder?.reasonId} className="text-caption text-fg-subtle">
          {reason}
        </p>
      )}
      {gone.map(({ comment, status }) => (
        <LineComment
          key={comment.id}
          comment={comment}
          status={status}
          review={review}
          adder={adder}
          location={locationOf(comment)}
          onRemoved={onFocusLost}
        />
      ))}
      {goneBoxes.map((place) => (
        <DraftBox key={draftKeyOf(place)} review={review} place={place} location={locationOf(place)} onDone={onFocusLost} />
      ))}
      {elsewhereTargets.map((other) => (
        <div key={other} className="flex flex-col gap-1">
          {options.includes(other) ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => onTargetChange(other)}>
              Show {targetLabel(other, targets)}
            </Button>
          ) : (
            <p className="text-caption text-fg-subtle">a comparison no longer available</p>
          )}
          {elsewhere
            .filter(({ comment }) => comment.target === other)
            .map(({ comment, status }) => (
              <LineComment
                key={comment.id}
                comment={comment}
                status={status}
                review={review}
                adder={adder}
                location={locationOf(comment)}
                onRemoved={onFocusLost}
              />
            ))}
        </div>
      ))}
    </section>
  );
}
