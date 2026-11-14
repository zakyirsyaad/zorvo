import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The window's inner width, kept current while it is resized. */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}
