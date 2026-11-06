import { memo, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { MINUS } from "../../lib/diff-stats";
import type { UnifiedRow, UnifiedRowKind } from "../../lib/git-changes";
import { quoteOf } from "../../lib/review-comments";

/** How roomy the rows are: `review` in the full diff review, `card` in a Changes card. */
export type DiffDensity = "card" | "review";

// Only the fill says what a row is; its text stays fg-secondary, as drawn.
const ROW_STYLE: Record<UnifiedRowKind, string> = {
  added: "bg-diff-added text-fg-secondary",
  removed: "bg-diff-removed text-fg-secondary",
  context: "text-fg-secondary",
  hunk: "text-fg-subtle",
  note: "text-fg-subtle italic",
};

const ROW_SIGN: Record<UnifiedRowKind, string> = { added: "+", removed: MINUS, context: " ", hunk: "", note: "" };

const ROW_KIND: Record<UnifiedRowKind, string> = { added: "added", removed: "removed", context: "unchanged", hunk: "", note: "" };

const GUTTER: Record<DiffDensity, string> = {
  review: "w-10 shrink-0 select-none pr-2 text-right tabular-nums text-fg-subtle",
  card: "w-[30px] shrink-0 select-none pr-2 text-right tabular-nums text-fg-subtle",
};
const SIGN: Record<DiffDensity, string> = {
  review: "w-4 shrink-0 select-none text-fg-subtle",
  card: "w-3.5 shrink-0 select-none text-fg-subtle",
};
// The review is flush in its file section; a card caps a long diff.
const LIST: Record<DiffDensity, string> = {
  review: "overflow-x-auto py-2 font-mono text-ui-sm leading-5 text-fg-secondary",
  card: "max-h-80 overflow-auto py-1 font-mono text-caption leading-[18px] text-fg-secondary",
};
/** As wide as its line, so the control beside it stays in view when the diff scrolls sideways. */
const GRID_ROW = "w-max min-w-full";
/** The row the arrow keys are on: the grid holds the focus, so the row has to show it. */
const ACTIVE_ROW = "group-focus-visible/grid:shadow-[inset_2px_0_0_var(--color-fg)]";

/** What rows need to take comments. With it the diff is a grid, one Tab stop, with one control for the row in use. */
export interface RowReview {
  /** Whether the row can take a new comment now: it has a line, and no open box. */
  canComment: (row: UnifiedRow) => boolean;
  openBox: (row: UnifiedRow) => void;
  /** What sits under a row, as rows of the grid; `onDone` takes the focus back when one of them closes. */
  under: (row: UnifiedRow, onDone: () => void) => ReactNode;
}

/** Stable across a refresh, unlike the index: an open box stays with its line. */
function rowKeyOf(row: UnifiedRow, index: number): string {
  if (row.newLine !== undefined) return `new:${row.newLine}`;
  return row.oldLine !== undefined ? `old:${row.oldLine}` : `row:${index}`;
}

const lineOf = (row: UnifiedRow) => row.newLine ?? row.oldLine;

function rowName(row: UnifiedRow): string {
  const text = quoteOf(row.text);
  if (row.kind === "hunk") return `Section: ${text}`;
  if (row.kind === "note") return `Note: ${text}`;
  return `Line ${lineOf(row)}, ${ROW_KIND[row.kind]}: ${text}`;
}

const DiffRow = memo(function DiffRow({ row, density, rowKey, rowId, isActive, control, under }: {
  row: UnifiedRow;
  density: DiffDensity;
  rowKey: string;
  /** Set when the rows form a grid. */
  rowId?: string;
  isActive: boolean;
  control: ReactNode;
  under: ReactNode;
}) {
  const isGridRow = rowId !== undefined;
  return (
    <>
      <div
        id={rowId}
        role={isGridRow ? "row" : undefined}
        aria-label={isGridRow ? rowName(row) : undefined}
        data-row={isGridRow ? rowKey : undefined}
        data-line={row.kind}
        className={`flex whitespace-pre pr-2 ${ROW_STYLE[row.kind]}${isGridRow ? ` ${GRID_ROW}` : ""}${isActive ? ` ${ACTIVE_ROW}` : ""}`}
      >
        {control}
        {density === "review" ? (
          <>
            <span aria-hidden="true" className={GUTTER.review}>
              {row.oldLine}
            </span>
            <span aria-hidden="true" className={GUTTER.review}>
              {row.newLine}
            </span>
          </>
        ) : (
          // One gutter in a card: the new number, or the old one for a removed line.
          <span aria-hidden="true" className={GUTTER.card}>
            {row.newLine ?? row.oldLine}
          </span>
        )}
        <span aria-hidden="true" className={SIGN[density]}>
          {ROW_SIGN[row.kind]}
        </span>
        <span role={isGridRow ? "gridcell" : undefined}>{row.text}</span>
      </div>
      {under && (
        // A sticky box travels only inside its parent, and the grid is the one parent as wide as the long lines.
        <div id={`${rowId}-under`} role="rowgroup" className="sticky left-0">
          {under}
        </div>
      )}
    </>
  );
});

/** A unified diff as rows with old and new line numbers. */
export function DiffRows({ rows, label, review, density = "review" }: {
  rows: UnifiedRow[];
  label: string;
  review?: RowReview;
  density?: DiffDensity;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const boxToFocus = useRef<string | null>(null);
  const idPrefix = useId();
  const keys = useMemo(() => rows.map(rowKeyOf), [rows]);
  const activeIndex = activeKey === null ? -1 : keys.indexOf(activeKey);
  const rowIdOf = (key: string) => `${idPrefix}${key}`;

  const focusBoxOf = (key: string) => {
    const box = document.getElementById(`${rowIdOf(key)}-under`)?.querySelector("textarea");
    box?.focus();
    return Boolean(box);
  };
  useEffect(() => {
    if (boxToFocus.current === null) return;
    focusBoxOf(boxToFocus.current);
    boxToFocus.current = null;
  });

  const openBox = (index: number) => {
    if (!review || focusBoxOf(keys[index]) || !review.canComment(rows[index])) return;
    review.openBox(rows[index]);
    boxToFocus.current = keys[index];
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed in a box or on a comment's buttons are theirs.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) openBox(activeIndex);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = Math.max(0, Math.min(keys.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
    setActiveKey(keys[next]);
    document.getElementById(rowIdOf(keys[next]))?.scrollIntoView({ block: "nearest" });
  };
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || activeIndex >= 0) return;
    setActiveKey(keys[Math.max(0, rows.findIndex((row) => review?.canComment(row)))]);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const { currentTarget } = event;
    if (!currentTarget.contains(event.relatedTarget) && !currentTarget.matches(":hover")) setActiveKey(null);
  };
  // One listener for the whole grid: a row's own would redraw every row as the pointer crosses them.
  const handleMouseOver = (event: MouseEvent<HTMLDivElement>) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row;
    if (key) setActiveKey(key);
  };
  const handleMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(document.activeElement)) setActiveKey(null);
  };
  const gridProps = review && {
    ref: grid,
    role: "grid",
    tabIndex: 0,
    "aria-activedescendant": activeIndex >= 0 ? rowIdOf(keys[activeIndex]) : undefined,
    onKeyDown: handleKeyDown,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onMouseOver: handleMouseOver,
    onMouseLeave: handleMouseLeave,
  };
  const takeFocusBack = () => grid.current?.focus();

  return (
    <div aria-label={label} className={review ? `${LIST[density]} group/grid focus-ring` : LIST[density]} {...gridProps}>
      {rows.map((row, index) => {
        const key = keys[index];
        const isActive = key === activeKey;
        return (
          <DiffRow
            key={key}
            row={row}
            density={density}
            rowKey={key}
            rowId={review ? rowIdOf(key) : undefined}
            isActive={isActive}
            control={
              isActive && review?.canComment(row) ? (
                // Sits over the row without widening it: a row is 20px and the button 28px.
                <span role="gridcell" className="sticky left-0 z-10 w-0 shrink-0">
                  <IconButton
                    label={`Comment on line ${lineOf(row)}`}
                    tabIndex={-1}
                    className="absolute -top-1 left-0 bg-surface-3 shadow-popover"
                    onClick={() => openBox(index)}
                  >
                    <MessageSquarePlus size={14} />
                  </IconButton>
                </span>
              ) : null
            }
            under={review?.under(row, takeFocusBack) ?? null}
          />
        );
      })}
    </div>
  );
}
