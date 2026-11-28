import type { Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AcpEngine } from './session-engine/useAcpEngine';
import type { NavigationHistory } from './useNavigationHistory';
import { useLatest } from './useLatest';
import { closeTurn } from '../lib/acp-events';
import { isArchived, isListed, mostRecentSessionId, removeSessionFrom, workspacePathOf } from '../lib/session-helpers';
import { removeSessionWorktree } from '../lib/session-worktree';
import type { ChatMessage, PersistedState, Session } from '../types';

export interface SessionActionsDeps {
  sessions: Session[];
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  patchSession: (sessionId: string, patch: Partial<Session>) => void;
  updateState: (updater: (prev: PersistedState) => PersistedState) => void;
  updateMessages: (sessionId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  removeTranscript: (sessionId: string) => void;
  navigation: Pick<NavigationHistory, 'remove'>;
  acp: Pick<AcpEngine, 'stop'>;
  /** Ends the shells open in a folder; called once a session's worktree is removed. */
  closeTerminals?: (folderPath: string) => void;
  onNotice: (message: string) => void;
}

export interface SessionActions {
  deleteSession: (sessionId: string) => void;
  /** Permanently deletes every session (active, pinned, archived) belonging to a workspace folder. */
  deleteWorkspaceSessions: (workspacePath: string) => void;
  discardSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  pinSession: (sessionId: string, isPinned: boolean) => void;
  archiveSession: (sessionId: string, isArchived: boolean) => Promise<void>;
  /** Archives every unarchived, non-busy session belonging to a workspace folder. */
  archiveWorkspaceSessions: (workspacePath: string, isBusy: (sessionId: string) => boolean) => Promise<void>;
}

/** What can be done to a session: the sidebar's delete, rename, pin and archive, and an import's discard. */
export function useSessionActions(deps: SessionActionsDeps): SessionActions {
  const { sessions, setActiveSessionId, patchSession, acp, onNotice } = deps;
  const sessionsRef = useLatest(sessions);
  const sessionById = (sessionId: string) => sessions.find((s) => s.id === sessionId);

  /** Ends a session's agent when it runs; resolves with whether it is stopped. */
  const stopAgent = (session: Session | undefined): Promise<boolean> => {
    if (session?.status !== 'running') return Promise.resolve(true);
    return acp.stop(session.id);
  };

  /**
   * After a session leaves the list, the most recent listed one is shown if it
   * was. Read from the latest sessions: an archive may have waited for its
   * agent while other sessions were archived or deleted.
   */
  const selectNextAfter = (sessionId: string) =>
    setActiveSessionId((current) =>
      current === sessionId
        ? mostRecentSessionId(sessionsRef.current.filter((s) => s.id !== sessionId && isListed(s)))
        : current,
    );

  const deleteSession = (sessionId: string) => {
    const session = sessionById(sessionId);
    const stopped = stopAgent(session);
    // Only a private session has proxy records, a limit or a key to forget.
    if (session?.privateMode) void invoke('private_forget_session', { sessionId }).catch(() => {});
    deps.navigation.remove(sessionId);
    deps.updateState((prev) => removeSessionFrom(prev, sessionId));
    deps.removeTranscript(sessionId);
    if (session) {
      void removeSessionWorktree(session, sessions, stopped, (path) => {
        deps.closeTerminals?.(path);
        // A session can run in a folder inside its worktree; that folder's shells go too.
        if (session.cwd !== path) deps.closeTerminals?.(session.cwd);
      }).then((kept) => kept && onNotice(kept));
    }
    selectNextAfter(sessionId);
  };

  /**
   * Removes a session an import made and then failed: its record, its history
   * and its transcript. Nothing was started for it, so no agent is stopped and
   * the session open now does not change.
   */
  const discardSession = (sessionId: string) => {
    deps.navigation.remove(sessionId);
    deps.updateState((prev) => removeSessionFrom(prev, sessionId));
    deps.removeTranscript(sessionId);
  };

  const renameSession = (sessionId: string, name: string) => patchSession(sessionId, { name, namedByUser: true });

  const pinSession = (sessionId: string, isPinned: boolean) => patchSession(sessionId, { pinned: isPinned });

  /**
   * Archiving hides a session and ends its agent; its conversation and pin
   * stay, and the session can be continued after unarchiving it. A session
   * whose agent cannot be stopped stays listed, so nothing runs out of sight.
   */
  const archiveSession = async (sessionId: string, isArchived: boolean) => {
    if (!isArchived) {
      patchSession(sessionId, { archivedAt: null });
      return;
    }
    const session = sessionById(sessionId);
    const isRunning = session?.status === 'running';
    if (!(await stopAgent(session))) {
      onNotice(`Did not archive "${session?.name ?? 'the session'}": its agent could not be stopped.`);
      return;
    }
    // A stopped agent ends no turn itself: requests it was waiting on are answered as closed.
    if (isRunning) deps.updateMessages(sessionId, closeTurn);
    void invoke('browser_close_session', { sessionId }).catch(() => {});
    const now = Date.now();
    patchSession(sessionId, { archivedAt: now, ...(isRunning ? { status: 'terminated', endedAt: now } : {}) });
    selectNextAfter(sessionId);
  };

  const deleteWorkspaceSessions = (workspacePath: string) => {
    const targets = sessions.filter((s) => workspacePathOf(s) === workspacePath);
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((s) => s.id));
    const remaining = sessions.filter((s) => !targetIds.has(s.id));
    const stoppedByWorktree = new Map<string, { session: Session; stopped: Promise<boolean>[] }>();

    for (const session of targets) {
      const stopped = stopAgent(session);
      if (session.privateMode) void invoke('private_forget_session', { sessionId: session.id }).catch(() => {});
      deps.navigation.remove(session.id);
      deps.removeTranscript(session.id);
      if (session.worktree?.path) {
        const entry = stoppedByWorktree.get(session.worktree.path);
        if (entry) entry.stopped.push(stopped);
        else stoppedByWorktree.set(session.worktree.path, { session, stopped: [stopped] });
      }
    }

    deps.updateState((prev) => targets.reduce((acc, s) => removeSessionFrom(acc, s.id), prev));

    for (const { session, stopped } of stoppedByWorktree.values()) {
      const allStopped = Promise.all(stopped).then((results) => results.every(Boolean));
      void removeSessionWorktree(session, [session, ...remaining], allStopped, (path) => {
        deps.closeTerminals?.(path);
        if (session.cwd !== path) deps.closeTerminals?.(session.cwd);
      }).then((kept) => kept && onNotice(kept));
    }

    setActiveSessionId((current) =>
      targetIds.has(current)
        ? mostRecentSessionId(sessionsRef.current.filter((s) => !targetIds.has(s.id) && isListed(s)))
        : current,
    );
  };

  const archiveWorkspaceSessions = async (workspacePath: string, isBusy: (sessionId: string) => boolean) => {
    const targets = sessions.filter(
      (s) => workspacePathOf(s) === workspacePath && !isArchived(s) && !isBusy(s.id),
    );
    for (const session of targets) {
      await archiveSession(session.id, true);
    }
  };

  return {
    deleteSession,
    deleteWorkspaceSessions,
    discardSession,
    renameSession,
    pinSession,
    archiveSession,
    archiveWorkspaceSessions,
  };
}
