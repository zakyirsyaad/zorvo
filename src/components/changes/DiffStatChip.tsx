import { MessageSquare } from "lucide-react";
import { formatLineCount, MINUS } from "../../lib/diff-stats";

/**
 * The `+added −removed` totals, and how many review comments there are; opens
 * the diff view. Hidden when nothing changed, unless `isAlwaysShown`: committed
 * work or comments leave the working tree clean but still worth opening.
 */
export function DiffStatChip({ added, removed, commentCount = 0, isAlwaysShown = false, onOpen }: {
  added: number;
  removed: number;
  commentCount?: number;
  isAlwaysShown?: boolean;
  onOpen: () => void;
}) {
  if (added === 0 && removed === 0 && !isAlwaysShown) return null;
  const addedText = formatLineCount(added);
  const removedText = formatLineCount(removed);
  const commentsText = commentCount > 0 ? `, ${formatLineCount(commentCount)} ${commentCount === 1 ? "comment" : "comments"}` : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${addedText} lines added, ${removedText} removed${commentsText}. Open the diff`}
      className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] tabular-nums hover:bg-surface-hover focus-ring"
    >
      <span className="text-status-running">+{addedText}</span>
      <span className="text-danger">
        {MINUS}
        {removedText}
      </span>
      {commentCount > 0 && (
        <span className="flex items-center gap-0.5 text-fg-muted">
          <MessageSquare size={10} aria-hidden="true" />
          {formatLineCount(commentCount)}
        </span>
      )}
    </button>
  );
}
