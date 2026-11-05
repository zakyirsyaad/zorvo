/** Where WebKit's own menu still helps: a field (Paste, Undo) or a selection (Copy). */
const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/** True when a right-click should still show WebKit's menu: in a text field, or on selected text. */
export function keepsNativeMenu(target: EventTarget | null, selectedText: string): boolean {
  if (selectedText.trim() !== '') return true;
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * Keeps WebKit's default menu (Reload, Inspect Element and the rest) off the app's chrome,
 * leaving it for text fields and selections. Returns a function that removes the guard.
 * Installed only in release builds, so a dev build keeps Inspect Element.
 */
export function installContextMenuGuard(doc: Document): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (!keepsNativeMenu(event.target, doc.getSelection()?.toString() ?? '')) event.preventDefault();
  };
  doc.addEventListener('contextmenu', onContextMenu);
  return () => doc.removeEventListener('contextmenu', onContextMenu);
}
