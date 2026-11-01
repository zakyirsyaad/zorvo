import { useState } from "react";
import { ActionCard } from "../ActionCard";
import { AgentLogo } from "../AgentLogo";
import { Button } from "../ui/Button";
import { useDiffStatsSince } from "../../hooks/useDiffStats";
import { formatLineCount, MINUS, totalsOf } from "../../lib/diff-stats";
import { rowStatus, statusLabel, type RowFacts, type RunRowStatus } from "../../lib/compare-run";

export interface CompareRunRowProps {
  facts: RowFacts;
  agentName: string;
  /** Bumped when a turn ends, so the numbers are read again. */
  version: number;
  /** Another pick is under way, or this one is being confirmed elsewhere. */
  isPickDisabled: boolean;
  onOpen: (sessionId: string) => void;
  onChoose: (sessionId: string, cardId: string, optionId: string) => void;
  onPick: (sessionId: string) => void;
}

const STATUS_STYLES: Record<RunRowStatus, string> = {
  starting: "text-fg-muted",
  working: "text-status-running",
  "needs-you": "text-status-attention",
  "needs-sign-in": "text-status-attention",
  failed: "text-danger",
  done: "text-fg-secondary",
  stopped: "text-fg-muted",
};

/** What the agent changed in its worktree since the run began, or — when that cannot be read. */
function Changes({ facts, version, status }: { facts: RowFacts; version: number; status: RunRowStatus }) {
  const { cwd, worktree } = facts.session;
  const [error, setError] = useState<string | null>(null);
  // Read through the agent's folder: from a subfolder it is the known workspace, not the worktree's root.
  // A status change reads again too: a Stop or an exit between turns brings no turn end to bump `version`.
  const { stats } = useDiffStatsSince(cwd, worktree?.startCommit, `${version}:${status}`, setError);
  if (!stats) {
    return (
      <span className="text-xs text-fg-muted" title={error ?? undefined}>
        —
      </span>
    );
  }
  const { added, removed } = totalsOf(stats);
  return (
    <span className="flex items-center gap-2 text-xs text-fg-muted">
      <span>{stats.length === 1 ? "1 file" : `${formatLineCount(stats.length)} files`}</span>
      <span className="text-status-running">+{formatLineCount(added)}</span>
      <span className="text-danger">
        {MINUS}
        {formatLineCount(removed)}
      </span>
    </span>
  );
}

/** One agent of a compare run: its state, what it changed, and a way to open or keep it. */
export function CompareRunRow({ facts, agentName, version, isPickDisabled, onOpen, onChoose, onPick }: CompareRunRowProps) {
  const { session, pendingCard } = facts;
  const status = rowStatus(facts);
  return (
    <li aria-label={agentName} className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          aria-label={`Open ${agentName}`}
          icon={<AgentLogo profileId={session.profileId} name="" size={14} />}
          className="-ml-3"
          onClick={() => onOpen(session.id)}
        >
          {agentName}
        </Button>
        <span className={`text-xs font-medium ${STATUS_STYLES[status]}`}>{statusLabel(status)}</span>
        <div className="ml-auto flex items-center gap-3">
          <Changes facts={facts} version={version} status={status} />
          <Button aria-label={`Pick ${agentName}`} variant="primary" disabled={isPickDisabled} onClick={() => onPick(session.id)}>
            Pick
          </Button>
        </div>
      </div>
      {pendingCard && (
        <ActionCard card={pendingCard} onChoose={(optionId) => onChoose(session.id, pendingCard.id, optionId)} />
      )}
    </li>
  );
}
