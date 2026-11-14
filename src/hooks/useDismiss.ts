import { useEffect, type RefObject } from 'react';
import { useLatest } from './useLatest';

/**
 * Closes a popover on a click outside `ref` or on Escape, while it is open. `alsoInside` is a part of the
 * same control drawn elsewhere through a portal: a click in it is not outside.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
  alsoInside?: HTMLElement | null,
): void {
  const onCloseRef = useLatest(onClose);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || alsoInside?.contains(target)) return;
      onCloseRef.current();
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen, ref, onCloseRef, alsoInside]);
}
