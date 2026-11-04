import { useState } from "react";
import { Check, Circle, ListTodo, Loader2, type LucideIcon } from "lucide-react";
import { Chip } from "../ui/Chip";
import { Popover, PopoverHeader } from "../ui/Popover";
import { planProgress } from "../../lib/plan";
import type { PlanEntry } from "../../types";

export interface PlanMenuProps {
  plan: readonly PlanEntry[];
  /** The agent the plan comes from, named in the popover's header. */
  source?: string;
}

const STEP: Record<PlanEntry["status"], { icon: LucideIcon; word: string; className: string }> = {
  completed: { icon: Check, word: "Done", className: "text-status-running" },
  in_progress: { icon: Loader2, word: "In progress", className: "text-fg-secondary motion-safe:animate-spin" },
  pending: { icon: Circle, word: "Not started", className: "text-fg-muted" },
};

/**
 * The session's plan as a top bar chip ("Plan 2/4"), so it stays reachable while
 * the conversation scrolls; it opens every step with its state.
 */
export function PlanMenu({ plan, source }: PlanMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { done, total } = planProgress(plan);

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="Plan"
      role="dialog"
      align="end"
      className="w-80 select-text"
      trigger={
        <Chip
          icon={<ListTodo size={12} />}
          label={`Plan, ${done} of ${total} done`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="tabular-nums"
        >
          Plan {done}/{total}
        </Chip>
      }
    >
      <PopoverHeader>{source ? `Plan from ${source}` : "Plan"}</PopoverHeader>
      <p className="px-2 pb-1.5 text-caption text-fg-muted">
        {done} of {total} done
      </p>
      <ul aria-label="Steps" className="max-h-96 overflow-y-auto">
        {plan.map((entry, index) => {
          const step = STEP[entry.status];
          const Icon = step.icon;
          return (
            <li key={`${index}-${entry.content}`} className="flex items-start gap-2 rounded px-2 py-1.5 text-ui">
              <Icon aria-label={step.word} role="img" className={`mt-0.5 size-3.5 shrink-0 ${step.className}`} />
              <span className={entry.status === "completed" ? "text-fg-muted" : "text-fg"}>{entry.content}</span>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
