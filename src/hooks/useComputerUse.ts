import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { replaceToolCard, withToolCard } from '../lib/agent-tool-card';
import {
  COMPUTER_USE_ALLOW,
  COMPUTER_USE_CARD_COPY,
  allowedKeys,
  computerUseCard,
  computerUseCardId,
  parseComputerUseRequest,
  parseComputerUseState,
  settleComputerUseCard,
  type ComputerUseGrant,
  type ComputerUseRequestEvent,
} from '../lib/computer-use-card';
import { createId } from '../lib/ids';
import type { ActionCard, ChatMessage } from '../types';
import { useLatest } from './useLatest';

export interface ComputerUseDeps {
  /** The name of a session's agent, for the card's title. */
  agentNameOf: (sessionId: string) => string;
  updateMessages: (sessionId: string, update: (prev: ChatMessage[]) => ChatMessage[]) => void;
  onAttention: (sessionId: string, reason: 'needs-answer') => void;
  onNotice: (message: string) => void;
}

/** A card on screen: the call it answers and the card as it was shown. */
interface OpenCard {
  callId: string;
  sessionId: string;
  card: ActionCard;
}

/**
 * Computer use in the main window: shows the card of an agent's
 * `request_access`, sends the user's ticks back as row keys, and keeps what
 * each session may use, which the backend owns. Main window only: a popout
 * would answer the same card a second time.
 */
export function useComputerUse(deps: ComputerUseDeps): {
  /** True when the card was a computer-use card and this hook took the answer. */
  chooseCard: (sessionId: string, cardId: string, optionId: string, answers?: Record<string, string>) => boolean;
  /** A computer-use card of this session waits for the user. */
  isWaiting: (sessionId: string) => boolean;
  /** What the session may use, or undefined when it holds no grant. */
  grantOf: (sessionId: string) => ComputerUseGrant | undefined;
  /** Stop computer use for the session: its grants end and the driver is stopped. */
  stop: (sessionId: string) => void;
} {
  const latest = useLatest(deps);
  const open = useRef(new Map<string, OpenCard>());
  // The calls that ended while the state read at start was under way: its answer may still list them.
  const endedDuringRead = useRef<Set<string> | null>(new Set());
  const [grants, setGrants] = useState<readonly ComputerUseGrant[]>([]);
  const [, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((current) => current + 1), []);

  const show = useCallback(
    (event: ComputerUseRequestEvent) => {
      const cardId = computerUseCardId(event.callId);
      // The same request can arrive as an event and in the state read at start.
      if (open.current.has(cardId)) return;
      const card = computerUseCard(event, latest.current.agentNameOf(event.sessionId), Date.now());
      open.current.set(cardId, { callId: event.callId, sessionId: event.sessionId, card });
      latest.current.updateMessages(event.sessionId, (prev) =>
        prev.some((message) => message.actionCard?.id === cardId)
          ? // After a reload the saved card reads Not answered while its call still waits: it is asked again.
            replaceToolCard(prev, cardId, card)
          : withToolCard(prev, card, { sessionId: event.sessionId, now: Date.now(), createId }),
      );
      latest.current.onAttention(event.sessionId, 'needs-answer');
      bump();
    },
    [bump, latest],
  );

  const readState = useCallback(
    async (withRequests: boolean) => {
      const state = parseComputerUseState(await invoke('computer_use_state').catch(() => null));
      setGrants(state.grants);
      if (!withRequests) return;
      const ended = endedDuringRead.current;
      endedDuringRead.current = null;
      // A reload loses the cards on screen while their calls still wait.
      state.requests.filter((request) => !ended?.has(request.callId)).forEach(show);
    },
    [show],
  );

  useEffect(() => {
    let isActive = true;
    const stops: (() => void)[] = [];
    const listening: Promise<void>[] = [];
    const keep = (started: Promise<() => void>) => {
      listening.push(
        started.then((stop) => {
          if (isActive) stops.push(stop);
          else stop();
        }),
      );
    };
    keep(
      listen('computer-use-request', ({ payload }) => {
        const event = parseComputerUseRequest(payload);
        if (event) show(event);
      }),
    );
    const onEnded = (payload: unknown) => {
      const callId = (payload as { callId?: unknown } | null)?.callId;
      if (typeof callId !== 'string') return;
      endedDuringRead.current?.add(callId);
      const cardId = computerUseCardId(callId);
      const entry = open.current.get(cardId);
      if (!entry) return;
      open.current.delete(cardId);
      latest.current.updateMessages(entry.sessionId, (prev) =>
        settleComputerUseCard(prev, cardId, { kind: 'withdrawn' }),
      );
      bump();
    };
    keep(listen('computer-use-request-ended', ({ payload }) => onEnded(payload)));
    keep(listen('computer-use-changed', () => void readState(false)));
    keep(listen('computer-use-notice', () => latest.current.onNotice(COMPUTER_USE_CARD_COPY.notSetUp)));
    // Read once every listener is on, so a request cannot fall between the read and the first event.
    void Promise.all(listening).then(() => {
      if (isActive) void readState(true);
    });
    return () => {
      isActive = false;
      stops.forEach((stop) => stop());
    };
  }, [bump, latest, readState, show]);

  const chooseCard = (
    sessionId: string,
    cardId: string,
    optionId: string,
    answers?: Record<string, string>,
  ): boolean => {
    const entry = open.current.get(cardId);
    if (!entry || entry.sessionId !== sessionId) return false;
    const keys = optionId === COMPUTER_USE_ALLOW ? allowedKeys(entry.card, answers) : [];
    open.current.delete(cardId);
    bump();
    // The card says what the backend did, not what was ticked: it answers with the keys it
    // granted, or with nothing when the call had already ended (then nobody was asked).
    void invoke('computer_use_answer', { callId: entry.callId, allowed: keys })
      .catch(() => null)
      .then((granted) => {
        const outcome = !Array.isArray(granted)
          ? ({ kind: 'withdrawn' } as const)
          : keys.length === 0
            ? ({ kind: 'denied' } as const)
            : ({ kind: 'allowed', keys: granted.filter((key): key is string => typeof key === 'string') } as const);
        latest.current.updateMessages(sessionId, (prev) => settleComputerUseCard(prev, cardId, outcome));
      });
    return true;
  };

  const isWaiting = (sessionId: string): boolean =>
    [...open.current.values()].some((entry) => entry.sessionId === sessionId);

  const grantOf = (sessionId: string): ComputerUseGrant | undefined =>
    grants.find((grant) => grant.sessionId === sessionId && (grant.apps.length > 0 || grant.fullScreen));

  const stop = useCallback((sessionId: string) => {
    void invoke('computer_use_revoke', { sessionId }).catch(() => undefined);
  }, []);

  return { chooseCard, isWaiting, grantOf, stop };
}
