import { useState } from "react";
import { Circle, CircleCheck, ListChecks, LoaderCircle, type LucideIcon } from "lucide-react";
import { Chip } from "../ui/Chip";
import { Popover, PopoverTitle } from "../ui/Popover";
import { planProgress } from "../../lib/plan";
import type { PlanEntry } from "../../types";

export interface PlanMenuProps {
  plan: readonly PlanEntry[];
  /** The agent the plan comes from, named in the popover's header. */
  source?: string;
}

const STEP: Record<PlanEntry["status"], { icon: LucideIcon; word: string; iconClass: string; textClass: string }> = {
  completed: { icon: CircleCheck, word: "Done", iconClass: "text-fg-muted", textClass: "text-fg-muted" },
  in_progress: {
    icon: LoaderCircle,
    word: "In progress",
    iconClass: "text-status-running motion-safe:animate-spin",
    textClass: "text-fg",
  },
  pending: { icon: Circle, word: "Not started", iconClass: "text-fg-subtle", textClass: "text-fg-secondary" },
};

/**
 * The session's plan as a top bar chip ("2/4"), so it stays reachable while
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
      className="w-[340px] select-text"
      trigger={
        <Chip
          icon={<ListChecks size={12} className="text-fg-muted" />}
          label={`Plan, ${done} of ${total} done`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="font-mono tabular-nums"
        >
          {/* The chip's own text colour is fg-secondary; the count is muted, as drawn. */}
          <span className="text-fg-muted">
            {done}/{total}
          </span>
        </Chip>
      }
    >
      <PopoverTitle aside={`${done} of ${total} done`}>{source ? `Plan from ${source}` : "Plan"}</PopoverTitle>
      <ul aria-label="Steps" className="max-h-96 overflow-y-auto">
        {plan.map((entry, index) => {
          const step = STEP[entry.status];
          const Icon = step.icon;
          const isCurrent = entry.status === "in_progress";
          return (
            <li
              key={`${index}-${entry.content}`}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex min-h-7.5 items-start gap-2.5 rounded-md px-2 py-1.5 text-ui ${isCurrent ? "bg-surface-hover" : ""}`}
            >
              <Icon aria-label={step.word} role="img" className={`mt-0.5 size-3.5 shrink-0 ${step.iconClass}`} />
              <span className={step.textClass}>{entry.content}</span>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
