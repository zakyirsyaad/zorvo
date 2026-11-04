import { memo, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDot, ListTodo } from "lucide-react";
import { StatusLine } from "../ui/StatusLine";
import { formatElapsed } from "../../lib/background-tasks";
import type { PlanEntry } from "../../types";

/**
 * The agent's streamed reasoning: a quiet row with a chevron, collapsed by
 * default so the answer stays in focus. "Thinking" while the reply streams,
 * "Thought" once it is done.
 */
export const ThinkingBlock = memo(function ThinkingBlock({ text, isDone = false }: { text: string; isDone?: boolean }) {
  return (
    <details className="group mb-2 text-xs">
      <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 text-fg-subtle hover:text-fg-secondary [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span>{isDone ? "Thought" : "Thinking"}</span>
      </summary>
      <p className="mt-1.5 ml-[7px] whitespace-pre-wrap border-l border-border pl-3 leading-relaxed text-fg-muted">
        {text}
      </p>
    </details>
  );
});

/** Shown under the last message while the agent works on its turn. */
const TICK_MS = 1000;

/** "Claude Code is working" with the time since your message, under the last message while a turn runs. */
export function WorkingIndicator({ agentName, since }: { agentName: string; since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [since]);
  return (
    <div data-testid="agent-working" role="status" className="mx-auto w-full max-w-3xl px-1">
      <StatusLine status="running" className="text-ui-sm text-fg-muted">
        {agentName} is working
        {/* Hidden from the live region: a time that ticks every second would be read out every second. */}
        {since !== undefined && (
          <span aria-hidden="true" className="ml-1.5 tabular-nums">
            {formatElapsed(Math.max(0, now - since))}
          </span>
        )}
      </StatusLine>
    </div>
  );
}

const PLAN_ICON: Record<PlanEntry["status"], typeof Circle> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
};

const PLAN_TONE: Record<PlanEntry["status"], string> = {
  pending: "text-fg-subtle",
  in_progress: "text-fg",
  completed: "text-status-running",
};

/** The agent's current plan, one line per step with its status. */
export function PlanList({ entries }: { entries: PlanEntry[] }) {
  return (
    <ul aria-label="Plan" className="mb-3 space-y-1 rounded-lg border border-border bg-bg px-3 py-2">
      {entries.map((entry, index) => {
        const Icon = PLAN_ICON[entry.status];
        return (
          <li key={`${index}-${entry.content}`} className="flex items-start gap-2 text-xs text-fg-secondary">
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${PLAN_TONE[entry.status]}`} aria-label={entry.status} />
            <span className={entry.status === "completed" ? "text-fg-subtle line-through" : ""}>
              {entry.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A reply that carried a plan. The current steps live in the top bar's plan
 * menu, so the conversation keeps one quiet line, which opens the steps this
 * reply reported.
 */
export function PlanUpdatedRow({ entries }: { entries: PlanEntry[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded text-xs text-fg-subtle hover:text-fg-secondary focus-ring"
      >
        <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
        Updated the plan
        <Chevron className="h-3 w-3" aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="mt-2">
          <PlanList entries={entries} />
        </div>
      )}
    </div>
  );
}
