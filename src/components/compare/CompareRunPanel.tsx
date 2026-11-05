import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CompareRunRow } from "./CompareRunRow";
import { othersToStop, pickQuestion, stopsLine, type CompareRun, type RowFacts } from "../../lib/compare-run";
import { formatRelativeTime } from "../../lib/relative-time";

export interface CompareRunPanelProps {
  run: CompareRun;
  rows: RowFacts[];
  /** Bumped when a turn ends, so each row reads its numbers again. */
  version: number;
  agentName: (profileId: string) => string;
  onOpen: (sessionId: string) => void;
  /** Opens the session with its diff beside the chat. */
  onReview: (sessionId: string) => void;
  onChoose: (sessionId: string, cardId: string, optionId: string, answers?: Record<string, string>) => void;
  /** Keeps this session and archives the others; may take a while, as agents are stopped. */
  onPick: (winnerId: string) => void | Promise<void>;
}

/** "started 12 minutes ago", from the run's oldest session. */
function startedLine(run: CompareRun): string {
  const ago = formatRelativeTime(run.sessions[0]?.createdAt ?? Date.now());
  return `started ${ago.charAt(0).toLowerCase()}${ago.slice(1)}`;
}

/** What a user sees while a compare run is open: one card per agent, and Pick to keep one. */
export function CompareRunPanel({ run, rows, version, agentName, onOpen, onReview, onChoose, onPick }: CompareRunPanelProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const barPickRef = useRef<HTMLButtonElement>(null);
  // Every Pick asks: the question takes focus, or it would come and go unheard below the list.
  useEffect(() => {
    if (confirming !== null) barPickRef.current?.focus();
  }, [confirming]);
  const isBusy = (sessionId: string) => rows.find((row) => row.session.id === sessionId)?.isBusy ?? false;
  const confirmedRow = rows.find((row) => row.session.id === confirming);
  // Read on every render, so the bar's second line goes when the working agents finish while it is open.
  const working = confirmedRow
    ? othersToStop(run, confirmedRow.session.id, isBusy)
        .filter((session) => isBusy(session.id))
        .map((session) => agentName(session.profileId))
    : [];

  /** Closes the question and hands focus back to the row's Pick that asked it. */
  const cancelPick = () => {
    const name = confirmedRow ? agentName(confirmedRow.session.profileId) : null;
    setConfirming(null);
    if (name) panelRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="Pick ${CSS.escape(name)}"]`)?.focus();
  };

  const pick = async (winnerId: string) => {
    setConfirming(null);
    setIsPicking(true);
    try {
      await onPick(winnerId);
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <section ref={panelRef} aria-label="Compare run" className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="text-xl font-semibold text-fg">{run.name}</h2>
        <p className="mt-1 text-ui-sm text-fg-muted">
          {run.sessions.length} agents, each in its own worktree · {startedLine(run)}
        </p>
        <ul className="mt-5 space-y-3">
          {rows.map((facts) => (
            <CompareRunRow
              key={facts.session.id}
              facts={facts}
              agentName={agentName(facts.session.profileId)}
              version={version}
              isPickDisabled={isPicking}
              onOpen={onOpen}
              onReview={onReview}
              onChoose={onChoose}
              onPick={setConfirming}
            />
          ))}
        </ul>
        {confirmedRow && (
          <div
            role="group"
            aria-label="Confirm pick"
            className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-border-strong bg-surface-2 p-4 shadow-popover"
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelPick();
            }}
          >
            <div className="min-w-0">
              <p className="text-ui text-fg">{pickQuestion(agentName(confirmedRow.session.profileId))}</p>
              {working.length > 0 && <p className="mt-0.5 text-ui-sm text-fg-muted">{stopsLine(working)}</p>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={cancelPick}>
                Cancel
              </Button>
              <Button ref={barPickRef} variant="primary" onClick={() => void pick(confirmedRow.session.id)}>
                Pick {agentName(confirmedRow.session.profileId)}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
