import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { CompareRunRow } from "./CompareRunRow";
import { othersToStop, type CompareRun, type RowFacts } from "../../lib/compare-run";

export interface CompareRunPanelProps {
  run: CompareRun;
  rows: RowFacts[];
  /** Bumped when a turn ends, so each row reads its numbers again. */
  version: number;
  agentName: (profileId: string) => string;
  onOpen: (sessionId: string) => void;
  onChoose: (sessionId: string, cardId: string, optionId: string) => void;
  /** Keeps this session and archives the others; may take a while, as agents are stopped. */
  onPick: (winnerId: string) => void | Promise<void>;
}

/** The copy of the question asked before agents that are still working are stopped. */
export function stopQuestion(count: number, winnerName: string): string {
  return `Stop ${count} ${count === 1 ? "agent" : "agents"} and keep ${winnerName}'s work?`;
}

/** What a user sees while a compare run is open: every agent's state and changes, and Pick to keep one. */
export function CompareRunPanel({ run, rows, version, agentName, onOpen, onChoose, onPick }: CompareRunPanelProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const isBusy = (sessionId: string) => rows.find((row) => row.session.id === sessionId)?.isBusy ?? false;
  const confirmedRow = rows.find((row) => row.session.id === confirming);
  const workingOthers = (winnerId: string) => othersToStop(run, winnerId, isBusy).filter((s) => isBusy(s.id));
  const workingCount = confirmedRow ? workingOthers(confirmedRow.session.id).length : 0;
  // The agents finished while the question was open: there is nothing left to stop, so it goes and Pick needs one more press.
  useEffect(() => {
    if (confirming !== null && workingCount === 0) setConfirming(null);
  }, [confirming, workingCount]);

  const pick = async (winnerId: string) => {
    setConfirming(null);
    setIsPicking(true);
    try {
      await onPick(winnerId);
    } finally {
      setIsPicking(false);
    }
  };

  // Idle agents are archived without asking; only ones that are working are cut off mid-turn.
  const handlePick = (winnerId: string) => {
    if (workingOthers(winnerId).length === 0) void pick(winnerId);
    else setConfirming(winnerId);
  };

  return (
    <section aria-label="Compare run" className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="text-base font-semibold text-fg">{run.name}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Compare what each agent did, then pick the one to keep. The others are archived and their worktrees stay.
        </p>
        <ul className="mt-4 rounded-xl border border-border bg-surface-1">
          {rows.map((facts) => (
            <CompareRunRow
              key={facts.session.id}
              facts={facts}
              agentName={agentName(facts.session.profileId)}
              version={version}
              isPickDisabled={isPicking}
              onOpen={onOpen}
              onChoose={onChoose}
              onPick={handlePick}
            />
          ))}
        </ul>
        {confirmedRow && workingCount > 0 && (
          <div
            role="group"
            aria-label="Confirm pick"
            className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-attention-border bg-attention-surface px-4 py-3"
          >
            <p className="text-sm text-fg">{stopQuestion(workingCount, agentName(confirmedRow.session.profileId))}</p>
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void pick(confirmedRow.session.id)}>
                Stop and pick
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
