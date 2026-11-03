import { useCallback, useEffect, useState } from 'react';

/** Marks a message's text, the only part of the chat a reply can quote. */
export const SELECTABLE_TEXT_ATTRIBUTE = 'data-selectable-text';

export interface ChatSelection {
  text: string;
  /** All of it sits in one code block, so it is quoted as code. */
  isCode: boolean;
  /** Where it is on screen; jsdom has no layout, so it may be missing. */
  rect: { top: number; bottom: number; left: number; width: number } | null;
}

const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement);

/** The selection, when it starts and ends in the same message's text inside the chat. */
function readSelection(container: HTMLElement): ChatSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer);
  const end = elementOf(range.endContainer);
  if (!start || !end || !container.contains(start) || !container.contains(end)) return null;
  const text = start.closest(`[${SELECTABLE_TEXT_ATTRIBUTE}]`);
  if (!text || text !== end.closest(`[${SELECTABLE_TEXT_ATTRIBUTE}]`)) return null;
  const code = start.closest('pre');
  const box = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
  return {
    text: selection.toString(),
    isCode: code !== null && code === end.closest('pre'),
    rect: box ? { top: box.top, bottom: box.bottom, left: box.left, width: box.width } : null,
  };
}

/**
 * Text the user selected in one message of the chat, read when the mouse lets go.
 * It is read again when the chat scrolls, so the toolbar follows it while new output
 * moves the view, and it goes away when the selection does and on Escape.
 */
export function useChatSelection(isEnabled: boolean) {
  const [selected, setSelected] = useState<ChatSelection | null>(null);
  const clear = useCallback(() => setSelected(null), []);

  const onMouseUp = useCallback(
    (container: HTMLElement) => setSelected(isEnabled ? readSelection(container) : null),
    [isEnabled],
  );

  const onScroll = useCallback(
    (container: HTMLElement) => setSelected((current) => (current ? readSelection(container) : null)),
    [],
  );

  useEffect(() => {
    if (!selected) return;
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSelected(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected]);

  return { selected: isEnabled ? selected : null, onMouseUp, onScroll, clear };
}
