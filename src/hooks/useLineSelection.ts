import { useEffect, useState, type RefObject } from "react";

export interface LineRange {
  first: number;
  last: number;
}

/** The line a selection end sits in: its closest `[data-line]` inside `body`. */
function lineOf(node: Node | null, body: HTMLElement): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const row = element?.closest<HTMLElement>("[data-line]");
  if (!row || !body.contains(row)) return null;
  const line = Number(row.dataset.line);
  return Number.isInteger(line) ? line : null;
}

/**
 * The range of lines selected in the viewer's `body`, read when the mouse or a key lets go, so the
 * selection a drag ends with is the one offered. Null while nothing, or something outside, is selected;
 * Escape and `clear` drop it. Listens on every render, since the body appears only once the file is read.
 */
export function useLineSelection(body: RefObject<HTMLElement | null>): { range: LineRange | null; clear: () => void } {
  const [range, setRange] = useState<LineRange | null>(null);

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const read = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setRange(null);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setRange(null);
        return;
      }
      const anchor = lineOf(selection.anchorNode, element);
      const focus = lineOf(selection.focusNode, element);
      setRange(anchor === null || focus === null ? null : { first: Math.min(anchor, focus), last: Math.max(anchor, focus) });
    };
    element.addEventListener("mouseup", read);
    element.addEventListener("keyup", read);
    return () => {
      element.removeEventListener("mouseup", read);
      element.removeEventListener("keyup", read);
    };
  });

  return { range, clear: () => setRange(null) };
}
