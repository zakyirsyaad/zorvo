import { useEffect, useState, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab must go to stay inside `container`, or null when it may move on as usual. */
function wrapTarget(container: HTMLElement, isBackward: boolean): HTMLElement | null {
  const focusables = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (!(active instanceof Node) || !container.contains(active)) return isBackward ? last : first;
  if (isBackward && active === first) return last;
  if (!isBackward && active === last) return first;
  return null;
}

/**
 * The open modals' containers, each with where its focus goes back to (its opener first, then its
 * fallbacks). A modal opened from inside another one inherits that one's list: the outer modal may
 * close first and take the opener with it.
 */
const openTraps = new Map<HTMLElement, readonly HTMLElement[]>();

function returnTargets(opener: HTMLElement | null): readonly HTMLElement[] {
  if (opener === null) return [];
  const outer = [...openTraps].find(([container]) => container.contains(opener));
  return [opener, ...(outer?.[1] ?? [])];
}

/**
 * Keeps Tab inside a modal while it is open, and gives focus back to what had
 * it before once the modal closes; when that is gone (it was inside a modal that
 * closed meanwhile), to what that modal would have given it back to.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
  // Read as the modal first renders: its children may take focus before its own effects run.
  const [targets] = useState(() =>
    returnTargets(document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    openTraps.set(container, targets);
    return () => {
      openTraps.delete(container);
    };
  }, [containerRef, targets]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (event.key !== 'Tab' || !container) return;
      const target = wrapTarget(container, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [containerRef]);

  useEffect(
    () => () => {
      targets.find((target) => target.isConnected)?.focus();
    },
    [targets],
  );
}
