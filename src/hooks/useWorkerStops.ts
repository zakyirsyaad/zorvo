import { useEffect, useRef } from 'react';
import type { Session } from '../types';

/**
 * The auto-close stops, by session. `stop` leaves the session row to its caller, so a worker's
 * stop marks it terminated; the session stays and reads ended until a task reopens it. A stop that
 * worked stays in `pendingStop` until the session renders terminated, since a task in that gap would
 * otherwise see a running worker and go to the stopped agent. A failed stop leaves no trace.
 */
export function useWorkerStops(deps: {
  sessions: readonly Session[];
  stop: (sessionId: string) => Promise<boolean>;
  markTerminated: (sessionId: string) => void;
}): {
  stopWorker: (sessionId: string) => Promise<boolean>;
  pendingStop: (sessionId: string) => Promise<boolean> | undefined;
  /** The worker is being reopened: a stop that landed no longer applies. */
  forget: (sessionId: string) => void;
} {
  const { sessions, stop, markTerminated } = deps;
  const pending = useRef(new Map<string, Promise<boolean>>());

  const stopWorker = (sessionId: string): Promise<boolean> => {
    const stopping = (async () => {
      const isStopped = await stop(sessionId);
      if (isStopped) markTerminated(sessionId);
      return isStopped;
    })();
    pending.current.set(sessionId, stopping);
    const dropIfCurrent = () => {
      if (pending.current.get(sessionId) === stopping) pending.current.delete(sessionId);
    };
    void stopping.then((isStopped) => {
      if (!isStopped) dropIfCurrent();
    }, dropIfCurrent);
    return stopping;
  };

  useEffect(() => {
    for (const id of [...pending.current.keys()]) {
      const status = sessions.find((candidate) => candidate.id === id)?.status;
      if (status !== 'running') pending.current.delete(id);
    }
  });

  return {
    stopWorker,
    pendingStop: (sessionId) => pending.current.get(sessionId),
    forget: (sessionId) => {
      pending.current.delete(sessionId);
    },
  };
}
