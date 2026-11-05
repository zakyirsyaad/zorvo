/**
 * Where WebKit's own menu still helps: a text field (Paste, Undo), and a terminal, where
 * xterm moves its own textarea under the pointer with its selection, for Copy and Paste.
 * A checkbox, a radio or a button has nothing to paste into.
 */
const KEEPS_MENU = [
  "textarea",
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  '[contenteditable]:not([contenteditable="false"])',
  ".xterm",
].join(", ");

/**
 * True when a right-click should still show WebKit's menu: in a text field or a terminal, or on
 * the selected text itself. A selection elsewhere does not count, or a right-click on the app's
 * chrome would bring back Reload while a reply's sentence stays selected.
 */
export function keepsNativeMenu(target: EventTarget | null, selection: Selection | null): boolean {
  if (!(target instanceof Node)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  if (element?.closest(KEEPS_MENU)) return true;
  return isSelected(target, selection);
}

/** True when a selection that is not empty covers the node right-clicked. */
function isSelected(target: Node, selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(target)) return true;
  }
  return false;
}

/**
 * Keeps WebKit's default menu (Reload, Inspect Element and the rest) off the app's chrome,
 * leaving it for text fields, terminals and selections. Returns a function that removes the
 * guard. Installed only in release builds, so a dev build keeps Inspect Element.
 */
export function installContextMenuGuard(doc: Document): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (!keepsNativeMenu(event.target, doc.getSelection())) event.preventDefault();
  };
  doc.addEventListener("contextmenu", onContextMenu);
  return () => doc.removeEventListener("contextmenu", onContextMenu);
}
