import { useState } from "react";
import { AgentTile } from "../ui/AgentTile";
import { Button } from "../ui/Button";
import { PathText } from "../ui/PathText";
import { StatusLine } from "../ui/StatusLine";
import { useDiffStatsSince } from "../../hooks/useDiffStats";
import { formatLineCount, MINUS, totalsOf, type FileStat } from "../../lib/diff-stats";
import { rowStatus, rowStatusWords, runStatusDot, type RowFacts } from "../../lib/compare-run";
import { columnFiles, columnRequest, moreFilesLabel, type ColumnRequest } from "../../lib/compare-column";

export interface CompareRunRowProps {
  facts: RowFacts;
  agentName: string;
  /** Bumped when a turn ends, so the numbers are read again. */
  version: number;
  /** Another pick is under way. */
  isPickDisabled: boolean;
  /** This row's Pick opened the confirm bar. */
  isPicking: boolean;
  /** The confirm bar Pick opens. */
  confirmBarId?: string;
  /** The panel's clock, for the time in the status words. */
  now: number;
  onOpen: (sessionId: string) => void;
  /** Opens the session with its diff beside the chat. */
  onReview: (sessionId: string) => void;
  onChoose: (sessionId: string, cardId: string, optionId: string, answers?: Record<string, string>) => void;
  onPick: (sessionId: string) => void;
}

/** Why Pick is off on a row whose worktree holds nothing. */
const NO_CHANGES_TITLE = "No changes to keep yet";

interface ChangesProps {
  stats: FileStat[] | null;
  error: string | null;
  agentName: string;
  onReview: () => void;
}

/** What the agent changed in its worktree since the run began, or — when that cannot be read. With changes, the numbers open them. */
function Changes({ stats, error, agentName, onReview }: ChangesProps) {
  if (!stats) {
    return (
      <span className="flex h-6 items-center text-ui-sm text-fg-muted" title={error ?? undefined}>
        —
      </span>
    );
  }
  if (stats.length === 0) return <span className="flex h-6 items-center text-ui-sm text-fg-subtle">No changes yet</span>;
  const { added, removed } = totalsOf(stats);
  const numbers = (
    <>
      <span>{stats.length === 1 ? "1 file" : `${formatLineCount(stats.length)} files`}</span>
      <span className="text-status-running">+{formatLineCount(added)}</span>
      <span className="text-danger">
        {MINUS}
        {formatLineCount(removed)}
      </span>
    </>
  );
  return (
    <button
      type="button"
      aria-label={`Review ${agentName}'s changes`}
      className="-ml-1.5 flex h-6 items-center gap-1.5 self-start rounded-md px-1.5 font-mono text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover focus-ring"
      onClick={onReview}
    >
      {numbers}
    </button>
  );
}

/** The label over a part of a column. */
const LABEL = "text-caption leading-4 text-fg-subtle";

