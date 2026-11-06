import { useLayoutEffect, type RefObject } from "react";

/**
 * Brings an element into view, as little as needed, when it shows and whenever `key` changes. A notice anchored
 * in a column the user has scrolled away from (a draft scrolled to its sessions) would otherwise appear off screen
 * and never be seen; one already on screen does not move anything.
 */
export function useRevealWhenShown(ref: RefObject<HTMLElement | null>, key: unknown): void {
  useLayoutEffect(() => {
    // jsdom has no scrollIntoView.
    ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [ref, key]);
}
