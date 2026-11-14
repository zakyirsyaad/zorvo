import { memo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { stillRunning, summarizeTools } from "../../lib/tool-summary";
import type { ToolExecution } from "../../types";
import { ToolCallList } from "./ToolCallList";

export interface ToolsPartProps {
  tools: ToolExecution[];
  /** True for the turn the user is watching: a diff opens itself there. */
  isCurrentTurn: boolean;
  /** The turn has ended: nothing is still running, and a tool left running did not finish. */
  isTurnOver: boolean;
}

/**
 * A stretch of tool calls: a 28px ghost summary as wide as its words, with what still runs or
 * failed beside it, opens into the steps on a rail.
 *
 * MessageRow builds each part's `tools` array afresh on every streamed frame, while a tool that did not
 * change keeps its object. So a part is drawn again only when one of its tools is a new object: a long
 * turn holds hundreds of open diffs, and drawing them all on every frame made the window lag.
 */
export const ToolsPart = memo(function ToolsPart({ tools, isCurrentTurn, isTurnOver }: ToolsPartProps) {
  const hasDiff = tools.some((tool) => tool.details?.some((detail) => detail.kind === "diff"));
  // Only an explicit click overrides the turn rule: an auto-opened part closes
  // again when the user moves on, while a part they opened stays open.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? (isCurrentTurn && hasDiff);

  const running = stillRunning(tools, isTurnOver);
  const failed = tools.filter((tool) => tool.status === "failed").length;
  const label = summarizeTools(tools);
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <div data-tools-part="" className="flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
        title={label}
        className="focus-ring -ml-1 flex h-7 max-w-full items-center gap-2 self-start rounded-md pl-1 pr-2 text-left text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover"
      >
        <Chevron size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
        <span className="min-w-0 truncate">{label}</span>
        {running > 0 && (
          <>
            <span className="shrink-0 text-caption text-fg-subtle">{running} still running</span>
            {failed > 0 && <span className="shrink-0 text-caption text-danger">{failed} failed</span>}
          </>
        )}
      </button>
      {isOpen && (
        <div data-tool-rail="" className="ml-[7px] border-l border-border">
          <ToolCallList tools={tools} defaultOpenDiffs={isCurrentTurn} isTurnOver={isTurnOver} />
        </div>
      )}
    </div>
  );
}, isSamePart);

/** Same flags, and the same tool objects in the same order: nothing in the part changed. */
function isSamePart(prev: ToolsPartProps, next: ToolsPartProps): boolean {
  return (
    prev.isCurrentTurn === next.isCurrentTurn &&
    prev.isTurnOver === next.isTurnOver &&
    prev.tools.length === next.tools.length &&
    prev.tools.every((tool, index) => tool === next.tools[index])
  );
}
