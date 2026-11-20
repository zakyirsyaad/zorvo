import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ALLOW_SESSION, browserCard, replaceToolCard, settleToolCard, withToolCard } from '../lib/agent-tool-card';
import { DECLINED, type AgentToolCall } from '../lib/agent-tools';
import { createId } from '../lib/ids';
import type { AgentProfile, ChatMessage, Session } from '../types';
import { useLatest } from './useLatest';

interface Dependencies {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  updateMessages: (sessionId: string, update: (messages: ChatMessage[]) => ChatMessage[]) => void;
  onAttention: (sessionId: string, reason: 'needs-answer') => void;
  onNotice?: (message: string) => void;
}
interface Waiting {
  cardId: string;
  calls: AgentToolCall[];
}

/**
 * Browser calls share useAgentTools' event intake and ordinary chat cards.
 * Only Rust owns authorization. The state below projects its status for the
 * session menu; every call reads the backend again before deciding to ask.
 */
export function useBrowserToolCards(deps: Dependencies) {
  const latest = useLatest(deps);
  const calls = useRef(new Map<string, AgentToolCall>());
  const waiting = useRef(new Map<string, Waiting>());
  const answering = useRef(new Set<string>());
  const observedSessions = useRef(new Set<string>());
  const revision = useRef(0);
  const mounted = useRef(true);
  const [status, setStatus] = useState<Readonly<Record<string, boolean>>>({});
  const [, setRevision] = useState(0);
  const bump = useCallback(() => { if (mounted.current) setRevision(value => value + 1); }, []);
  const project = useCallback((sessionId: string, allow: boolean) => {
    if (mounted.current) setStatus(previous => ({ ...previous, [sessionId]: allow }));
  }, []);
  const respond = useCallback((call: AgentToolCall, ok: boolean, text: string) => {
    if (!calls.current.delete(call.callId)) return;
    void invoke('agent_tool_respond', { callId: call.callId, ok, text }).catch(() => undefined);
  }, []);
  const show = useCallback((session: Session, entry: Waiting, isNew: boolean) => {
    const current = latest.current;
    const card = browserCard({
      cardId: entry.cardId, sessionId: session.id, folder: session.cwd,
      callerName: current.agents.find(agent => agent.id === session.profileId)?.name ?? 'The agent',
      operations: entry.calls.map(call => {
        const args = call.args as { operation?: unknown } | null;
        return typeof args?.operation === 'string' ? args.operation.slice(0, 80) : 'Browser operation';
      }), now: Date.now(),
    });
    current.updateMessages(session.id, messages => isNew
      ? withToolCard(messages, card, { sessionId: session.id, now: Date.now(), createId })
      : replaceToolCard(messages, entry.cardId, card));
  }, [latest]);
  const execute = useCallback(async (call: AgentToolCall) => {
    if (!calls.current.has(call.callId)) return;
    try {
      const result = await invoke('browser_agent_execute', { callId: call.callId });
      respond(call, true, JSON.stringify(result));
    } catch (error) { respond(call, false, String(error)); }
  }, [respond]);
  const handleCall = useCallback((session: Session, call: AgentToolCall): boolean => {
    if (call.tool !== 'browser' && call.tool !== 'browser_guide') return false;
    if (calls.current.has(call.callId)) return true;
    calls.current.set(call.callId, call);
    if (call.tool === 'browser_guide') {
      void invoke('browser_catalog').then(result => respond(call, true, JSON.stringify(result)), error => respond(call, false, String(error)));
      return true;
    }
    const epoch = revision.current;
    void invoke<boolean>('browser_permission_status', { sessionId: session.id }).then(allow => {
      if (!calls.current.has(call.callId) || !mounted.current) return;
      if (epoch === revision.current) project(session.id, allow === true);
      if (allow === true) { void execute(call); return; }
      const old = waiting.current.get(session.id);
      const entry = old ? { ...old, calls: [...old.calls, call] } : { cardId: createId('act'), calls: [call] };
      waiting.current.set(session.id, entry);
      show(session, entry, !old);
      if (!old) latest.current.onAttention(session.id, 'needs-answer');
      bump();
    }, () => respond(call, false, 'Browser permission could not be read.'));
    return true;
  }, [bump, execute, latest, project, respond, show]);
  const handleEnded = useCallback((callId: string) => {
    calls.current.delete(callId);
    for (const [sessionId, entry] of waiting.current) {
      if (!entry.calls.some(call => call.callId === callId)) continue;
      const remaining = entry.calls.filter(call => call.callId !== callId);
      const session = latest.current.sessions.find(item => item.id === sessionId);
      if (remaining.length === 0) {
        waiting.current.delete(sessionId);
        latest.current.updateMessages(sessionId, messages => settleToolCard(messages, entry.cardId, 'withdrawn'));
      } else if (session) {
        const shrunk = { ...entry, calls: remaining };
        waiting.current.set(sessionId, shrunk);
        show(session, shrunk, false);
      }
      bump();
    }
  }, [bump, latest, show]);
  const chooseCard = useCallback((sessionId: string, cardId: string, optionId: string): boolean => {
    const entry = waiting.current.get(sessionId);
    if (!entry || entry.cardId !== cardId) return false;
    if (answering.current.has(cardId)) return true;
    answering.current.add(cardId);
    const allow = optionId === ALLOW_SESSION;
    void (async () => {
      try {
        const original = waiting.current.get(sessionId)?.calls.find(call => calls.current.has(call.callId));
        if (!original) return;
        await invoke('browser_permission', { sessionId, allow, ...(allow ? { callId: original.callId } : {}) });
        project(sessionId, allow);
        // A timeout, cancellation or stopped session can end the card during the grant.
        const current = waiting.current.get(sessionId);
        if (!current || current.cardId !== cardId) return;
        waiting.current.delete(sessionId);
        latest.current.updateMessages(sessionId, messages => settleToolCard(messages, cardId, allow ? 'approved' : 'rejected'));
        bump();
        for (const call of current.calls) {
          if (!calls.current.has(call.callId)) continue;
          if (allow) await execute(call);
          else respond(call, false, DECLINED);
        }
      } catch {
        latest.current.onNotice?.('Browser permission could not be changed. Try again.');
        const current = waiting.current.get(sessionId);
        if (current?.cardId === cardId) {
          waiting.current.delete(sessionId);
          latest.current.updateMessages(sessionId, messages => settleToolCard(messages, cardId, 'rejected'));
          for (const call of current.calls) respond(call, false, 'Browser permission could not be changed.');
          bump();
        }
      } finally { answering.current.delete(cardId); }
    })();
    return true;
  }, [bump, execute, latest, project, respond]);
  const revokeGrant = useCallback((sessionId: string) => {
    void invoke('browser_permission', { sessionId, allow: false }).then(() => project(sessionId, false), () => {
      latest.current.onNotice?.('Browser permission could not be changed. Try again.');
    });
  }, [latest, project]);

  useEffect(() => {
    mounted.current = true;
    const currentCalls = calls.current;
    const currentWaiting = waiting.current;
    const stop = listen<{ sessionId: string; allow: boolean }>('browser-permission-changed', event => {
      if (typeof event.payload.sessionId !== 'string' || typeof event.payload.allow !== 'boolean') return;
      revision.current++;
      project(event.payload.sessionId, event.payload.allow);
    }).catch(() => null);
    return () => {
      mounted.current = false;
      currentCalls.clear();
      currentWaiting.clear();
      void stop.then(unlisten => unlisten?.());
    };
  }, [project]);
  useEffect(() => {
    const epoch = revision.current;
    const live = new Set(deps.sessions.filter(session => session.status !== 'terminated').map(session => session.id));
    for (const call of calls.current.values()) if (!live.has(call.sessionId)) handleEnded(call.callId);
    const newSessions = [...live].filter(sessionId => !observedSessions.current.has(sessionId));
    observedSessions.current = live;
    if (newSessions.length === 0) return;
    void Promise.all(newSessions.map(async sessionId => {
      try { return [sessionId, await invoke<boolean>('browser_permission_status', { sessionId }) === true] as const; }
      catch { return [sessionId, false] as const; }
    })).then(rows => {
      const current = new Set(latest.current.sessions.filter(session => session.status !== 'terminated').map(session => session.id));
      if (mounted.current && epoch === revision.current) setStatus(previous => ({ ...previous,
        ...Object.fromEntries(rows.filter(([sessionId]) => current.has(sessionId))),
      }));
    });
  }, [deps.sessions, handleEnded, latest]);
  return { handleCall, handleEnded, chooseCard, revokeGrant,
    hasGrant: (sessionId: string) => status[sessionId] === true,
    isWaiting: (sessionId: string) => waiting.current.has(sessionId) };
}
