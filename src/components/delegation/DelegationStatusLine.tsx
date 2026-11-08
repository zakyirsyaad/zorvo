import { CircleAlert } from "lucide-react";
import { formatElapsed } from "../../lib/background-tasks";
import type { DelegationView } from "../../hooks/useDelegation";
import { Button } from "../ui/Button";

export interface DelegationStatusLineProps {
  view: DelegationView;
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
}

/** The soft 4px ring the turn status gives its running dot. */
const RUNNING_DOT = "size-1.5 shrink-0 rounded-full bg-status-running ring-4 ring-status-running/20";
const ATTENTION_DOT = "size-1.5 shrink-0 rounded-full bg-status-attention";

/**
 * The delegation's line under the chat: A's while B works, waits for an answer
 * or fails, and B's while A works on its report. The text lives in an
 * always-mounted status region, so a change is announced; the region stays
 * mounted, empty, when there is no line.
 */
export function DelegationStatusLine({
  view,
  now,
  onOpen,
  canAct,
  delegateAgentName,
}: DelegationStatusLineProps) {
  const sessionId = view.otherSessionId;
  const open =
    canAct && sessionId !== null ? (
      <Button variant="ghost" size="sm" tone="secondary" onClick={() => onOpen(sessionId)}>
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
      <div className="flex items-center gap-2.5 py-1">
        <span data-delegation-dot="" aria-hidden="true" className={RUNNING_DOT} />
        <span className="text-ui text-fg-secondary">
          {view.agentName} is working on the task you delegated
        </span>
        {elapsed}
        {open}
      </div>
    );
  } else if (view.role === "source" && view.state === "needs-answer") {
    line = (
      <div className="flex items-center gap-2.5 py-1">
        <span data-delegation-dot="" aria-hidden="true" className={ATTENTION_DOT} />
        <span className="text-ui text-fg-secondary">{view.agentName} needs your answer</span>
        {open}
      </div>
    );
  } else if (view.role === "source" && view.state === "failed") {
    line = (
      <div className="flex items-center gap-2.5 py-1">
        <CircleAlert data-delegation-alert="" size={14} aria-hidden="true" className="shrink-0 text-danger" />
        <span className="text-ui text-fg-secondary">{view.agentName}'s turn failed</span>
        {open}
      </div>
    );
  } else if (view.state === "source-working") {
    line = (
      <div className="flex items-center gap-2.5 py-1">
        <span data-delegation-dot="" aria-hidden="true" className={RUNNING_DOT} />
        <span className="text-ui text-fg-secondary">
          {view.agentName} is working on {delegateAgentName ? `${delegateAgentName}'s` : "the"} report
        </span>
        {elapsed}
        {open}
      </div>
    );
  }

  return (
    <div role="status" className="mx-auto w-full max-w-chat">
      {line}
    </div>
  );
}
