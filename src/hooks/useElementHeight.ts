import { useEffect, useState, type RefObject } from "react";

/** An element's rendered height, kept up to date as it grows or empties; 0 until it is measured. */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // The observer reports once on observe, so the first height needs no read here.
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