/** Up to three of the files the agent changed, most changed first, then how many more; rows are reserved so every column's next part starts level. */
function FileList({ stats }: { stats: FileStat[] | null }) {
  const { shown, more } = columnFiles(stats ?? []);
  return (
    <div data-column-files="" className="flex min-h-[94px] flex-col gap-0.5">
      {shown.length > 0 && (
        <ul aria-label="Changed files" className="flex flex-col gap-0.5">
          {shown.map((file) => (
            <li key={file.path} className="flex h-6 items-center gap-2 font-mono text-caption text-fg-secondary">
              <PathText path={file.path} className="flex-1" />
              {!file.isBinary && (
                <span className="shrink-0 tabular-nums">
                  <span className="text-status-running">+{formatLineCount(file.added)}</span>{" "}
                  <span className="text-danger">
                    {MINUS}
                    {formatLineCount(file.removed)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className={LABEL}>{moreFilesLabel(more)}</p>}
    </div>
  );
}

interface RequestProps {
  request: ColumnRequest;
  onChoose: (cardId: string, optionId: string) => void;
}

/**
 * What the agent waits for, in the last message's place. A plain permission is answered here, by its reject and
 * allow-once choices under the one line it is about; anything else says what is asked, and Open goes to it.
 */
function Request({ request, onChoose }: RequestProps) {
  return (
    <div data-column-request={request.kind} className="flex flex-col gap-2">
      <p className={LABEL}>Waiting for your answer</p>
      {request.kind === "plain" ? (
        <>
          <p
            title={request.line}
            className="truncate rounded-md border border-border bg-ground px-2 py-1.5 font-mono text-caption leading-4 text-fg-secondary"
          >
            {request.line}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" tone="secondary" size="row" onClick={() => onChoose(request.cardId, request.reject.optionId)}>
              {request.reject.name}
            </Button>
            <Button variant="outline" size="row" onClick={() => onChoose(request.cardId, request.allowOnce.optionId)}>
              <span className="text-fg">{request.allowOnce.name}</span>
            </Button>
          </div>
        </>
      ) : (
        <p className="line-clamp-3 min-h-[60px] text-ui leading-5 text-fg-secondary">{request.line}</p>
      )}
    </div>
  );
}

/** One agent of a compare run, as a column: its state, what it changed, what it last said or asks, and a way to open or keep it. */
export function CompareRunRow({
  facts,
  agentName,
  version,
  isPickDisabled,
  isPicking,
  confirmBarId,
  now,
  onOpen,
  onReview,
  onChoose,
  onPick,
}: CompareRunRowProps) {
  const { session } = facts;
  const status = rowStatus(facts);
  const [error, setError] = useState<string | null>(null);
  // Read through the agent's folder: from a subfolder it is the known workspace, not the worktree's root.
  // A status change reads again too: a cancelled turn bumps no `version`, and an exit between turns ends no turn.
  const { stats } = useDiffStatsSince(session.cwd, session.worktree?.startCommit, `${version}:${status}`, setError);
  // Only known-empty changes turn Pick off: while they load, or when they cannot be read, the run must stay pickable.
  const hasNoChanges = stats?.length === 0;
  const request = columnRequest(facts.pendingCard, facts.hasOpenForm ? facts.openFormPrompt : null);
  const needsOpening = request?.kind === "open";
  return (
    <li
      aria-label={agentName}
      className={`flex min-w-0 flex-col gap-3.5 rounded-xl border bg-surface-2 p-4 ${isPicking ? "border-border-strong" : "border-border"}`}
    >
      <div className="flex items-center gap-3">
        <AgentTile profileId={session.profileId} name="" size={28} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body leading-5 font-semibold text-fg">{agentName}</span>
          <StatusLine status={runStatusDot(status, facts.hasUnread)} className="text-ui-sm text-fg-muted">
            {rowStatusWords(facts, status, now)}
            {/* The dot is not the only sign of it. */}
            {status === "done" && facts.hasUnread && <span className="sr-only">, unread</span>}
          </StatusLine>
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <Changes stats={stats} error={error} agentName={agentName} onReview={() => onReview(session.id)} />
        <FileList stats={stats} />
      </div>
      {request ? (
        <Request request={request} onChoose={(cardId, optionId) => onChoose(session.id, cardId, optionId)} />
      ) : (
        <div data-column-last-message="" className="flex flex-col gap-2">
          <p className={LABEL}>Last message</p>
          <p className="line-clamp-3 min-h-[60px] text-ui leading-5 text-fg-secondary">{facts.lastMessage ?? ""}</p>
        </div>
      )}
      {/* Pushed to the bottom, so the buttons line up across columns of different lengths. */}
      <div className="mt-auto flex gap-2">
        <Button
          variant="outline"
          // The words on the button are in its name, as Voice Control needs.
          aria-label={needsOpening ? `Open ${agentName} to answer` : `Open ${agentName}`}
          className="flex-1"
          onClick={() => onOpen(session.id)}
        >
          <span className={needsOpening ? "text-fg" : "text-fg-secondary"}>{needsOpening ? "Open to answer" : "Open"}</span>
        </Button>
        <Button
          aria-label={`Pick ${agentName}`}
          variant="outline"
          // It opens the confirm bar, so it says so, rather than turning into a toggle while the bar is open.
          aria-expanded={isPicking}
          aria-controls={isPicking ? confirmBarId : undefined}
          className={`flex-1 ${isPicking ? "bg-surface-hover" : ""}`}
          disabled={isPickDisabled || hasNoChanges}
          title={hasNoChanges ? NO_CHANGES_TITLE : undefined}
          onClick={() => onPick(session.id)}
        >
          <span className="text-fg">Pick</span>
        </Button>
      </div>
    </li>
  );
}
