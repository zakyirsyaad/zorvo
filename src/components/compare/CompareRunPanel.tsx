import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { useNow } from "../../hooks/useNow";
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
  const [isPickRunning, setIsPickRunning] = useState(false);
  const now = useNow();
  const panelRef = useRef<HTMLElement>(null);
  const barPickRef = useRef<HTMLButtonElement>(null);
  // Every Pick asks: the question takes focus, or it would come and go unheard below the list.
  useEffect(() => {
    if (confirming !== null) barPickRef.current?.focus();
  }, [confirming]);
  const isBusy = (sessionId: string) => rows.find((row) => row.session.id === sessionId)?.isBusy ?? false;
  const confirmedRow = rows.find((row) => row.session.id === confirming);
  // Read on every render, so the bar stops naming the working agents once they finish while it is open.
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
    setIsPickRunning(true);
    try {
      await onPick(winnerId);
    } finally {
      setIsPickRunning(false);
    }
  };

  const confirmText = confirmedRow
    ? [pickQuestion(agentName(confirmedRow.session.profileId)), working.length > 0 ? stopsLine(working) : ""].filter(Boolean).join(" ")
    : "";

  return (
    <section ref={panelRef} aria-label="Compare run" className="relative flex min-h-0 flex-1 flex-col">
      {/* The bar sits outside the scroller, so it stays put while the cards scroll under it. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-10 pb-28">
        <div className="mx-auto flex w-full max-w-chat flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-fg">{run.name}</h2>
            <p className="text-ui text-fg-muted">
              {run.sessions.length} agents, each in its own worktree · {startedLine(run)}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((facts) => (
              <CompareRunRow
                key={facts.session.id}
                facts={facts}
                agentName={agentName(facts.session.profileId)}
                version={version}
                isPickDisabled={isPickRunning}
                isPicking={confirming === facts.session.id}
                now={now}
                onOpen={onOpen}
                onReview={onReview}
                onChoose={onChoose}
                onPick={setConfirming}
              />
            ))}
          </ul>
        </div>
      </div>
      {confirmedRow && (
        <div
          role="group"
          aria-label="Confirm pick"
          className="absolute inset-x-6 bottom-6 mx-auto flex max-w-chat items-center gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 shadow-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelPick();
          }}
        >
          <p className="min-w-0 flex-1 text-ui text-fg">{confirmText}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" tone="secondary" onClick={cancelPick}>
              Cancel
            </Button>
            <Button ref={barPickRef} variant="primary" onClick={() => void pick(confirmedRow.session.id)}>
              Pick {agentName(confirmedRow.session.profileId)}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
