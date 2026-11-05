import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Tabs, tabIds, type TabItem } from "../ui/Tabs";
import { useLatest } from "../../hooks/useLatest";
import { clampInspectorWidth, INSPECTOR_WIDTH, minInspectorWidth, shownInspectorWidth, type InspectorTab } from "../../lib/inspector";

const LABELS: Record<InspectorTab, string> = {
  changes: "Changes",
  activity: "Activity",
  files: "Files",
  terminal: "Terminal",
};
const ORDER: readonly InspectorTab[] = ["changes", "activity", "files", "terminal"];
const ID_PREFIX = "inspector";

export interface InspectorProps {
  tab: InspectorTab;
  /** The tabs this session can show; the order is always Changes, Activity, Files, Terminal. */
  tabs: readonly InspectorTab[];
  /** The remembered width; the Terminal tab shows at least `INSPECTOR_WIDTH.wide`. */
  width: number;
  counts?: Partial<Record<InspectorTab, number>>;
  /** A file is open in the Files tab: like the Terminal tab, it shows at least `INSPECTOR_WIDTH.wide`. */
  isViewingFile?: boolean;
  onSelect: (tab: InspectorTab) => void;
  onResize: (px: number) => void;
  onClose: () => void;
  /** The panel of the current tab. */
  children: ReactNode;
}

/** The right-hand inspector: one tab of the session's changes, activity, files or terminal, with an edge that drags. */
export function Inspector({ tab, tabs, width, counts, isViewingFile = false, onSelect, onResize, onClose, children }: InspectorProps) {
  const onResizeRef = useLatest(onResize);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const stopDragRef = useRef<() => void>(() => {});

  // A drag in progress ends with the inspector.
  useEffect(() => () => stopDragRef.current(), []);

  const items: TabItem<InspectorTab>[] = ORDER.filter((id) => tabs.includes(id)).map((id) => ({
    id,
    label: LABELS[id],
    count: counts?.[id],
  }));

  // Resizing starts from the width that shows (the Terminal tab's may be wider than the remembered one)
  // and never goes below the tab's own minimum, so every step changes what you see.
  const shown = shownInspectorWidth(tab, width, isViewingFile);
  const min = minInspectorWidth(tab, isViewingFile);
  const widthFor = (px: number) => Math.max(min, clampInspectorWidth(px));

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: shown };
    let last = shown;
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = widthFor(drag.startWidth + (drag.startX - moveEvent.clientX));
      if (next === last) return;
      last = next;
      onResizeRef.current(next);
    };
    const stop = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    stopDragRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The edge is on the left: Left widens the inspector, Right narrows it.
    const delta = { ArrowLeft: INSPECTOR_WIDTH.step, ArrowRight: -INSPECTOR_WIDTH.step }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = widthFor(shown + delta);
    if (next !== shown) onResize(next);
  };

  const ids = tabIds(ID_PREFIX, tab);
  return (
    <section
      aria-label="Inspector"
      style={{ width: shown }}
      className="relative flex shrink-0 flex-col border-l border-border bg-surface-1"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuemin={min}
        aria-valuemax={INSPECTOR_WIDTH.max}
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize focus-ring"
      />
      <div className="flex h-10 shrink-0 items-stretch justify-between border-b border-border pr-1.5 pl-2">
        <Tabs tabs={items} selected={tab} onSelect={onSelect} label="Inspector" idPrefix={ID_PREFIX} />
        <div className="flex items-center">
          <IconButton label="Close inspector" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </section>
  );
}
