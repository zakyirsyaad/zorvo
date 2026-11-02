import { useDeferredValue, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ActivityEntryRow } from "./ActivityEntryRow";
import { IconButton } from "../ui/IconButton";
import { useDiffStatsSince, useDiffTargets } from "../../hooks/useDiffStats";
import { activityOf, unreportedFiles, type ActivityEntry } from "../../lib/activity";
import type { FileStat } from "../../lib/diff-stats";
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

export interface ActivityPanelProps {
  messages: readonly ChatMessage[] | undefined;
  /** Live messages can arrive before the saved history: only `ready` means the whole transcript. */
  transcript: "loading" | "ready" | "failed";
  session: Session;
  isRepository: boolean;
  isBusy: boolean;
  /** Goes up whenever the session's changes were read again. */
  version: number;
  /** Changes against HEAD, or null before the first answer. */
  headStats: readonly FileStat[] | null;
  headStatsFailed: boolean;
  onJump: (messageId: string) => void;
  onOpenDiff: () => void;
  onClose: () => void;
}

function Unreported({ files, compared, onOpenDiff }: { files: readonly string[]; compared: string; onOpenDiff: () => void }) {
  const shown = files.slice(0, MAX_UNREPORTED_ROWS);
  const title = "Not reported by the agent";
  return (
    <section aria-label={title} className="border-b border-border px-3 py-2">
      <h3 className="text-xs font-medium text-fg-secondary">{title}</h3>
      {files.length === 0 ? (
        <p className="mt-0.5 text-[11px] text-fg-muted">Nothing unreported.</p>
      ) : (
        <>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            These changed in git, but the agent did not list them. A command, a rewind, you, or another session may have changed them.
          </p>
          <ul className="mt-1">
            {shown.map((file) => (
              <li key={file}>
                <button
                  type="button"
                  onClick={onOpenDiff}
                  className="focus-ring block max-w-full truncate rounded text-left font-mono text-[11px] text-fg-secondary hover:underline"
                >
                  {escapeVisible(file)}
                </button>
              </li>
            ))}
          </ul>
          {files.length > shown.length && <p className="text-[11px] text-fg-muted">{files.length - shown.length} more.</p>}
        </>
      )}
      <p className="mt-1 text-[11px] text-fg-subtle">{compared}</p>
    </section>
  );
}

/** What the agent reported doing in this session, and what git shows that it did not report. */
export function ActivityPanel({ messages, transcript, session, isRepository, isBusy, version, headStats, headStatsFailed, onJump, onOpenDiff, onClose }: ActivityPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const startCommit = session.worktree?.startCommit;
  const deferredMessages = useDeferredValue(messages);
  const list = useMemo(() => (transcript === "ready" ? activityOf(deferredMessages ?? []) : null), [deferredMessages, transcript]);

  const { targets, isLoaded, hasFailed: targetsFailed } = useDiffTargets(session.cwd, isRepository, version, ignoreError);
  const since = useDiffStatsSince(isRepository ? session.cwd : undefined, startCommit, version, ignoreError);
  const stats = startCommit ? since.stats : headStats;
  const statsFailed = startCommit ? since.hasFailed : headStatsFailed;

  const entries = list?.entries ?? [];
  const counts = (id: Filter) => (id === "all" ? entries.length : entries.filter((entry) => entry.kind === id).length);
  const matching = filter === "all" ? entries : entries.filter((entry) => entry.kind === filter);
  const shown = matching.slice(-MAX_ACTIVITY_ROWS).reverse();

  const hasCheck = isRepository && !session.historyElsewhere && list !== null && isLoaded && !targetsFailed && stats !== null && !statsFailed;
  const showsFiles = filter === "all" || filter === "file";

  return (
    <aside aria-label="Activity panel" className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface-1 text-xs text-fg-secondary">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium text-fg">Activity</h2>
        <IconButton label="Close activity panel" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </header>
      <p className="border-b border-border px-3 py-1.5 text-[11px] text-fg-muted">
        Agents report this themselves. Zorvo can only check file changes against git.
      </p>
      <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            aria-label={`${label}, ${counts(id)}`}
            onClick={() => setFilter(id)}
            className={`focus-ring rounded-md px-1.5 py-0.5 text-[11px] ${filter === id ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface-hover"}`}
          >
            {label} {counts(id)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list === null ? (
          <p className="px-3 py-3 text-fg-muted">
            {transcript === "failed" ? "This conversation could not be read, so its activity is not shown." : "Reading the activity…"}
          </p>
        ) : (
          <>
            {showsFiles && session.historyElsewhere && (
              <p className="border-b border-border px-3 py-2 text-[11px] text-fg-muted">Earlier work stays in the agent, so it is not checked.</p>
            )}
            {showsFiles && isRepository && !session.historyElsewhere && (targetsFailed || statsFailed) && (
              <p className="border-b border-border px-3 py-2 text-[11px] text-fg-muted">Could not check against git.</p>
            )}
            {showsFiles && hasCheck && stats && (
              <Unreported
                files={unreportedFiles(entries, stats, targets, session.cwd)}
                compared={startCommit ? "Compared since this worktree began." : "Compared with uncommitted changes."}
                onOpenDiff={onOpenDiff}
              />
            )}
            {entries.length === 0 ? (
              <p className="px-3 py-3 text-fg-muted">Nothing yet. What the agent does shows here.</p>
            ) : (
              <ul>
                {shown.map((entry, index) => (
                  <ActivityEntryRow key={`${entry.messageId}:${matching.length - index}`} entry={entry} isBusy={isBusy} onJump={onJump} />
                ))}
              </ul>
            )}
            {matching.length > shown.length && (
              <p className="px-3 py-2 text-[11px] text-fg-muted">{matching.length - shown.length} older entries are not shown.</p>
            )}
            {filter === "all" && list.otherTools > 0 && (
              <p className="px-3 py-2 text-[11px] text-fg-muted">
                {list.otherTools === 1 ? "1 other tool call is not listed." : `${list.otherTools} other tool calls are not listed.`}
              </p>
            )}
          </>
        )}
      </div>
      <p className="border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">Rewinding removes activity from this list.</p>
    </aside>
  );
}
