import { useEffect, useRef, type KeyboardEvent } from "react";

const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/**
 * Keyboard for a menu built on `Popover`: the first row that can be picked takes focus when the menu opens, and
 * the arrow keys, Home and End move between such rows. Spread `ref` and `onKeyDown` on a box around the rows.
 */
export function useMenuFocus(isOpen: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) ref.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [isOpen]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown" ? (at + 1) % items.length
      : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next].focus();
  };

  return { ref, onKeyDown };
}
