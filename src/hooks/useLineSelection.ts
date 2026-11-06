import { useCallback, useEffect, useState, type RefObject } from "react";

export interface LineRange {
  first: number;
  last: number;
  /** The selection was made upward, so its moving end (where you are looking) is at `first`. */
  isBackward?: boolean;
}

/** The row a selection end sits in: its closest `[data-line]` inside `body`. */
function rowOf(node: Node | null, body: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const row = element?.closest<HTMLElement>("[data-line]");
  return row && body.contains(row) ? row : null;
}

/**
 * True when a range end sits before any of its row's code: at offset 0 of the code, or in the number
 * column. A triple-click or a drag to the left edge ends there, on the line after the one meant.
 */
function endsBeforeCode(row: HTMLElement, container: Node, offset: number): boolean {
  const code = row.lastElementChild;
  if (!code) return false;
  if (!code.contains(container)) return true;
  const before = document.createRange();
  before.setStart(code, 0);
  before.setEnd(container, offset);
  return before.toString() === "";
}

/** The lines a selection in `body` covers, smaller first; null when it is empty or leaves `body`. */
function readRange(body: HTMLElement): LineRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const startRow = rowOf(range.startContainer, body);
  const endRow = rowOf(range.endContainer, body);
  if (!startRow || !endRow) return null;
  const first = Number(startRow.dataset.line);
  let last = Number(endRow.dataset.line);
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  if (last > first && endsBeforeCode(endRow, range.endContainer, range.endOffset)) last -= 1;
  // The focus is the end that moved: above the anchor for a drag upward or Shift+Up.
  const anchorLine = Number(rowOf(selection.anchorNode, body)?.dataset.line);
  const focusLine = Number(rowOf(selection.focusNode, body)?.dataset.line);
  const isBackward = Number.isInteger(anchorLine) && Number.isInteger(focusLine) && focusLine < anchorLine;
  return { first: Math.min(first, last), last: Math.max(first, last), isBackward };
}

const sameRange = (a: LineRange, b: LineRange) => a.first === b.first && a.last === b.last && a.isBackward === b.isBackward;

/**
 * The range of lines selected in the viewer's `body`, read when the mouse or a key lets go inside it
 * (the body takes focus, so Shift and the arrows select too). While a range is offered, Escape anywhere
 * and a selection that collapses or leaves the body (a click elsewhere) drop it.
 */
export function useLineSelection(body: RefObject<HTMLElement | null>): { range: LineRange | null; clear: () => void } {
  const [range, setRange] = useState<LineRange | null>(null);

  // Listens on every render: the body appears only once the file is read.
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const read = (event: Event) => {
      // Escape's keydown dropped the offer; its keyup must not read the same selection back.
      if (event instanceof KeyboardEvent && event.key === "Escape") return;
      const next = readRange(element);
      // The same lines keep the same range, so the viewer's memoized rows are not drawn again.
      setRange((current) => (current && next && sameRange(current, next) ? current : next));
    };
    element.addEventListener("mouseup", read);
    element.addEventListener("keyup", read);
    return () => {
      element.removeEventListener("mouseup", read);
      element.removeEventListener("keyup", read);
    };
  });

  useEffect(() => {
    if (!range) return;
    const onSelectionChange = () => {
      const element = body.current;
      if (!element || readRange(element) === null) setRange(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRange(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [range, body]);

  const clear = useCallback(() => setRange(null), []);
  return { range, clear };
}
