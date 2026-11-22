import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMessage,
  droppedNotice,
  isFull as isListFull,
  moveToFront,
  queuedAnnouncement,
  removeMessage,
  SENT_ANNOUNCEMENT,
  takeFirst,
  type QueueHold,
  type QueuedMessage,
} from '../lib/queued-messages';
import type { WorkerTurnEnd } from '../types';
import { useLatest } from './useLatest';

export interface QueuedMessagesDeps {
  /** Every session that still exists: the queue of any other is dropped. */
  sessionIds: readonly string[];
  /**
   * Sends one queued message the way the composer's Send does for that session ('resume' continues an ended one).
   * Resolves to whether the agent took it; false sends it back to the composer.
   */
  deliver: (sessionId: string, message: QueuedMessage, mode: 'send' | 'resume') => Promise<boolean>;
  /** Asks the agent to end its turn (the Stop button's path). */
  stop: (sessionId: string) => void;
  giveBack: (sessionId: string, text: string, attachments: readonly string[]) => void;
  focusComposer: () => void;
  /** A permission or question card waits for the user: the turn has not ended. */
  isWaiting: (sessionId: string) => boolean;
  /** From refs, true in the tick a prompt goes out; React's busy flag lags a render. */
  isTurnUnderWay: (sessionId: string) => boolean;
  isEnded: (sessionId: string) => boolean;
  agentNameOf: (sessionId: string) => string;
  onNotice: (message: string) => void;
}

/**
 * Messages sent while an agent works, per session and in memory only (as composer text is). The decision
 * to send is made in `onTurnSettled`, where the turn end is handled, so a queued message goes ahead of the
 * worker reports that wait for a free coordinator. A message leaves the queue before its send is awaited.
 */
export function useQueuedMessages(deps: QueuedMessagesDeps) {
  const latest = useLatest(deps);
  const queues = useRef(new Map<string, readonly QueuedMessage[]>());
  const holds = useRef(new Map<string, QueueHold>());
  // Sessions with a queued message on its way out: a second turn-end event in the tick must not send another.
  const inFlight = useRef(new Set<string>());
  const counter = useRef(0);
  const [, setRevision] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  const queueOf = useCallback((sessionId: string): readonly QueuedMessage[] => queues.current.get(sessionId) ?? [], []);
  const holdOf = useCallback((sessionId: string): QueueHold | null => holds.current.get(sessionId) ?? null, []);
  const isFull = useCallback((sessionId: string) => isListFull(queueOf(sessionId)), [queueOf]);

  const bump = useCallback(() => setRevision((n) => n + 1), []);
  const setQueue = useCallback(
    (sessionId: string, list: readonly QueuedMessage[]) => {
      if (list.length === 0) {
        queues.current.delete(sessionId);
        holds.current.delete(sessionId);
      } else queues.current.set(sessionId, list);
      bump();
    },
    [bump],
  );

  const add = useCallback(
    (sessionId: string, text: string, attachments: readonly string[] = []): boolean => {
      const before = queueOf(sessionId);
      if (isListFull(before)) return false;
      counter.current += 1;
      setQueue(sessionId, addMessage(before, { id: `queued-${counter.current}`, text, attachments }));
      setAnnouncement(queuedAnnouncement(latest.current.agentNameOf(sessionId)));
      return true;
    },
    [latest, queueOf, setQueue],
  );

  /** Takes the first message off the queue, then sends it; a refusal returns it to the composer. */
  const sendFirst = useCallback((sessionId: string, mode: 'send' | 'resume') => {
    const taken = takeFirst(queueOf(sessionId));
    if (!taken || inFlight.current.has(sessionId)) return;
    inFlight.current.add(sessionId);
    setQueue(sessionId, taken.rest);
    const { first } = taken;
    const finish = (isTaken: boolean) => {
      if (isTaken) setAnnouncement(SENT_ANNOUNCEMENT);
      else latest.current.giveBack(sessionId, first.text, first.attachments);
    };
    latest.current
      .deliver(sessionId, first, mode)
      .then(finish, () => finish(false))
      .finally(() => inFlight.current.delete(sessionId));
  }, [latest, queueOf, setQueue]);

  const onTurnSettled = useCallback(
    (sessionId: string, end: { how: WorkerTurnEnd }) => {
      if (queueOf(sessionId).length === 0) return;
      if (end.how === 'failed' || end.how === 'exited') {
        holds.current.set(sessionId, end.how === 'failed' ? 'failed' : 'ended');
        bump();
        return;
      }
      if (latest.current.isWaiting(sessionId)) return;
      holds.current.delete(sessionId);
      sendFirst(sessionId, 'send');
    },
    [bump, latest, queueOf, sendFirst],
  );

  const remove = useCallback((sessionId: string, id: string) => {
    setQueue(sessionId, removeMessage(queueOf(sessionId), id));
  }, [queueOf, setQueue]);

  const edit = useCallback(
    (sessionId: string, id: string) => {
      const message = queueOf(sessionId).find((m) => m.id === id);
      if (!message) return;
      setQueue(sessionId, removeMessage(queueOf(sessionId), id));
      latest.current.giveBack(sessionId, message.text, message.attachments);
      latest.current.focusComposer();
    },
    [latest, queueOf, setQueue],
  );

  const sendNow = useCallback(
    (sessionId: string, id: string) => {
      setQueue(sessionId, moveToFront(queueOf(sessionId), id));
      const { isTurnUnderWay, isEnded, stop } = latest.current;
      if (isTurnUnderWay(sessionId)) stop(sessionId);
      else sendFirst(sessionId, isEnded(sessionId) ? 'resume' : 'send');
    },
    [latest, queueOf, sendFirst, setQueue],
  );

  /** The conversation changed under the queue: the first message returns to the composer, the rest are dropped. */
  const clearForRewind = useCallback(
    (sessionId: string) => {
      const taken = takeFirst(queueOf(sessionId));
      if (!taken) return;
      setQueue(sessionId, []);
      latest.current.giveBack(sessionId, taken.first.text, taken.first.attachments);
      if (taken.rest.length > 0) latest.current.onNotice(droppedNotice(taken.rest.length));
    },
    [latest, queueOf, setQueue],
  );

  // A deleted session takes its queue along.
  useEffect(() => {
    let changed = false;
    for (const id of [...queues.current.keys()]) {
      if (deps.sessionIds.includes(id)) continue;
      queues.current.delete(id);
      holds.current.delete(id);
      changed = true;
    }
    if (changed) bump();
  });

  return { queueOf, holdOf, isFull, add, remove, edit, sendNow, onTurnSettled, clearForRewind, announcement };
}
