import { useState } from "react";
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

/** One card for a stretch of tool calls: the summary opens into the flat rows. */
export function ToolsPart({ tools, isCurrentTurn, isTurnOver }: ToolsPartProps) {
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
    <div className="rounded-lg border border-border bg-bg">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
        title={label}
        className={`focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui text-fg-secondary transition-colors hover:bg-surface-hover ${
          isOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <Chevron size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {running > 0 && <span className="shrink-0 text-caption text-fg-muted">{running} still running</span>}
        {running > 0 && failed > 0 && <span className="shrink-0 text-caption text-danger">{failed} failed</span>}
      </button>
      {isOpen && (
        <div className="border-t border-border">
          <ToolCallList tools={tools} defaultOpenDiffs={isCurrentTurn} isTurnOver={isTurnOver} />
        </div>
      )}
    </div>
  );
}
