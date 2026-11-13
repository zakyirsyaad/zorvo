import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ALLOW_ONCE,
  ALLOW_SESSION,
  folderCard,
  replaceToolCard,
  settleToolCard,
  toolCardFor,
  withToolCard,
  type WaitingTask,
} from '../lib/agent-tool-card';
import {
  DECLINED,
  NO_SESSION,
  NO_SUCH_HANDLE,
  UNREADABLE,
  delegateResultText,
  listAgentsText,
  openedResultText,
  otherFolders,
  ownedByHandle,
  readSessionText,
  stopResultText,
  parseToolCall,
  resolveAgent,
  resolveFolder,
  sessionGetsAgentTools,
  statusRefusal,
  type AgentToolCall,
  type DelegateState,
  type KnownFolder,
  type ListedDelegate,
  type ListedOpened,
} from '../lib/agent-tools';
import type { MentionAgentStatus } from '../lib/delegation';
import { createId } from '../lib/ids';
import type { AgentProfile, ChatMessage, Session } from '../types';
import type { GiveTaskResult } from './useDelegation';
import type { OpenRequest, OpenResult } from './useOpenedSessions';
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
  /** The folders Zorvo knows: where else a session may be opened. */
  workspaces: readonly KnownFolder[];
  openSession: (openerId: string, request: OpenRequest) => Promise<OpenResult>;
  /** The sessions this session opened, for `list_agents`. */
  openedOf: (sessionId: string) => ListedOpened[];
  updateMessages: (sessionId: string, update: (prev: ChatMessage[]) => ChatMessage[]) => void;
  onAttention: (sessionId: string, reason: 'needs-answer') => void;
  /** A session's messages, loaded from disk when it was not opened in this run. Rejects when unreadable. */
  messagesOf: (sessionId: string) => Promise<readonly ChatMessage[]>;
  stateOf: (sessionId: string) => DelegateState;
  /** Stops the session's turn, as the Stop button does. */
  stopTurn: (sessionId: string) => void;
  /** Tells the user what an agent is not told: why Zorvo itself failed. */
  onNotice?: (message: string) => void;
}

/** A `delegate` or `start_session` call that waits for the user's answer on a card. */
interface WaitingCall extends WaitingTask {
  callId: string;
  /** A new session's name, when the agent gave one. */
  title?: string;
  /** A new session in another folder Zorvo knows. */
  folderPath?: string;
}

/** A session in another folder has a card of its own, asked every time. */
interface FolderCard {
  sessionId: string;
  call: WaitingCall;
}

