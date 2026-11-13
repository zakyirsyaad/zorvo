import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import { formatElapsed } from "../../lib/background-tasks";
import type { DelegationView } from "../../hooks/useDelegation";
import { Button } from "../ui/Button";

export interface DelegationStatusLineProps {
  /** null while the session is in no delegation: the region stays mounted, empty. */
  view: DelegationView | null;
  /** Fixes the time since the working turn started, so a test can pin it. */
  now: number;
  onOpen: (sessionId: string) => void;
  /** False in popouts, whose lines have no Open. */
  canAct: boolean;
  /**
   * B's own agent name, which B's line names as the report's owner
   * ("Claude Code is working on Codex's report").
   */
  delegateAgentName?: string;
  /**
   * Draw no line, but keep the status region mounted and empty: the host hides
   * the line while the line does not apply (a turn of the session itself),
   * not the region, which would then announce nothing when it appears.
   */
  hidden?: boolean;
}

/** A quiet line while a turn runs: the arc, the sentence, the time, Open. */
const LINE = "flex items-center gap-2 py-1";
/** A card when the delegation waits for the user or failed: its icon, a titled sentence, Open. */
const CARD = "flex items-center gap-2.5 rounded-xl border px-3 py-2.5";
const CARD_TITLE = "min-w-0 flex-1 text-ui font-semibold text-fg";

/** The running arc, as a tool row shows it; still while the user asks for less motion. */
function RunningArc() {
  return (
    <LoaderCircle
      data-delegation-arc=""
      size={14}
      aria-hidden="true"
      className="shrink-0 text-status-running motion-safe:animate-spin"
    />
  );
}

/**
 * The delegation's line under the chat: A's while B works, a card when B waits
 * for an answer or fails, and B's line while A works on its report. The text lives in an
 * always-mounted status region, so a change is announced; the region stays
 * mounted, empty, when there is no line.
 */
export function DelegationStatusLine({
  view,
  now,
  onOpen,
  canAct,
  delegateAgentName,
  hidden = false,
}: DelegationStatusLineProps) {
  // Mounted before any delegation, so the first line is announced when it appears.
  if (view === null) return <div role="status" className="sr-only" />;
  const sessionId = view.otherSessionId;
  const open =
    canAct && sessionId !== null ? (
      <Button variant="ghost" size="sm" tone="secondary" onClick={() => onOpen(sessionId)}>
        Open
      </Button>
    ) : null;
  // A card's Open is its one action, so it is drawn as one.
  const cardOpen =
    canAct && sessionId !== null ? (
      <Button variant="outline" size="md" onClick={() => onOpen(sessionId)}>
        Open
      </Button>
    ) : null;

  const elapsed =
    view.workingSince === null ? null : (
      // Hidden from the live region: a time that ticks every second would be read out every second.
      <span aria-hidden="true" className="text-caption text-fg-subtle tabular-nums">
        {formatElapsed(Math.max(0, now - view.workingSince))}
      </span>
    );

  let line = null;
  if (view.role === "source" && view.state === "working") {
    line = (
      <div className={LINE}>
        <RunningArc />
        <span className="text-ui text-fg-muted">
          {view.agentName} is working on the task you delegated
        </span>
        {elapsed}
        {open}
      </div>
    );
  } else if (view.role === "source" && view.state === "needs-answer") {
    line = (
      <div data-delegation-card="needs-answer" className={`${CARD} border-attention-border bg-attention-surface`}>
        <TriangleAlert data-delegation-alert="" size={14} aria-hidden="true" className="shrink-0 text-status-attention" />
        <span className={CARD_TITLE}>{view.agentName} needs your answer</span>
        {cardOpen}
      </div>
    );
  } else if (view.role === "source" && view.state === "failed") {
    line = (
      <div data-delegation-card="failed" className={`${CARD} border-danger bg-danger-surface`}>
        <CircleAlert data-delegation-alert="" size={14} aria-hidden="true" className="shrink-0 text-danger" />
        <span className={CARD_TITLE}>{view.agentName}'s turn failed</span>
        {cardOpen}
      </div>
    );
  } else if (view.state === "source-working") {
    line = (
      <div className={LINE}>
        <RunningArc />
        <span className="text-ui text-fg-muted">
          {view.agentName} is working on {delegateAgentName ? `${delegateAgentName}'s` : "the"} report
        </span>
        {elapsed}
        {open}
      </div>
    );
  }
  if (hidden) line = null;

  return (
    // Out of the flow while it draws no line: mounted for the announcement, adding no row to the chat.
    <div role="status" className={line === null ? "sr-only" : "mx-auto w-full max-w-chat"}>
      {line}
    </div>
  );
}
