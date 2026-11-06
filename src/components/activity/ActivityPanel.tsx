import { useDeferredValue, useMemo, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { ActivityEntryRow } from "./ActivityEntryRow";
import { Button } from "../ui/Button";
import { useDiffStatsSince, useDiffTargets } from "../../hooks/useDiffStats";
import { activityOf, unreportedFiles, type ActivityEntry } from "../../lib/activity";
import { activityTurns, type ActivityTurn } from "../../lib/activity-turns";
import type { FileStat } from "../../lib/diff-stats";
import { formatRelativeTime } from "../../lib/relative-time";
import { escapeVisible } from "../../lib/visible-text";
import type { ChatMessage, Session } from "../../types";

export const MAX_ACTIVITY_ROWS = 500;
const MAX_UNREPORTED_ROWS = 100;

type Filter = "all" | ActivityEntry["kind"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "file", label: "Files" },
  { id: "command", label: "Commands" },
  { id: "permission", label: "Permissions" },
];

const ignoreError = () => {};
const NO_ENTRIES: readonly ActivityEntry[] = [];

export interface ActivityPanelProps {
  messages: readonly ChatMessage[] | undefined;
  /** Live messages can arrive before the saved history: only `ready` means the whole transcript. */
  transcript: "loading" | "ready" | "failed";
  session: Session;
  /** The session's agent, named in the intro and in what it did not report. */
  agentName: string;
  isRepository: boolean;
  isBusy: boolean;
  /** Goes up whenever the session's changes were read again. */
  version: number;
  /** Changes against HEAD, or null before the first answer. */
  headStats: readonly FileStat[] | null;
  headStatsFailed: boolean;
  onJump: (messageId: string) => void;
  /** Shows the inspector's Changes tab, where the unreported files are. */
  onShowChanges: () => void;
}

function Unreported({ files, agentName, compared, onShowChanges }: {
  files: readonly string[];
  agentName: string;
  compared: string;
  onShowChanges: () => void;
}) {
  const shown = files.slice(0, MAX_UNREPORTED_ROWS);
  const title = `${files.length === 1 ? "1 file" : `${files.length} files`} changed that ${agentName} didn't report`;
  return (
    <section
      aria-label="Unreported changes"
      className="flex flex-col gap-2 rounded-lg border border-attention-border bg-attention-surface p-3"
    >
      <div className="flex items-center gap-2">
        <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-status-attention" />
        <h3 className="flex-1 font-semibold text-fg">{title}</h3>
      </div>
      <ul className="flex flex-col gap-0.5 pl-[22px] text-caption text-fg-secondary">
        {shown.map((file) => (
          <li key={file} className="truncate font-mono">
            {escapeVisible(file)}
          </li>
        ))}
      </ul>
      {files.length > shown.length && <p className="pl-[22px] text-caption text-fg-muted">{files.length - shown.length} more.</p>}
      <p className="pl-[22px] text-caption text-fg-subtle">You, a command or another session may have changed them.</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-fg-subtle">{compared}</p>
        <Button variant="outline" size="sm" onClick={onShowChanges}>
          Show in Changes
        </Button>
      </div>
    </section>
  );
}

