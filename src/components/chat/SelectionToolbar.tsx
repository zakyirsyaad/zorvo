import { useId } from "react";
import { Reply } from "lucide-react";
import { Button } from "../ui/Button";
import type { ChatSelection } from "../../hooks/useChatSelection";

/** Above the selection, or below it when there is no room at the top of the window. */
const GAP = 8;
const TOOLBAR_HEIGHT = 40;

function positionOf(rect: ChatSelection["rect"]) {
  if (!rect) return { top: 0, left: 0 };
  const above = rect.top - TOOLBAR_HEIGHT - GAP;
  return { top: above >= GAP ? above : rect.bottom + GAP, left: rect.left + rect.width / 2 };
}

/** Acts on the text selected in a message; pressing it keeps the selection. */
export function SelectionToolbar({ selection, blockedReason, onReply }: {
  selection: ChatSelection;
  blockedReason?: string;
  onReply: () => void;
}) {
  const reasonId = useId();
  const { top, left } = positionOf(selection.rect);
  return (
    <div
      role="toolbar"
      aria-label="Selected text"
      // Pressing a button would otherwise drop the selection before the click reads it.
      onMouseDown={(event) => event.preventDefault()}
      style={{ top, left }}
      className="fixed z-50 -translate-x-1/2 rounded-lg border border-border bg-surface-3 p-0.5 shadow-popover select-none"
    >
      <Button
        variant="ghost"
        icon={<Reply className="h-3.5 w-3.5" />}
        disabled={blockedReason !== undefined}
        title={blockedReason}
        aria-describedby={blockedReason ? reasonId : undefined}
        onClick={onReply}
      >
        {/* The canvas sets Reply at 13px, a step above a 28px button's 12px, so the label carries it. */}
        <span className="text-ui text-fg">Reply</span>
      </Button>
      {blockedReason && (
        <span id={reasonId} className="sr-only">
          {blockedReason}
        </span>
      )}
    </div>
  );
}
