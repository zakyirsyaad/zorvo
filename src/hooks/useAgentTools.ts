import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ALLOW_SESSION,
  replaceToolCard,
  settleToolCard,
  toolCardFor,
  withToolCard,
  type WaitingTask,
} from '../lib/agent-tool-card';
import {
  DECLINED,
  NOT_YET,
  NO_SESSION,
  delegateResultText,
  listAgentsText,
  parseToolCall,
  resolveAgent,
  sessionGetsAgentTools,
  statusRefusal,
  type AgentToolCall,
  type ListedDelegate,
} from '../lib/agent-tools';
import type { MentionAgentStatus } from '../lib/delegation';
import { createId } from '../lib/ids';
import type { AgentProfile, ChatMessage, Session } from '../types';
import type { GiveTaskResult } from './useDelegation';
import { useLatest } from './useLatest';

/** Answered when something went wrong on Zorvo's side; never the error itself, which could hold the task. */
const FAILED = 'Zorvo could not do that.';

export interface AgentToolsDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  /** An agent's install and sign-in state, as the @ list shows it. */
  statusOf: (agentId: string) => MentionAgentStatus;
  /** The session's open delegates, for `list_agents`. */
  delegatesOf: (sessionId: string) => ListedDelegate[];
  giveTask: (sourceId: string, agentId: string, task: string, options: { byAgent: true }) => Promise<GiveTaskResult>;
  updateMessages: (sessionId: string, update: (prev: ChatMessage[]) => ChatMessage[]) => void;
  onAttention: (sessionId: string, reason: 'needs-answer') => void;
}

/** A `delegate` call that waits for the user's answer on the session's card. */
interface WaitingCall extends WaitingTask {
  callId: string;
}

/** A session's card and the calls it stands for, in arrival order. */
interface WaitingCard {
  cardId: string;
  callerName: string;
  folder: string;
  calls: WaitingCall[];
}

function respond(callId: string, ok: boolean, text: string): void {
  // An answer that cannot be delivered leaves the agent with the backend's own timeout.
  void invoke('agent_tool_respond', { callId, ok, text }).catch(() => undefined);
}

/**
 * Answers the tool calls agents make to Zorvo's tool server. `list_agents`
 * is answered at once; the first `delegate` of a session shows a card, and
 * after Allow that session's calls run without one (memory only: a reload asks
 * again). Main window only: a popout would answer the same call a second time.
 * Decisions read refs, so they hold in the tick a call or an answer arrives.
 */
