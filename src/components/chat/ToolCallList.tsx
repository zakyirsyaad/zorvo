import { memo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Search,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ToolExecution } from "../../types";
import { countChanges, diffRows } from "../../lib/diff-rows";
import { formatLineCount, MINUS } from "../../lib/diff-stats";
import { toolRow, toolStatusWord } from "../../lib/tool-summary";
import { ToolDetails } from "./ToolDetails";

const KIND_ICONS: Readonly<Record<string, LucideIcon>> = {
  execute: Terminal,
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  search: Search,
  fetch: Globe,
};

const STATUS_CLASSES = {
  Done: "text-status-running",
  Failed: "text-danger",
  "Did not finish": "text-fg-muted",
} as const;

/** The lines an edit added and removed, when the agent sent its diff. */
function editCounts(tool: ToolExecution): { added: number; removed: number } | null {
  if (tool.kind !== "edit") return null;
  const diffs = tool.details?.filter((detail) => detail.kind === "diff") ?? [];
  if (diffs.length === 0) return null;
  return diffs.reduce(
    (sum, diff) => {
      const counts = countChanges(diffRows(diff.oldText, diff.newText));
      return { added: sum.added + counts.added, removed: sum.removed + counts.removed };
    },
    { added: 0, removed: 0 },
  );
}

/** A status claimed only once the agent said so; a tool still running shows a spinner. */
function ToolStatus({ tool, isTurnOver }: { tool: ToolExecution; isTurnOver: boolean }) {
  const word = toolStatusWord(tool, isTurnOver);
  if (word === null) {
    return (
      <span className="inline-flex items-center text-fg-muted">
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
        <span className="sr-only">Running</span>
      </span>
    );
  }
  return <span className={`text-caption ${STATUS_CLASSES[word]}`}>{word}</span>;
}

const ROW = "flex items-center justify-between gap-2 px-3 py-1.5 text-left";

function ToolRow({ tool, isTurnOver, isOpen }: { tool: ToolExecution; isTurnOver: boolean; isOpen?: boolean }) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const Icon = (tool.kind && KIND_ICONS[tool.kind]) || Wrench;
  const { verb, target } = toolRow(tool);
  const counts = editCounts(tool);
  return (
    <>
      <div className="flex min-w-0 items-center gap-2 overflow-hidden" title={tool.name}>
        {isOpen !== undefined && <Chevron size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />}
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="shrink-0 text-ui text-fg-secondary">{verb}</span>
        {target && <span className="min-w-0 truncate font-mono text-ui-sm text-fg-muted">{target}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {counts && (
          <span className="text-caption tabular-nums">
            <span className="text-status-running">+{formatLineCount(counts.added)}</span>{" "}
            <span className="text-danger">
              {MINUS}
              {formatLineCount(counts.removed)}
            </span>
          </span>
        )}
        <ToolStatus tool={tool} isTurnOver={isTurnOver} />
      </div>
    </>
  );
}

/**
 * One tool call. Its output and diff stay out of the DOM until the row is
 * opened, and a diff opens itself only where its turn is being watched.
 */
function ToolCallRow({ tool, defaultOpenDiffs, isTurnOver }: { tool: ToolExecution; defaultOpenDiffs: boolean; isTurnOver: boolean }) {
  const hasDiff = tool.details?.some((detail) => detail.kind === "diff") ?? false;
  // Only an explicit click overrides the turn rule: an auto-opened row closes
  // again when the user moves on, while a row they opened stays open.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? (defaultOpenDiffs && hasDiff);

  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
        className={`${ROW} focus-ring w-full cursor-pointer transition-colors hover:bg-surface-hover`}
      >
        <ToolRow tool={tool} isTurnOver={isTurnOver} isOpen={isOpen} />
      </button>
      {isOpen && (
        <div className="pb-2.5 pl-12 pr-3 pt-1">
          <ToolDetails details={tool.details ?? []} />
        </div>
      )}
    </div>
  );
}

/**
 * The agent's tool calls as flat rows inside their group's card: what each
 * did, on what, and whether it finished. One that produced something can be
 * expanded; a diff starts open only in the turn being watched.
 */
export const ToolCallList = memo(function ToolCallList({
  tools,
  defaultOpenDiffs,
  isTurnOver,
}: {
  tools: ToolExecution[];
  /** Whether a tool with a diff starts open; false in earlier turns. */
  defaultOpenDiffs: boolean;
  /** The turn has ended: a tool still running did not finish. */
  isTurnOver: boolean;
}) {
  return (
    <div>
      {tools.map((tool, index) => (
        <div key={tool.id}>
          {index > 0 && <div className="h-px bg-border" aria-hidden="true" />}
          {tool.details?.length ? (
            <ToolCallRow tool={tool} defaultOpenDiffs={defaultOpenDiffs} isTurnOver={isTurnOver} />
          ) : (
            <div className={ROW}>
              <ToolRow tool={tool} isTurnOver={isTurnOver} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
});
