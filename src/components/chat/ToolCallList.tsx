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
import { countChanges } from "../../lib/diff-rows";
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

/** The lines an edit added and removed, and whether it made a new file, when the agent sent its diff. */
function editCounts(tool: ToolExecution): { added: number; removed: number; isNew: boolean } | null {
  if (tool.kind !== "edit") return null;
  const diffs = tool.details?.filter((detail) => detail.kind === "diff") ?? [];
  if (diffs.length === 0) return null;
  return diffs.reduce(
    (sum, diff) => {
      const counts = countChanges(diff.rows);
      return {
        added: sum.added + counts.added,
        removed: sum.removed + counts.removed,
        isNew: sum.isNew || diff.isNewFile,
      };
    },
    { added: 0, removed: 0, isNew: false as boolean },
  );
}

/**
 * A 28px step on the rail: the icon (a turning arc while the tool runs), a 44px verb, the full path
 * in mono, then "New", the counts, the status, and a slot for the chevron of a step that opens.
 */
const ROW = "flex h-7 w-full items-center gap-2 rounded-md pl-3.5 pr-2 text-left text-ui-sm text-fg-secondary";

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
  // A status is claimed only once the agent said so; a tool still running says so in words, by a turning arc.
  const word = toolStatusWord(tool, isTurnOver);
  return (
    <>
      {word === null ? (
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 text-status-running motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
      )}
      {target ? (
        <>
          <span className="w-11 shrink-0 truncate text-fg-muted">{verb}</span>
          {isFile ? (
            <PathText path={target} title={hover} className={`flex-1 text-caption ${tool.kind === "edit" ? "text-fg" : ""}`} />
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
      {counts?.isNew && <span className="shrink-0 text-caption text-fg-subtle">New</span>}
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
        <span className={`shrink-0 text-caption ${word === null ? "text-status-running" : STATUS_CLASSES[word]}`}>
          {word ?? "Running"}
        </span>
      )}
      {/* Every step keeps the chevron's slot, so the columns line up whether or not it opens. */}
      <span data-tool-chevron="" aria-hidden="true" className="flex w-3 shrink-0 justify-center text-fg-muted">
        {isOpen !== undefined && <Chevron size={12} />}
      </span>
    </>
  );
}

/**
 * One tool call. Its output and diff stay out of the DOM until the row is
 * opened, and a diff opens itself only where its turn is being watched.
 */
// Memoized: a streamed frame changes one tool, and every other row's open diff would be drawn again.
const ToolCallRow = memo(function ToolCallRow({ tool, defaultOpenDiffs, isTurnOver }: { tool: ToolExecution; defaultOpenDiffs: boolean; isTurnOver: boolean }) {
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
        // Indented 36px, under the step's verb, as the canvas draws a command's output.
        <div data-tool-output="" className="mb-2 ml-9 mr-2">
          <ToolDetails details={tool.details ?? []} />
        </div>
      )}
    </div>
  );
});

/**
 * The agent's tool calls as flat steps on their group's rail, with no dividers: what each
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
