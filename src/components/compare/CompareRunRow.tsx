import { useState } from "react";
import { ActionCard } from "../ActionCard";
import { AgentLogo } from "../AgentLogo";
import { Button } from "../ui/Button";
import { StatusLine } from "../ui/StatusLine";
import { useDiffStatsSince } from "../../hooks/useDiffStats";
import { formatLineCount, MINUS, totalsOf, type FileStat } from "../../lib/diff-stats";
import { rowStatus, runStatusDot, statusLabel, type RowFacts } from "../../lib/compare-run";

export interface CompareRunRowProps {
  facts: RowFacts;
  agentName: string;
  /** Bumped when a turn ends, so the numbers are read again. */
  version: number;
  /** Another pick is under way. */
  isPickDisabled: boolean;
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
      <span className="text-ui-sm text-fg-muted" title={error ?? undefined}>
        —
      </span>
    );
  }
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
  if (stats.length === 0) return <span className="flex items-center gap-2 text-ui-sm text-fg-muted">{numbers}</span>;
  return (
    <button
      type="button"
      aria-label={`Review ${agentName}'s changes`}
      className="flex items-center gap-2 rounded-md text-ui-sm text-fg-muted transition-colors hover:text-fg-secondary focus-ring"
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
    <li aria-label={agentName} className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-2">
        <AgentLogo profileId={session.profileId} name="" size={16} />
        <span className="text-ui font-medium text-fg">{agentName}</span>
        <StatusLine status={runStatusDot(status)} className="ml-1 text-caption text-fg-muted">
          {statusLabel(status)}
        </StatusLine>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Changes stats={stats} error={error} agentName={agentName} onReview={() => onReview(session.id)} />
        <div className="ml-auto flex items-center gap-2">
          <Button aria-label={`Open ${agentName}`} onClick={() => onOpen(session.id)}>
            Open
          </Button>
          <Button
            aria-label={`Pick ${agentName}`}
            variant="primary"
            disabled={isPickDisabled || hasNoChanges}
            title={hasNoChanges ? NO_CHANGES_TITLE : undefined}
            onClick={() => onPick(session.id)}
          >
            Pick
          </Button>
        </div>
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
