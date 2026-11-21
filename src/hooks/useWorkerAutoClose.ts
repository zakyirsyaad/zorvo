import { useEffect, useRef } from 'react';
import { isOpenLink } from '../lib/delegation';
import { isArchived } from '../lib/session-helpers';
import { WORKER_CLOSE_MS } from '../lib/workers';
import type { Session } from '../types';
import { useLatest } from './useLatest';

export interface WorkerAutoCloseDeps {
  sessions: readonly Session[];
  isBusy: (id: string) => boolean;
  isWaiting: (id: string) => boolean;
  /** Stopping an agent that cannot be reopened would lose the session. */
  canReopen: (id: string) => boolean;
  stop: (id: string) => Promise<boolean>;
  now?: () => number;
}

/**
 * Ends a worker's agent process `WORKER_CLOSE_MS` after its turn. The session and its history
 * stay, and a further task reopens it. One timer per worker, keyed by the turn end it waits
 * for; a stop is tried once per turn end, so a failure is not retried in a loop.
 */
export function useWorkerAutoClose(deps: WorkerAutoCloseDeps): void {
  const latest = useLatest(deps);
  const timers = useRef(new Map<string, { endedAt: number; timer: ReturnType<typeof setTimeout> }>());

  /** The turn end a worker's agent is waiting to close after, or null when it must stay open. */
  const closableAfter = (session: Session): number | null => {
    const { isBusy, isWaiting, canReopen } = latest.current;
    const link = session.delegatedFrom;
    if (session.status !== 'running' || isArchived(session) || !link || !isOpenLink(link)) return null;
    // A worker whose agent died has nothing left to close.
    if (!link.lastTurn || link.lastTurn.how === 'exited') return null;
    if (isBusy(session.id) || isWaiting(session.id) || !canReopen(session.id)) return null;
    return link.lastTurn.endedAt;
  };

  // Every render: the timers follow the sessions, not a dependency list of their own.
  useEffect(() => {
    const live = new Set<string>();
    for (const session of deps.sessions) {
      const endedAt = closableAfter(session);
      if (endedAt === null) continue;
      live.add(session.id);
      if (timers.current.get(session.id)?.endedAt === endedAt) continue;
      clearTimeout(timers.current.get(session.id)?.timer);
      const now = (deps.now ?? Date.now)();
      const timer = setTimeout(() => {
        // The state may have moved since the timer was set.
        const current = latest.current.sessions.find((candidate) => candidate.id === session.id);
        if (current === undefined || closableAfter(current) !== endedAt) return;
        // The entry stays, so a render does not set it again; a failed stop is not retried.
        latest.current.stop(session.id).catch(() => undefined);
      }, Math.max(0, endedAt + WORKER_CLOSE_MS - now));
      timers.current.set(session.id, { endedAt, timer });
    }
    for (const [id, entry] of [...timers.current]) {
      if (live.has(id)) continue;
      clearTimeout(entry.timer);
      timers.current.delete(id);
    }
  });

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const entry of held.values()) clearTimeout(entry.timer);
      held.clear();
    };
  }, []);
}
