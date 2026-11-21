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
  /** From refs, true in the tick a prompt goes out: `isBusy` is React state and lags a render. */
  isTurnUnderWay: (id: string) => boolean;
  /** True while a task is being sent to the worker (a send or a reopen that has not landed). */
  isSendingTo: (id: string) => boolean;
  /** The worker has a shell command Zorvo knows of; closing would end it with the agent's process tree. */
  hasLiveTasks: (id: string) => boolean;
  /** The worker's last turn failed and its banner (the error text, Try again) is still up; closing would clear it. */
  hasFailedTurn: (id: string) => boolean;
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
  // The turn (`lastTurn.endedAt`) a stop was tried for: a delivered report moves the timer key, not the turn.
  const attempted = useRef(new Map<string, number>());

  /** The turn end a worker's agent is waiting to close after, or null when it must stay open. */
  const closableAfter = (session: Session): number | null => {
    const { isBusy, isWaiting, canReopen, hasLiveTasks, hasFailedTurn } = latest.current;
    const link = session.delegatedFrom;
    if (session.status !== 'running' || isArchived(session) || !link || !isOpenLink(link)) return null;
    // A worker whose agent died has nothing left to close.
    if (!link.lastTurn || link.lastTurn.how === 'exited') return null;
    if (isBusy(session.id) || isWaiting(session.id) || !canReopen(session.id) || hasLiveTasks(session.id) || hasFailedTurn(session.id)) return null;
    // The two minutes count from the delivered report, else from the turn end.
    const { endedAt } = link.lastTurn;
    const reportedAt = link.reportedAt ?? 0;
    return reportedAt >= endedAt ? reportedAt : endedAt;
  };

  /** One timer per worker for the turn end `endedAt`; a skipped fire arms the same check again. */
  const arm = (id: string, endedAt: number, delay: number): void => {
    const timer = setTimeout(() => {
      // The state may have moved since the timer was set.
      const current = latest.current.sessions.find((candidate) => candidate.id === id);
      if (current === undefined || closableAfter(current) !== endedAt) return;
      // A prompt just sent is not rendered busy yet, and stopping now would leave its turn unrecorded.
      // If that prompt is refused no new turn end comes, so the check is made again later.
      if (latest.current.isTurnUnderWay(id) || latest.current.isSendingTo(id)) {
        arm(id, endedAt, WORKER_CLOSE_MS);
        return;
      }
      // The entry stays, so a render does not set it again; a failed stop is not retried.
      const turnEnd = current.delegatedFrom?.lastTurn?.endedAt;
      if (turnEnd !== undefined) attempted.current.set(id, turnEnd);
      latest.current.stop(id).catch(() => undefined);
    }, delay);
    timers.current.set(id, { endedAt, timer });
  };

  // Every render: the timers follow the sessions, not a dependency list of their own.
  useEffect(() => {
    const live = new Set<string>();
    for (const session of deps.sessions) {
      const endedAt = closableAfter(session);
      if (endedAt === null) continue;
      live.add(session.id);
      if (timers.current.get(session.id)?.endedAt === endedAt) continue;
      // One attempt per turn: only the report time moved.
      if (attempted.current.get(session.id) === session.delegatedFrom?.lastTurn?.endedAt) continue;
      clearTimeout(timers.current.get(session.id)?.timer);
      const now = (deps.now ?? Date.now)();
      arm(session.id, endedAt, Math.max(0, endedAt + WORKER_CLOSE_MS - now));
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