function TurnGroup({ turn, isBusy, onJump }: { turn: ActivityTurn; isBusy: boolean; onJump: (messageId: string) => void }) {
  const headingId = `activity-turn-${turn.number ?? "earlier"}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-0.5">
      {/* The heading is the turn alone: a long prompt would become the heading's and the region's name. */}
      <div className="flex items-baseline gap-1.5 pb-1.5">
        <h3 id={headingId} className="shrink-0 text-ui-sm font-semibold text-fg">
          {turn.number === null ? "Earlier" : `Turn ${turn.number}`}
        </h3>
        {turn.startedAt !== null && <span className="shrink-0 text-caption text-fg-subtle">{formatRelativeTime(turn.startedAt)}</span>}
        {turn.prompt !== "" && (
          <span className="min-w-0 flex-1 truncate text-caption text-fg-muted">· {escapeVisible(turn.prompt)}</span>
        )}
      </div>
      <ul>
        {turn.entries.map((entry) => (
          <ActivityEntryRow key={entry.key} entry={entry} isBusy={isBusy} onJump={onJump} />
        ))}
      </ul>
    </section>
  );
}

/** What the agent reported doing in this session, by turn, and what git shows that it did not report. */
export function ActivityPanel({ messages, transcript, session, agentName, isRepository, isBusy, version, headStats, headStatsFailed, onJump, onShowChanges }: ActivityPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const startCommit = session.worktree?.startCommit;
  const deferredMessages = useDeferredValue(messages);
  const list = useMemo(() => (transcript === "ready" ? activityOf(deferredMessages ?? []) : null), [deferredMessages, transcript]);

  const { targets, isLoaded, hasFailed: targetsFailed } = useDiffTargets(session.cwd, isRepository, version, ignoreError);
  const since = useDiffStatsSince(isRepository ? session.cwd : undefined, startCommit, version, ignoreError);
  const stats = startCommit ? since.stats : headStats;
  const statsFailed = startCommit ? since.hasFailed : headStatsFailed;

  const entries = list?.entries ?? NO_ENTRIES;
  const counts = (id: Filter) => (id === "all" ? entries.length : entries.filter((entry) => entry.kind === id).length);
  // Grouped once per transcript and filter: the panel renders on every streamed frame of a turn.
  const { matching, shown, turns } = useMemo(() => {
    const matching = filter === "all" ? entries : entries.filter((entry) => entry.kind === filter);
    // The newest entries, cut before grouping, so a long session's cap says how much it leaves out.
    const shown = matching.slice(-MAX_ACTIVITY_ROWS);
    return { matching, shown, turns: activityTurns(shown, deferredMessages ?? []) };
  }, [entries, filter, deferredMessages]);

  const hasCheck = isRepository && !session.historyElsewhere && list !== null && isLoaded && !targetsFailed && stats !== null && !statsFailed;
  const showsFiles = filter === "all" || filter === "file";
  const unreported = hasCheck && stats ? unreportedFiles(entries, stats, targets, session.cwd) : [];

  return (
    <aside aria-label="Activity panel" className="flex h-full min-h-0 flex-1 flex-col bg-surface-1 text-ui text-fg-secondary">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="flex gap-2 text-caption leading-4 text-fg-subtle">
          <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>This is {agentName}&apos;s own report of what it did. Rewinding the chat removes its entries too.</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              aria-label={`${label}, ${counts(id)}`}
              onClick={() => setFilter(id)}
              className={`focus-ring h-6 rounded-md px-2 text-ui-sm ${filter === id ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface-hover"}`}
            >
              {label} <span className="text-fg-subtle">{counts(id)}</span>
            </button>
          ))}
        </div>
        {list === null ? (
          <p className="text-fg-muted">
            {transcript === "failed" ? "This conversation could not be read, so its activity is not shown." : "Reading the activity…"}
          </p>
        ) : (
          <>
            {showsFiles && session.historyElsewhere && (
              <p className="text-caption text-fg-muted">Earlier work stays in the agent, so it is not checked.</p>
            )}
            {showsFiles && isRepository && !session.historyElsewhere && (targetsFailed || statsFailed) && (
              <p className="text-caption text-fg-muted">Could not check against git.</p>
            )}
            {showsFiles && unreported.length > 0 && (
              <Unreported
                files={unreported}
                agentName={agentName}
                compared={startCommit ? "Compared since this worktree began." : "Compared with uncommitted changes."}
                onShowChanges={onShowChanges}
              />
            )}
            {entries.length === 0 ? (
              <p className="text-fg-muted">Nothing yet. What the agent does shows here.</p>
            ) : (
              turns.map((turn) => <TurnGroup key={turn.number ?? "earlier"} turn={turn} isBusy={isBusy} onJump={onJump} />)
            )}
            {matching.length > shown.length && (
              <p className="text-caption text-fg-muted">{matching.length - shown.length} older entries are not shown.</p>
            )}
            {filter === "all" && list.otherTools > 0 && (
              <p className="text-caption text-fg-muted">
                {list.otherTools === 1 ? "1 other tool call is not listed." : `${list.otherTools} other tool calls are not listed.`}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
