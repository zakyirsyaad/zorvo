import { memo, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  LoaderCircle,
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
import { PathText } from "../ui/PathText";
import { ToolDetails } from "./ToolDetails";

const KIND_ICONS: Readonly<Record<string, LucideIcon>> = {
  execute: Terminal,
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  search: Search,
  fetch: Globe,
};

/** Done is quiet, as the canvas draws it; only a failure is coloured. */
const STATUS_CLASSES = {
  Done: "text-fg-subtle",
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

/** A status claimed only once the agent said so; a tool still running says so in words, by a turning arc. */
function ToolStatus({ tool, isTurnOver }: { tool: ToolExecution; isTurnOver: boolean }) {
  const word = toolStatusWord(tool, isTurnOver);
  if (word === null) {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <LoaderCircle className="h-3 w-3 text-status-running motion-safe:animate-spin" aria-hidden="true" />
        <span className="text-caption text-status-running">Running</span>
      </span>
    );
  }
  return <span className={`shrink-0 text-caption ${STATUS_CLASSES[word]}`}>{word}</span>;
}

/** A 30px row: the icon, a 56px verb, the full path in mono, then the counts and the status. */
const ROW = "flex h-7.5 w-full items-center gap-2 px-3 text-left text-ui-sm text-fg-secondary";

function ToolRow({ tool, isTurnOver, isOpen }: { tool: ToolExecution; isTurnOver: boolean; isOpen?: boolean }) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  // The MCP credits check is a read in words, not the agent's own fetch: the canvas draws a clock,
  // the verb Checked and the result's first line at the right. Agents may prefix the tool with the
  // `zorvo-credits` server name, so match that spelling too (and only that server's tool).
  const name = tool.name.trim().toLowerCase();
  const isCredits = name === "credits_balance" || /^(?:mcp__)?zorvo-credits[_-]+credits_balance$/.test(name);
  const Icon = isCredits ? Clock : (tool.kind && KIND_ICONS[tool.kind]) || Wrench;
  const { verb, target } = isCredits ? { verb: "Checked", target: "credits_balance" } : toolRow(tool);
  const creditsLine = isCredits
    ? tool.details?.find((detail) => detail.kind === "text")?.text.split("\n")[0]
    : undefined;
  // A file's path is cut at its start, so its name stays in sight however long the path;
  // a command reads from its start, so it is cut at its end.
  const isFile = Boolean(target) && tool.kind !== "execute";
  // Diffing is the costly part, and the agent's diff objects stay the same between streamed frames.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what editCounts reads
  const counts = useMemo(() => editCounts(tool), [tool.kind, tool.details]);
  const hover = tool.locations?.length ? tool.locations.join("\n") : tool.name;
  return (
    <>
      {isOpen !== undefined && <Chevron size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />}
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
      {target ? (
        <>
          <span className="w-14 shrink-0 truncate text-fg-muted">{verb}</span>
          {isFile ? (
            <PathText path={target} title={hover} className="flex-1 text-caption" />
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono text-caption" title={hover}>
              {target}
            </span>
          )}
        </>
      ) : (
        // Without a file or a command, the agent's own title is the whole row.
        <span className="min-w-0 flex-1 truncate" title={hover}>
          {verb}
        </span>
      )}
      {counts && (
        <span className="shrink-0 font-mono text-caption tabular-nums">
          <span className="text-status-running">+{formatLineCount(counts.added)}</span>{" "}
          <span className="text-danger">
            {MINUS}
            {formatLineCount(counts.removed)}
          </span>
        </span>
      )}
      {creditsLine && tool.status === "completed" ? (
        <span className="min-w-0 shrink truncate text-caption text-fg-subtle">{creditsLine}</span>
      ) : (
        <ToolStatus tool={tool} isTurnOver={isTurnOver} />
      )}
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
        data-tool-row=""
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
        className={`${ROW} focus-ring-inset cursor-pointer transition-colors hover:bg-surface-hover`}
      >
        <ToolRow tool={tool} isTurnOver={isTurnOver} isOpen={isOpen} />
      </button>
      {isOpen && (
        // Indented 76px, past the icon and the verb, as the canvas draws a command's output.
        <div data-tool-output="" className="mb-2 ml-[76px] mr-3">
          <ToolDetails details={tool.details ?? []} />
        </div>
      )}
    </div>
  );
}

/**
 * The agent's tool calls as flat rows inside their group's card, with no dividers: what each
 * did, on what, and whether it finished. One that produced something can be expanded; a diff
 * starts open only in the turn being watched.
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
      {tools.map((tool) =>
        tool.details?.length ? (
          <ToolCallRow key={tool.id} tool={tool} defaultOpenDiffs={defaultOpenDiffs} isTurnOver={isTurnOver} />
        ) : (
          <div key={tool.id} data-tool-row="" className={ROW}>
            <ToolRow tool={tool} isTurnOver={isTurnOver} />
          </div>
        ),
      )}
    </div>
  );
});
