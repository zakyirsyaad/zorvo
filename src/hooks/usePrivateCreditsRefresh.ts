import { useCallback, useRef } from 'react';

/** The lowest interval between two balance reads after private turns, across every session. */
export const PRIVATE_CREDITS_REFRESH_MS = 60_000;

/**
 * Reads the balance after a private turn ends, at most once a minute across sessions. The engine
 * only calls it for private sessions; the predicate keeps a plain turn from asking too.
 */
export function usePrivateCreditsRefresh(
  refresh: () => Promise<void>,
  isPrivateSession: (sessionId: string) => boolean,
  now: () => number = Date.now,
): (sessionId: string) => void {
  const lastRefresh = useRef<number | null>(null);

  return useCallback(
    (sessionId: string) => {
      if (!isPrivateSession(sessionId)) return;
      const at = now();
      if (lastRefresh.current !== null && at - lastRefresh.current < PRIVATE_CREDITS_REFRESH_MS) return;
      lastRefresh.current = at;
      // The credits hook already keeps its last status on a failed read; nothing here may reach the turn.
      void refresh().catch(() => {});
    },
    [refresh, isPrivateSession, now],
  );
}