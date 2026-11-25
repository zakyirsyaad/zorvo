import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { ComposerHandle } from '../components/ComposerDock';
import type { AuthMethod } from '../lib/acp-auth';
import type { AgentOptions, ProbedOptions } from '../lib/acp-draft';
import type { CompareRun } from '../lib/compare-run';
import { notifyIfAway } from '../lib/notify';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import type { AgentProfile, ChatMessage, Session, Workspace } from '../types';
import type { FirstMessage } from './session-engine/useAcpEngine';
import { useCompareModelProbe } from './useCompareModelProbe';
import { useCompareRun, useCompareRunRows } from './useCompareRun';
import { useLatest } from './useLatest';
import type { NoticeTone } from './useNotice';

export interface CompareRunWiringDeps {
  sessions: readonly Session[];
  activeSession: Session | undefined;
  activeSessionId: string;
  activeRun: CompareRun | null;
  activeWorkspace: Workspace | undefined;
  shownFolderPath: string | undefined;
  isNewSessionDraft: boolean;
  isComposerHidden: boolean;
  isComposerHiddenRef: RefObject<boolean>;
  composerRef: RefObject<ComposerHandle | null>;
  pendingRestoreRef: MutableRefObject<(FirstMessage & { sessionId?: string }) | null>;
  agents: readonly AgentProfile[];
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  compareAgentIds: readonly string[];
  baseBranch: string | undefined;
  noFolderNotice: string;
  isSessionBusy: (sessionId: string) => boolean;
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  failedTurns: Readonly<Record<string, string>>;
  isAgentRemovedFor: (sessionId: string) => boolean;
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
  openNewSession: (path?: string, agentId?: string) => void;
  rememberFolder: (folder: Workspace) => void;
  setActiveRunId: (runId: string | null) => void;
  setActiveSessionId: (sessionId: string) => void;
  setIsCreatingWorktree: (isBusy: boolean) => void;
  onRunStarted: () => void;
  rememberProbed: (profileId: string, probed: ProbedOptions) => void;
  markSignedIn: (profileId: string) => void;
  markSignInNeeded: (profileId: string) => void;
  askSignIn: (session: Session, methods: AuthMethod[], unsent?: FirstMessage) => void;
  archiveSession: (sessionId: string, isArchived: boolean) => Promise<void>;
  readSessions: () => readonly Session[];
  ensureLoaded: (sessionId: string) => void;
  setNotice: (message: string, tone?: NoticeTone) => void;
}

/**
 * Joins a compare draft's model probe, the active compare run, kept sign-in
 * hand-off and deferred message restores.
 */
export function useCompareRunWiring({
  sessions,
  activeSession,
  activeSessionId,
  activeRun,
  activeWorkspace,
  shownFolderPath,
  isNewSessionDraft,
  isComposerHidden,
  isComposerHiddenRef,
  composerRef,
  pendingRestoreRef,
  agents,
  agentOptions,
  compareAgentIds,
  baseBranch,
  noFolderNotice,
  isSessionBusy,
  transcripts,
  failedTurns,
  isAgentRemovedFor,
  startSession,
  openNewSession,
  rememberFolder,
  setActiveRunId,
  setActiveSessionId,
  setIsCreatingWorktree,
  onRunStarted,
  rememberProbed,
  markSignedIn,
  markSignInNeeded,
  askSignIn,
  archiveSession,
  readSessions,
  ensureLoaded,
  setNotice,
}: CompareRunWiringDeps) {
  // A compare draft's model chips: an agent whose models are unknown is asked only when its chip opens.
  const compareAgentIdsRef = useLatest(compareAgentIds);
  const compareModelProbe = useCompareModelProbe({
    cwd: shownFolderPath ?? undefined,
    agentOptions,
    onProbed: rememberProbed,
    onSignedIn: markSignedIn,
    onNeedsSignIn: (profileId) => {
      // Marked as needing a sign-in, it can no longer be ticked, so it leaves the run; say so only if it was in it.
      const wasInRun = compareAgentIdsRef.current.includes(profileId);
      markSignInNeeded(profileId);
      if (wasInRun) {
        const name = agents.find((a) => a.id === profileId)?.name ?? profileId;
        setNotice(`${name} needs a sign-in, so it left the run. Pick it alone to sign in.`);
      }
    },
  });

  // Read when a run's worktrees are done, seconds after the click: an empty session id also means a run's panel.
  const isDraftRef = useLatest(isNewSessionDraft);
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending) return;
    if (pending.sessionId !== undefined && !sessions.some((s) => s.id === pending.sessionId)) {
      pendingRestoreRef.current = null;
    }
    if (!pendingRestoreRef.current || !composerRef.current || isComposerHidden) return;
    if (
      pending.sessionId !== undefined &&
      (pending.sessionId !== activeSessionId || isAgentRemovedFor(pending.sessionId))
    ) {
      return;
    }
    pendingRestoreRef.current = null;
    composerRef.current.restore(pending.text, pending.attachments);
  });

  const rowSources = { isBusy: isSessionBusy, transcripts, failedTurns };
  const compareRun = useCompareRun({
    repoPath: activeWorkspace?.path ?? '',
    baseBranch,
    agentOptions,
    startSession,
    isOnDraft: () => isDraftRef.current,
    openRun: setActiveRunId,
    setIsBusy: setIsCreatingWorktree,
    // The user may have opened another session meanwhile: the message goes back into the new session it was written for.
    restoreMessage: (message, agentId) => {
      if (!isDraftRef.current || !activeWorkspace) openNewSession(activeWorkspace?.path, agentId);
      // The message waits for the new draft to show the composer.
      if (composerRef.current && !isComposerHiddenRef.current) {
        composerRef.current.restore(message.text, message.attachments);
      } else {
        pendingRestoreRef.current = message;
      }
    },
    onStarted: onRunStarted,
    onNotice: setNotice,
    archiveSession,
    readSessions,
    openSession: setActiveSessionId,
    agentName: (profileId) => agents.find((a) => a.id === profileId)?.name ?? 'The agent',
    sessions,
    sources: rowSources,
    askSignIn,
    // A notification that cannot be shown is not worth an error banner: the panel has it all.
    notifyRun: (notice) => void notifyIfAway(notice).catch(() => {}),
  });

  // The session on screen when it is not in a compare run (a run's sessions share one title, as the sidebar's menu has it).
  const sessionOfItsOwn = activeSession && !compareRun.isInRun(activeSession.id) ? activeSession : undefined;
  // However a session comes on screen, its refusal is taken up there: only now does its composer show.
  const { takeSignIn } = compareRun;
  const refusedHere = compareRun.signInNeeded.get(activeSessionId);
  useEffect(() => {
    if (refusedHere) takeSignIn(activeSessionId);
  }, [activeSessionId, refusedHere, takeSignIn]);

  const runRows = useCompareRunRows(activeRun, {
    ...rowSources,
    signInNeeded: compareRun.signInNeeded,
    ensureLoaded,
  });

  /** Starts the ticked agents on one prompt, each in its own worktree. */
  const handleNewRun = (message: FirstMessage) => {
    if (!activeWorkspace) {
      setNotice(noFolderNotice, 'warning');
      return;
    }
    rememberFolder(activeWorkspace);
    const picked = compareAgentIds.flatMap((id) => agents.filter((a) => a.id === id));
    void compareRun.startRun(picked, message);
  };

  return { compareModelProbe, compareRun, sessionOfItsOwn, runRows, handleNewRun };
}
