import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { lastTouchedLabel, stillRunning, summarizeTools } from "../../lib/tool-summary";
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
 * One surface-1 card for a stretch of tool calls: a 34px summary, with what still runs or the
 * file touched last on the right, opens into the flat rows.
 */
export function ToolsPart({ tools, isCurrentTurn, isTurnOver }: ToolsPartProps) {
  const hasDiff = tools.some((tool) => tool.details?.some((detail) => detail.kind === "diff"));
  // Only an explicit click overrides the turn rule: an auto-opened part closes
  // again when the user moves on, while a part they opened stays open.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? (isCurrentTurn && hasDiff);

  const running = stillRunning(tools, isTurnOver);
  const failed = tools.filter((tool) => tool.status === "failed").length;
  const label = summarizeTools(tools);
  const touched = lastTouchedLabel(tools);
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
        title={label}
        className={`focus-ring-inset flex h-[34px] w-full items-center gap-2 px-3 text-left text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover ${
          isOpen ? "border-b border-border" : ""
        }`}
      >
        <Chevron size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {running > 0 ? (
          <>
            <span className="shrink-0 text-caption text-fg-subtle">{running} still running</span>
            {failed > 0 && <span className="shrink-0 text-caption text-danger">{failed} failed</span>}
          </>
        ) : (
          touched && <span className="min-w-0 shrink truncate font-mono text-caption text-fg-subtle">{touched}</span>
        )}
      </button>
      {isOpen && <ToolCallList tools={tools} defaultOpenDiffs={isCurrentTurn} isTurnOver={isTurnOver} />}
    </div>
  );
}
