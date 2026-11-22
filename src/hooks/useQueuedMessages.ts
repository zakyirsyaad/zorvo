import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMessage,
  isFull as isListFull,
  moveToFront,
  queuedAnnouncement,
  removeMessage,
  rewindNotice,
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
   * Resolves to whether the agent took it: false sends it back to the composer, null means the outcome is not known
   * (nothing is announced and nothing is given back).
   */
  deliver: (sessionId: string, message: QueuedMessage, mode: 'send' | 'resume') => Promise<boolean | null>;
  /** Asks the agent to end its turn (the Stop button's path). */
  stop: (sessionId: string) => void;
  giveBack: (sessionId: string, text: string, attachments: readonly string[]) => void;
  focusComposer: () => void;
  /** A permission or question card waits for the user: the turn has not ended. */
  isWaiting: (sessionId: string) => boolean;
  /** From refs, true in the tick a prompt goes out; React's busy flag lags a render. */
  isTurnUnderWay: (sessionId: string) => boolean;
  /** A launch or resume is under way and no prompt has gone out yet: Stop would end the session. */
  isStarting: (sessionId: string) => boolean;
  isEnded: (sessionId: string) => boolean;
  /** An ended session can be continued (the composer's own rule: its agent is ready). */
  canResume: (sessionId: string) => boolean;
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
  // A turn end that came while that send was in flight, run when it lands.
  const missed = useRef(new Map<string, { how: WorkerTurnEnd }>());
  // A turn end that came while a card waits for the user: sent once nothing waits.
  const waitingSettle = useRef(new Set<string>());
  // The user ended the agent: its turn end must not send into a dying process.
  const agentEnded = useRef(new Set<string>());
  // Send now asked for the stop: the cancelled turn that follows is the one to send after. A plain Stop is not.
  const sendNowAsked = useRef(new Set<string>());
  const counter = useRef(0);
  const settleRef = useRef<(sessionId: string, end: { how: WorkerTurnEnd }) => void>(() => {});
  const [, setRevision] = useState(0);
  const [announce, setAnnounce] = useState({ sessionId: '', text: '', key: 0 });
  const bump = useCallback(() => setRevision((n) => n + 1), []);

  const queueOf = useCallback((sessionId: string): readonly QueuedMessage[] => queues.current.get(sessionId) ?? [], []);
  const holdOf = useCallback((sessionId: string): QueueHold | null => holds.current.get(sessionId) ?? null, []);
  const isFull = useCallback((sessionId: string) => isListFull(queueOf(sessionId)), [queueOf]);

  const forgetState = useCallback((sessionId: string) => {
    holds.current.delete(sessionId);
    missed.current.delete(sessionId);
    waitingSettle.current.delete(sessionId);
    agentEnded.current.delete(sessionId);
    sendNowAsked.current.delete(sessionId);
  }, []);

  const setQueue = useCallback(
    (sessionId: string, list: readonly QueuedMessage[]) => {
      if (list.length === 0) {
        queues.current.delete(sessionId);
        forgetState(sessionId);
      } else queues.current.set(sessionId, list);
      bump();
    },
    [bump, forgetState],
  );

  const say = useCallback((sessionId: string, text: string) => {
    setAnnounce((prev) => ({ sessionId, text, key: prev.key + 1 }));
  }, []);

  const add = useCallback(
    (sessionId: string, text: string, attachments: readonly string[] = []): boolean => {
      const before = queueOf(sessionId);
      if (isListFull(before)) return false;
      counter.current += 1;
      setQueue(sessionId, addMessage(before, { id: `queued-${counter.current}`, text, attachments }));
      say(sessionId, queuedAnnouncement(latest.current.agentNameOf(sessionId)));
      return true;
    },
    [latest, queueOf, say, setQueue],
  );

  /** Takes the first message off the queue, then sends it; a refusal returns it to the composer. */
  const sendFirst = useCallback(
    (sessionId: string, mode: 'send' | 'resume') => {
      const taken = takeFirst(queueOf(sessionId));
      if (!taken || inFlight.current.has(sessionId)) return;
      inFlight.current.add(sessionId);
      // A new turn starts with this message: what held the others back no longer applies.
      forgetState(sessionId);
      setQueue(sessionId, taken.rest);
      const { first } = taken;
      const finish = (isTaken: boolean | null) => {
        if (isTaken === null) return;
        if (isTaken) {
          say(sessionId, SENT_ANNOUNCEMENT);
          return;
        }
        latest.current.giveBack(sessionId, first.text, first.attachments);
        // A refused prompt ends no turn, so nothing would send the rest: say so, and leave the choice to the user.
        if (queueOf(sessionId).length > 0) {
          holds.current.set(sessionId, 'refused');
          bump();
        }
      };
      latest.current
        .deliver(sessionId, first, mode)
        .then(finish, () => finish(false))
        .finally(() => {
          inFlight.current.delete(sessionId);
          const end = missed.current.get(sessionId);
          missed.current.delete(sessionId);
          if (end) settleRef.current(sessionId, end);
        });
    },
    [bump, forgetState, latest, queueOf, say, setQueue],
  );

  /** Applies a turn end that is known to be the end of the latest turn. */
  const settleNow = useCallback(
    (sessionId: string, end: { how: WorkerTurnEnd }) => {
      const wasEnded = agentEnded.current.delete(sessionId);
      const wasSendNow = sendNowAsked.current.delete(sessionId);
      if (queueOf(sessionId).length === 0) return;
      if (wasEnded || end.how === 'exited') {
        holds.current.set(sessionId, 'ended');
        bump();
        return;
      }
      if (end.how === 'failed') {
        holds.current.set(sessionId, 'failed');
        bump();
        return;
      }
      if (end.how === 'cancelled' && !wasSendNow) {
        // Stop means stop: the next message would start the agent again at once.
        holds.current.set(sessionId, 'stopped');
        bump();
        return;
      }
      if (latest.current.isWaiting(sessionId)) {
        // A card can outlive its turn: try again once nothing waits for the user.
        holds.current.set(sessionId, 'waiting');
        waitingSettle.current.add(sessionId);
        bump();
        return;
      }
      holds.current.delete(sessionId);
      sendFirst(sessionId, 'send');
    },
    [bump, latest, queueOf, sendFirst],
  );
  settleRef.current = settleNow;

  /**
   * A turn end. The engine clears its mark for the turn that ended before it calls this, so a turn still
   * under way means this end is a repeat or a stale one, and it sends nothing. One that arrives while a queued
   * send is in flight waits for it to land.
   */
  const onTurnSettled = useCallback(
    (sessionId: string, end: { how: WorkerTurnEnd }) => {
      if (latest.current.isTurnUnderWay(sessionId)) return;
      if (inFlight.current.has(sessionId)) {
        missed.current.set(sessionId, end);
        return;
      }
      settleNow(sessionId, end);
    },
    [latest, settleNow],
  );

  /** A prompt went out by any route (the composer, a resume, a retry): what held the queue back no longer applies. */
  const onPromptStarted = useCallback(
    (sessionId: string) => {
      const hadHold = holds.current.has(sessionId);
      forgetState(sessionId);
      if (hadHold) bump();
    },
    [bump, forgetState],
  );

  /** The user ended the agent (End agent): the turn end that follows is not a chance to send. */
  const onAgentEnded = useCallback(
    (sessionId: string) => {
      agentEnded.current.add(sessionId);
      if (queueOf(sessionId).length > 0) {
        holds.current.set(sessionId, 'ended');
        bump();
      }
    },
    [bump, queueOf],
  );

  const remove = useCallback(
    (sessionId: string, id: string) => {
      setQueue(sessionId, removeMessage(queueOf(sessionId), id));
    },
    [queueOf, setQueue],
  );

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
      const { isTurnUnderWay, isStarting, isEnded, canResume, stop } = latest.current;
      const isRunning = isTurnUnderWay(sessionId);
      const ended = isEnded(sessionId);
      // An ended session continues only when the composer's own Send could continue it.
      if (!isRunning && ended && !canResume(sessionId)) return;
      setQueue(sessionId, moveToFront(queueOf(sessionId), id));
      // Stop would end a session that is still starting: the row only moves up, and goes when the first turn ends.
      if (isStarting(sessionId)) return;
      if (isRunning) {
        sendNowAsked.current.add(sessionId);
        stop(sessionId);
      } else sendFirst(sessionId, ended ? 'resume' : 'send');
    },
    [latest, queueOf, sendFirst, setQueue],
  );

  /** The conversation changed under the queue: all of it goes, with one notice. Nothing is given back. */
  const clearForRewind = useCallback(
    (sessionId: string) => {
      const count = queueOf(sessionId).length;
      if (count === 0) return;
      setQueue(sessionId, []);
      latest.current.onNotice(rewindNotice(count));
    },
    [latest, queueOf, setQueue],
  );

  const announcementFor = useCallback(
    (sessionId: string) => ({ text: announce.sessionId === sessionId ? announce.text : '', key: announce.key }),
    [announce],
  );
  const clearAnnouncement = useCallback(() => {
    setAnnounce((prev) => (prev.text === '' ? prev : { ...prev, sessionId: '', text: '' }));
  }, []);

  // After every render: a deleted session takes its queue along, and a turn end that waited for an answer is retried.
  useEffect(() => {
    let changed = false;
    for (const id of [...queues.current.keys()]) {
      if (deps.sessionIds.includes(id)) continue;
      queues.current.delete(id);
      forgetState(id);
      changed = true;
    }
    for (const id of [...waitingSettle.current]) {
      const { isWaiting, isTurnUnderWay } = latest.current;
      if (queueOf(id).length === 0) waitingSettle.current.delete(id);
      else if (isTurnUnderWay(id)) {
        // The user answered and the agent went on: that turn's own end comes later.
        waitingSettle.current.delete(id);
        if (holds.current.get(id) === 'waiting') holds.current.delete(id);
        changed = true;
      } else if (!isWaiting(id)) {
        waitingSettle.current.delete(id);
        sendFirst(id, 'send');
      }
    }
    if (changed) bump();
  });

  return {
    queueOf,
    holdOf,
    isFull,
    add,
    remove,
    edit,
    sendNow,
    onTurnSettled,
    onPromptStarted,
    onAgentEnded,
    clearForRewind,
    announcementFor,
    clearAnnouncement,
  };
}
