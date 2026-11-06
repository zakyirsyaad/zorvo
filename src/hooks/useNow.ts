import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/** `Date.now()`, read again every `intervalMs` while mounted, for words that say how long ago. */
export function useNow(intervalMs: number = MINUTE_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