export function useAgentTools(deps: AgentToolsDeps): {
  /** True when the card was Zorvo's and this hook took the answer. */
  chooseCard: (sessionId: string, cardId: string, optionId: string) => boolean;
  hasGrant: (sessionId: string) => boolean;
  revokeGrant: (sessionId: string) => void;
  /** A Zorvo card of this session waits for the user. */
  isWaiting: (sessionId: string) => boolean;
} {
  const latest = useLatest(deps);
  // Sessions whose agent may give tasks without asking again. Memory only.
  const grants = useRef(new Set<string>());
  const waiting = useRef(new Map<string, WaitingCard>());
  // Bumped when a grant or a waiting card changes, so `isWaiting` and `hasGrant` are read again.
  const [, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((current) => current + 1), []);

  const runDelegate = useCallback(
    async (sessionId: string, call: WaitingCall): Promise<void> => {
      try {
        const result = await latest.current.giveTask(sessionId, call.targetId, call.task, { byAgent: true });
        if (result.ok) {
          const text = delegateResultText({ kind: result.kind, sessionName: result.sessionName, agentName: call.targetName });
          respond(call.callId, true, text);
        } else {
          // A failure inside Zorvo is not explained to an agent: its cause could hold a path.
          respond(call.callId, false, result.isInternal === true || result.reason === '' ? FAILED : result.reason);
        }
      } catch {
        respond(call.callId, false, FAILED);
      }
    },
    [latest],
  );

  /** The card for what waits now, on the session's reply or in the place of the one it had. */
  const showCard = useCallback(
    (session: Session, entry: WaitingCard, isNew: boolean) => {
      const card = toolCardFor(
        { cardId: entry.cardId, sessionId: session.id, callerName: entry.callerName, folder: entry.folder, now: Date.now() },
        entry.calls,
      );
      latest.current.updateMessages(session.id, (prev) =>
        isNew
          ? withToolCard(prev, card, { sessionId: session.id, now: Date.now(), createId })
          : replaceToolCard(prev, entry.cardId, card),
      );
    },
    [latest],
  );

  const handleDelegate = useCallback(
    (session: Session, call: AgentToolCall) => {
      const current = latest.current;
      const { agent, task } = call.args as Record<string, unknown>;
      if (typeof agent !== 'string' || typeof task !== 'string') {
        respond(call.callId, false, FAILED);
        return;
      }
      const resolved = resolveAgent(agent, current.agents);
      if ('error' in resolved) {
        respond(call.callId, false, resolved.error);
        return;
      }
      const target = current.agents.find((candidate) => candidate.id === resolved.id);
      const targetName = target?.name ?? resolved.id;
      const refusal = statusRefusal(targetName, current.statusOf(resolved.id));
      if (refusal !== null) {
        respond(call.callId, false, refusal);
        return;
      }
      const waitingCall: WaitingCall = { callId: call.callId, targetName, targetId: resolved.id, task };
      if (grants.current.has(session.id)) {
        void runDelegate(session.id, waitingCall);
        return;
      }
      const entry = waiting.current.get(session.id);
      if (entry === undefined) {
        const caller = current.agents.find((candidate) => candidate.id === session.profileId);
        const created: WaitingCard = {
          cardId: createId('act'),
          callerName: caller?.name ?? 'The agent',
          folder: session.cwd,
          calls: [waitingCall],
        };
        waiting.current.set(session.id, created);
        showCard(session, created, true);
        current.onAttention(session.id, 'needs-answer');
      } else {
        const grown = { ...entry, calls: [...entry.calls, waitingCall] };
        waiting.current.set(session.id, grown);
        showCard(session, grown, false);
      }
      bump();
    },
    [latest, runDelegate, showCard, bump],
  );

  const handleCall = useCallback(
    (payload: unknown) => {
      const call = parseToolCall(payload);
      if (call === null) return;
      try {
        const current = latest.current;
        const session = current.sessions.find((candidate) => candidate.id === call.sessionId);
        if (session === undefined || !sessionGetsAgentTools(session)) {
          respond(call.callId, false, NO_SESSION);
          return;
        }
        if (call.tool === 'list_agents') {
          const agents = current.agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            status: current.statusOf(agent.id),
          }));
          respond(call.callId, true, listAgentsText({ agents, delegates: current.delegatesOf(session.id) }));
          return;
        }
        if (call.tool === 'delegate') {
          handleDelegate(session, call);
          return;
        }
        respond(call.callId, false, NOT_YET);
      } catch {
        respond(call.callId, false, FAILED);
      }
    },
    [latest, handleDelegate],
  );

  /** A call ended without our answer (timeout, cancel, session stop): it no longer waits. */
  const handleEnded = useCallback(
    (payload: unknown) => {
      const callId = (payload as { callId?: unknown } | null)?.callId;
      if (typeof callId !== 'string') return;
      for (const [sessionId, entry] of waiting.current) {
        if (!entry.calls.some((call) => call.callId === callId)) continue;
        const calls = entry.calls.filter((call) => call.callId !== callId);
        const session = latest.current.sessions.find((candidate) => candidate.id === sessionId);
        if (calls.length === 0) {
          waiting.current.delete(sessionId);
          latest.current.updateMessages(sessionId, (prev) => settleToolCard(prev, entry.cardId, 'withdrawn'));
        } else {
          const shrunk = { ...entry, calls };
          waiting.current.set(sessionId, shrunk);
          if (session !== undefined) showCard(session, shrunk, false);
        }
        bump();
        return;
      }
    },
    [latest, showCard, bump],
  );

  useEffect(() => {
    let isMounted = true;
    const unlistenCall = listen<unknown>('agent-tool-call', (event) => {
      if (isMounted) handleCall(event.payload);
    }).catch(() => null);
    const unlistenEnded = listen<unknown>('agent-tool-call-ended', (event) => {
      if (isMounted) handleEnded(event.payload);
    }).catch(() => null);
    return () => {
      isMounted = false;
      void unlistenCall.then((stop) => stop?.());
      void unlistenEnded.then((stop) => stop?.());
    };
  }, [handleCall, handleEnded]);

  // A session that is gone keeps no grant and no waiting card.
  const { sessions } = deps;
  useEffect(() => {
    const live = new Set(sessions.map((session) => session.id));
    let hasChanged = false;
    for (const sessionId of [...grants.current]) {
      if (!live.has(sessionId)) hasChanged = grants.current.delete(sessionId) || hasChanged;
    }
    for (const sessionId of [...waiting.current.keys()]) {
      if (!live.has(sessionId)) hasChanged = waiting.current.delete(sessionId) || hasChanged;
    }
    if (hasChanged) bump();
  }, [sessions, bump]);

  const chooseCard = (sessionId: string, cardId: string, optionId: string): boolean => {
    const entry = waiting.current.get(sessionId);
    if (entry === undefined || entry.cardId !== cardId) return false;
    waiting.current.delete(sessionId);
    const isAllowed = optionId === ALLOW_SESSION;
    latest.current.updateMessages(sessionId, (prev) => settleToolCard(prev, cardId, isAllowed ? 'approved' : 'rejected'));
    if (isAllowed) {
      grants.current.add(sessionId);
      // In arrival order, one after the other: a second task for the same agent must find the first's delegate.
      void entry.calls.reduce(
        (previous, call) => previous.then(() => runDelegate(sessionId, call)),
        Promise.resolve(),
      );
    } else {
      for (const call of entry.calls) respond(call.callId, false, DECLINED);
    }
    bump();
    return true;
  };

  const revokeGrant = (sessionId: string): void => {
    if (grants.current.delete(sessionId)) bump();
  };

  return {
    chooseCard,
    hasGrant: (sessionId) => grants.current.has(sessionId),
    revokeGrant,
    isWaiting: (sessionId) => waiting.current.has(sessionId),
  };
}