/** The folder the session belongs to: its repository when it works in a worktree. */
function ownFolderOf(session: Session): string {
  return session.worktree?.repoPath ?? session.cwd;
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
  // The cards for a session in another folder, by card id: one call each, never a grant.
  const folderCards = useRef(new Map<string, FolderCard>());
  // Calls the user allowed that have not finished: running, or queued behind another of their card.
  // Those among them whose call ended meanwhile must start nothing.
  const approved = useRef(new Map<string, string>());
  const endedApproved = useRef(new Set<string>());
  // The allowed calls that have begun: taking a grant back cannot undo those.
  const begun = useRef(new Set<string>());
  // Bumped when a grant or a waiting card changes, so `isWaiting` and `hasGrant` are read again.
  const [, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((current) => current + 1), []);

  const runDelegate = useCallback(
    async (sessionId: string, call: WaitingCall): Promise<void> => {
      try {
        const result = await latest.current.giveTask(sessionId, call.targetId, call.task, { byAgent: true });
        if (result.ok) {
          const text = delegateResultText({
            kind: result.kind,
            sessionName: result.sessionName,
            agentName: call.targetName,
            // A delegate is named by its agent's id: a session holds one per agent.
            handle: call.targetId,
          });
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

  const runOpen = useCallback(
    async (sessionId: string, call: WaitingCall): Promise<void> => {
      try {
        const result = await latest.current.openSession(sessionId, {
          agentId: call.targetId,
          brief: call.task,
          ...(call.title !== undefined ? { title: call.title } : {}),
          hasOwnWorktree: call.hasOwnWorktree === true,
          ...(call.folderPath !== undefined ? { folderPath: call.folderPath } : {}),
          isCancelled: () => endedApproved.current.has(call.callId),
        });
        if (!result.ok && result.detail !== undefined) {
          // The agent is told only that it did not work; the cause is the user's to see.
          const current = latest.current;
          const opener = current.sessions.find((candidate) => candidate.id === sessionId);
          const callerName = current.agents.find((candidate) => candidate.id === opener?.profileId)?.name ?? 'The agent';
          current.onNotice?.(`${callerName} could not open a ${call.targetName} session: ${result.detail}`);
        }
        // A refusal's reason is written for the caller; the error itself stays in `detail`.
        respond(
          call.callId,
          result.ok,
          result.ok
            ? openedResultText({ sessionName: result.sessionName, folder: result.folder, handle: result.handle })
            : result.reason === ''
              ? FAILED
              : result.reason,
        );
      } catch {
        respond(call.callId, false, FAILED);
      }
    },
    [latest],
  );

  /** Runs an allowed call, unless it ended while it waited its turn: nobody waits for that one. */
  const runCall = useCallback(
    async (sessionId: string, call: WaitingCall): Promise<void> => {
      try {
        if (endedApproved.current.has(call.callId)) return;
        begun.current.add(call.callId);
        await (call.kind === 'delegate' ? runDelegate(sessionId, call) : runOpen(sessionId, call));
      } finally {
        approved.current.delete(call.callId);
        endedApproved.current.delete(call.callId);
        begun.current.delete(call.callId);
      }
    },
    [runDelegate, runOpen],
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

  /** Runs a call the session is allowed to make, or puts it on the session's card. */
  const enqueue = useCallback(
    (session: Session, waitingCall: WaitingCall) => {
      const current = latest.current;
      if (grants.current.has(session.id)) {
        approved.current.set(waitingCall.callId, session.id);
        void runCall(session.id, waitingCall);
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
    [latest, runCall, showCard, bump],
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
      enqueue(session, { callId: call.callId, kind: 'delegate', targetName, targetId: resolved.id, task });
    },
    [latest, enqueue],
  );

  const handleStartSession = useCallback(
    (session: Session, call: AgentToolCall) => {
      const current = latest.current;
      const { agent, brief, title, worktree, folder } = call.args as Record<string, unknown>;
      const isReadable =
        typeof agent === 'string' &&
        typeof brief === 'string' &&
        (title === undefined || typeof title === 'string') &&
        (worktree === undefined || typeof worktree === 'boolean') &&
        (folder === undefined || typeof folder === 'string');
      if (!isReadable) {
        respond(call.callId, false, FAILED);
        return;
      }
      const resolved = resolveAgent(agent as string, current.agents);
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
      const waitingCall: WaitingCall = {
        callId: call.callId,
        kind: 'start_session',
        targetName,
        targetId: resolved.id,
        task: brief as string,
        ...(typeof title === 'string' ? { title } : {}),
        ...(worktree === true ? { hasOwnWorktree: true } : {}),
      };
      if (typeof folder !== 'string') {
        enqueue(session, waitingCall);
        return;
      }

      // Another folder: its own card, every time, whatever the session was allowed before.
      const place = resolveFolder(folder, { workspaces: current.workspaces, callerCwd: ownFolderOf(session) });
      if ('error' in place) {
        respond(call.callId, false, place.error);
        return;
      }
      const caller = current.agents.find((candidate) => candidate.id === session.profileId);
      const cardId = createId('act');
      const card = folderCard({
        cardId,
        sessionId: session.id,
        callerName: caller?.name ?? 'The agent',
        targetName,
        targetId: resolved.id,
        folder: place.path,
        brief: brief as string,
        hasOwnWorktree: worktree === true,
        now: Date.now(),
      });
      folderCards.current.set(cardId, { sessionId: session.id, call: { ...waitingCall, folderPath: place.path } });
      current.updateMessages(session.id, (prev) =>
        withToolCard(prev, card, { sessionId: session.id, now: Date.now(), createId }),
      );
      current.onAttention(session.id, 'needs-answer');
      bump();
    },
    [latest, enqueue, bump],
  );

  /** `read_session` and `stop_session`: only the caller's own sessions, by handle; no card and no grant. */
  const handleOwned = useCallback(
    (session: Session, call: AgentToolCall) => {
      const current = latest.current;
      const { handle, max_chars: maxChars } = call.args as Record<string, unknown>;
      const isReadable =
        typeof handle === 'string' &&
        (maxChars === undefined || (typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 1));
      if (!isReadable) {
        respond(call.callId, false, FAILED);
        return;
      }
      const target = ownedByHandle(session.id, handle as string, current.sessions);
      if (target === undefined) {
        respond(call.callId, false, NO_SUCH_HANDLE);
        return;
      }
      if (call.tool === 'stop_session') {
        const wasWorking = current.stateOf(target.id) !== 'idle';
        if (wasWorking) current.stopTurn(target.id);
        respond(call.callId, true, stopResultText(wasWorking));
        return;
      }
      current
        .messagesOf(target.id)
        .then((messages) =>
          respond(
            call.callId,
            true,
            readSessionText({
              messages,
              state: latest.current.stateOf(target.id),
              cwd: target.cwd,
              ...(typeof maxChars === 'number' ? { maxChars } : {}),
            }),
          ),
        )
        // The cause could hold a path, so the agent is told only that it did not work.
        .catch(() => respond(call.callId, false, UNREADABLE));
    },
    [latest],
  );

  const handleCall = useCallback(
    (payload: unknown) => {
      const call = parseToolCall(payload);
      if (call === null) return;
      try {
        const current = latest.current;
        const session = current.sessions.find((candidate) => candidate.id === call.sessionId);
        // A session whose agent has exited makes no calls: whatever still holds its token is not it.
        const isLive = session !== undefined && session.status !== 'terminated';
        if (session === undefined || !isLive || !sessionGetsAgentTools(session, current.sessions)) {
          respond(call.callId, false, NO_SESSION);
          return;
        }
        if (call.tool === 'list_agents') {
          const agents = current.agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            status: current.statusOf(agent.id),
          }));
          respond(
            call.callId,
            true,
            listAgentsText({
              agents,
              delegates: current.delegatesOf(session.id),
              opened: current.openedOf(session.id),
              folders: otherFolders(current.workspaces, ownFolderOf(session)),
            }),
          );
          return;
        }
        if (call.tool === 'delegate') {
          handleDelegate(session, call);
          return;
        }
        if (call.tool === 'start_session') {
          handleStartSession(session, call);
          return;
        }
        if (call.tool === 'read_session' || call.tool === 'stop_session') {
          handleOwned(session, call);
          return;
        }
        respond(call.callId, false, FAILED);
      } catch {
        respond(call.callId, false, FAILED);
      }
    },
    [latest, handleDelegate, handleStartSession, handleOwned],
  );

  /** A call ended without our answer (timeout, cancel, session stop): it no longer waits. */
  const handleEnded = useCallback(
    (payload: unknown) => {
      const callId = (payload as { callId?: unknown } | null)?.callId;
      if (typeof callId !== 'string') return;
      // An allowed call is on no card any more: it is skipped, or told through its request.
      if (approved.current.has(callId)) {
        endedApproved.current.add(callId);
        return;
      }
      for (const [cardId, folder] of folderCards.current) {
        if (folder.call.callId !== callId) continue;
        folderCards.current.delete(cardId);
        latest.current.updateMessages(folder.sessionId, (prev) => settleToolCard(prev, cardId, 'withdrawn'));
        bump();
        return;
      }
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
    for (const [cardId, folder] of [...folderCards.current]) {
      if (!live.has(folder.sessionId)) hasChanged = folderCards.current.delete(cardId) || hasChanged;
    }
    if (hasChanged) bump();
  }, [sessions, bump]);

  const chooseCard = (sessionId: string, cardId: string, optionId: string): boolean => {
    const folder = folderCards.current.get(cardId);
    if (folder !== undefined && folder.sessionId === sessionId) {
      folderCards.current.delete(cardId);
      // Allowed once: this session opens, and nothing is remembered for the next call.
      const isAllowedOnce = optionId === ALLOW_ONCE;
      latest.current.updateMessages(sessionId, (prev) =>
        settleToolCard(prev, cardId, isAllowedOnce ? 'approved' : 'rejected'),
      );
      if (isAllowedOnce) {
        approved.current.set(folder.call.callId, sessionId);
        void runCall(sessionId, folder.call);
      }
      else respond(folder.call.callId, false, DECLINED);
      bump();
      return true;
    }
    const entry = waiting.current.get(sessionId);
    if (entry === undefined || entry.cardId !== cardId) return false;
    waiting.current.delete(sessionId);
    const isAllowed = optionId === ALLOW_SESSION;
    latest.current.updateMessages(sessionId, (prev) => settleToolCard(prev, cardId, isAllowed ? 'approved' : 'rejected'));
    if (isAllowed) {
      grants.current.add(sessionId);
      for (const call of entry.calls) approved.current.set(call.callId, sessionId);
      // In arrival order, one after the other: a second task for the same agent must find the first's delegate.
      void entry.calls.reduce(
        (previous, call) => previous.then(() => runCall(sessionId, call)),
        Promise.resolve(),
      );
    } else {
      for (const call of entry.calls) respond(call.callId, false, DECLINED);
    }
    bump();
    return true;
  };

  const revokeGrant = (sessionId: string): void => {
    if (!grants.current.delete(sessionId)) return;
    // What the grant allowed and has not begun is declined; a call that already runs finishes.
    for (const [callId, owner] of approved.current) {
      if (owner !== sessionId || begun.current.has(callId) || endedApproved.current.has(callId)) continue;
      endedApproved.current.add(callId);
      respond(callId, false, DECLINED);
    }
    bump();
  };

  return {
    chooseCard,
    hasGrant: (sessionId) => grants.current.has(sessionId),
    revokeGrant,
    isWaiting: (sessionId) =>
      waiting.current.has(sessionId) ||
      [...folderCards.current.values()].some((folder) => folder.sessionId === sessionId),
  };
}
