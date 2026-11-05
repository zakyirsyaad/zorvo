import { MessageSquare } from "lucide-react";
import { Chip } from "../ui/Chip";
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
    <Chip
      onClick={onOpen}
      label={`${addedText} lines added, ${removedText} removed${commentsText}. Open the diff`}
      className="font-mono tabular-nums"
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
    </Chip>
  );
}
