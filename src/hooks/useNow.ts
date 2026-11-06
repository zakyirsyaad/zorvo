import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * `Date.now()`, read again every `intervalMs` while `isRunning`, for words that say how long ago.
 * Stopped, it keeps its last value and runs no timer; started again, it reads the clock at once.
 */
export function useNow(intervalMs: number = MINUTE_MS, isRunning = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, isRunning]);
  return now;
}
