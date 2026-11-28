import { useEffect, useState, type RefObject } from "react";

/** Whether `ref` is on screen or within `margin` pixels of it. True where it cannot be told. */
export function useNearScreen(ref: RefObject<Element | null>, margin = 600): boolean {
  const canObserve = typeof IntersectionObserver !== "undefined";
  const [isNear, setIsNear] = useState(!canObserve);
  useEffect(() => {
    const element = ref.current;
    if (!element || !canObserve) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setIsNear(last.isIntersecting);
      },
      { rootMargin: `${margin}px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, canObserve]);
  return isNear;
}
