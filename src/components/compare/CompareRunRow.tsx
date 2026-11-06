import { useState } from "react";
import { ActionCard } from "../ActionCard";
import { AgentLogo } from "../AgentLogo";
import { Button } from "../ui/Button";
import { StatusLine } from "../ui/StatusLine";
import { useDiffStatsSince } from "../../hooks/useDiffStats";
import { formatLineCount, MINUS, totalsOf, type FileStat } from "../../lib/diff-stats";
import { rowStatus, rowStatusWords, runStatusDot, type RowFacts } from "../../lib/compare-run";

export interface CompareRunRowProps {
  facts: RowFacts;
  agentName: string;
  /** Bumped when a turn ends, so the numbers are read again. */
  version: number;
  /** Another pick is under way. */
  isPickDisabled: boolean;
  /** This row's Pick opened the confirm bar. */
  isPicking: boolean;
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
      <span className="shrink-0 px-2 text-ui-sm text-fg-muted" title={error ?? undefined}>
        —
      </span>
    );
  }
  if (stats.length === 0) return <span className="shrink-0 px-2 text-ui-sm text-fg-subtle">No changes yet</span>;
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
      className="flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-caption text-fg-muted transition-colors hover:bg-surface-hover focus-ring"
      onClick={onReview}
    >
      {numbers}
    </button>
  );
}

/** One agent of a compare run, as a card: its state, what it changed, and a way to open or keep it. */
export function CompareRunRow({
  facts,
  agentName,
  version,
  isPickDisabled,
  isPicking,
  now,
  onOpen,
  onReview,
  onChoose,
  onPick,
}: CompareRunRowProps) {
  const { session, pendingCard } = facts;
  const status = rowStatus(facts);
  const [error, setError] = useState<string | null>(null);
  // Read through the agent's folder: from a subfolder it is the known workspace, not the worktree's root.
  // A status change reads again too: a cancelled turn bumps no `version`, and an exit between turns ends no turn.
  const { stats } = useDiffStatsSince(session.cwd, session.worktree?.startCommit, `${version}:${status}`, setError);
  // Only known-empty changes turn Pick off: while they load, or when they cannot be read, the run must stay pickable.
  const hasNoChanges = stats?.length === 0;
  return (
    <li
      aria-label={agentName}
      className={`flex flex-col gap-3 rounded-xl border bg-surface-2 px-4 py-3.5 ${isPicking ? "border-border-strong" : "border-border"}`}
    >
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-hover">
          <AgentLogo profileId={session.profileId} name="" size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-medium text-fg">{agentName}</span>
          <StatusLine status={runStatusDot(status, facts.hasUnread)} className="text-ui-sm text-fg-secondary">
            {rowStatusWords(facts, status, now)}
          </StatusLine>
        </span>
        <Changes stats={stats} error={error} agentName={agentName} onReview={() => onReview(session.id)} />
        <Button variant="ghost" tone="secondary" aria-label={`Open ${agentName}`} onClick={() => onOpen(session.id)}>
          Open
        </Button>
        <Button
          aria-label={`Pick ${agentName}`}
          variant="outline"
          aria-pressed={isPicking || undefined}
          className={isPicking ? "bg-surface-hover" : undefined}
          disabled={isPickDisabled || hasNoChanges}
          title={hasNoChanges ? NO_CHANGES_TITLE : undefined}
          onClick={() => onPick(session.id)}
        >
          <span className={isPicking ? "text-fg" : undefined}>Pick</span>
        </Button>
      </div>
      {pendingCard && (
        <ActionCard
          card={pendingCard}
          agentName={agentName}
          onChoose={(optionId, answers) =>
            answers ? onChoose(session.id, pendingCard.id, optionId, answers) : onChoose(session.id, pendingCard.id, optionId)
          }
        />
      )}
    </li>
  );
}
