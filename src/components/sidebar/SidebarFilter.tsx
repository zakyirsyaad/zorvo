import type { SidebarFilter as FilterValue } from "../../lib/sidebar-status";
import { segmentedItem } from "../ui/segmented-style";

export interface SidebarFilterProps {
  value: FilterValue;
  counts: { needsYou: number; working: number };
  onChange: (next: FilterValue) => void;
}

/**
 * Three toggle buttons under the search row: All, Needs you and Working. Pressing the pressed
 * one again goes back to All. A count shows only above zero, and the filter never changes which
 * session is open.
 */
export function SidebarFilter({ value, counts, onChange }: SidebarFilterProps) {
  const toggle = (next: Exclude<FilterValue, "all">) => onChange(value === next ? "all" : next);
  return (
    <div role="group" aria-label="Filter sessions" className="flex gap-0.5">
      <button type="button" aria-pressed={value === "all"} onClick={() => onChange("all")} className={segmentedItem(value === "all")}>
        All
      </button>
      <button
        type="button"
        aria-pressed={value === "needs-you"}
        onClick={() => toggle("needs-you")}
        className={segmentedItem(value === "needs-you")}
      >
        Needs you
        {counts.needsYou > 0 && (
          <>
            {/* A space for the accessible name; the flex gap draws the visible one. */}{" "}
            <span className="font-semibold text-status-attention">{counts.needsYou}</span>
          </>
        )}
      </button>
      <button
        type="button"
        aria-pressed={value === "working"}
        onClick={() => toggle("working")}
        className={segmentedItem(value === "working")}
      >
        Working
        {counts.working > 0 && (
          <>
            {" "}
            <span className="text-fg-subtle">{counts.working}</span>
          </>
        )}
      </button>
    </div>
  );
}
