import { useRef, useState } from "react";
import { ListTodo } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { PlanList } from "../chat/ReplyExtras";
import { useDismiss } from "../../hooks/useDismiss";
import { planProgress } from "../../lib/plan";
import type { PlanEntry } from "../../types";

export interface PlanMenuProps {
  plan: readonly PlanEntry[];
}

/**
 * The session's plan, kept in the top bar so it stays reachable while the
 * conversation scrolls. The button carries the done count ("2/4") as a corner badge, like Background tasks.
 */
export function PlanMenu({ plan }: PlanMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { done, total } = planProgress(plan);
  useDismiss(ref, isOpen, () => setIsOpen(false));
  const count = `${done}/${total}`;

  // The badge starts at the icon's middle and grows to the right, so it never
  // covers the icon; the margin keeps it off the next button.
  return (
    <div ref={ref} className={`relative ${count.length > 3 ? "mr-5" : "mr-2.5"}`}>
      <IconButton
        label={`Plan (${done} of ${total} done)`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="relative"
      >
        <ListTodo size={14} aria-hidden="true" className={isOpen ? "text-fg" : undefined} />
        <span
          aria-hidden="true"
          className="absolute left-1/2 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface-3 px-1 text-[9px] font-medium tabular-nums text-fg-secondary ring-1 ring-border"
        >
          {count}
        </span>
      </IconButton>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Plan"
          className="absolute right-0 top-full z-50 mt-1 w-96 rounded-lg border border-border bg-surface-3 p-1 shadow-popover select-text"
        >
          <div className="max-h-96 overflow-y-auto px-1 py-1">
            <PlanList entries={[...plan]} />
          </div>
        </div>
      )}
    </div>
  );
}