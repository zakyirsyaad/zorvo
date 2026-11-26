import type { RefObject } from 'react';
import type { ComposerHandle } from '../components/ComposerDock';
import { NO_CHOICES, type AcpChoices } from '../lib/acp-draft';
import { noAgentNotice } from '../lib/agent-readiness';
import { runOf } from '../lib/compare-run';
import { folderNameOf, nextSessionName, workspacePathOf } from '../lib/session-helpers';
import { namingFor, newSessionRecord, type SessionSpec, type StartSessionOptions } from '../lib/session-start';
import { attachmentsFor, createSessionWorktree } from '../lib/session-worktree';
import type { AgentProfile, ChatMessage, PersistedState, Session, SessionWorktree, Settings, Workspace } from '../types';
import type { FirstMessage } from './session-engine/useAcpEngine';
import type { NoticeTone } from './useNotice';
import type { OpenNewSessionOptions } from './useSessionImport';

export interface SessionStartWiringDeps {
  sessions: readonly Session[];
  workspaces: readonly Workspace[];
  activeWorkspace: Workspace | undefined;
  agentsInUse: readonly AgentProfile[];
  newSessionAgent: AgentProfile | undefined;
  privateDraftMode: Session['privateMode'] | undefined;
  paymentSource: Settings['paymentSource'];
  isWorktreeActive: boolean;
  baseBranch: string | undefined;
  startChoices: AcpChoices;
  noFolderNotice: string;
  startAcp: (session: Session, first?: FirstMessage, choices?: AcpChoices) => Promise<boolean>;
  updateState: (updater: (prev: PersistedState) => PersistedState) => void;
  updateMessages: (sessionId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  setActiveSessionId: (sessionId: string) => void;
  setActiveRunId: (runId: string | null) => void;
  setPickedAgentId: (agentId: string | null) => void;
  setGalleryOpen: (open: boolean) => void;
  setAcpChoices: (choices: AcpChoices) => void;
  setIsCreatingWorktree: (creating: boolean) => void;
  selectWorkspace: (path: string) => void;
  rememberFolder: (workspace: Workspace) => void;
  resetCompare: () => void;
  resetBranchPicker: () => void;
  giveBackMessage: (sessionId: string, text: string, attachments?: readonly string[]) => void;
  composerRef: RefObject<ComposerHandle | null>;
  setNotice: (message: string | null, tone?: NoticeTone) => void;
}

/**
 * Coordinates creating, starting, selecting, and navigating across sessions and compare runs,
 * including worktree provisioning and attachment path remapping for new sessions.
 */
export function useSessionStartWiring(deps: SessionStartWiringDeps) {
  const {
    sessions,
    workspaces,
    activeWorkspace,
    agentsInUse,
    newSessionAgent,
    privateDraftMode,
    paymentSource,
    isWorktreeActive,
    baseBranch,
    startChoices,
    noFolderNotice,
    startAcp,
    updateState,
    updateMessages,
    setActiveSessionId,
    setActiveRunId,
    setPickedAgentId,
    setGalleryOpen,
    setAcpChoices,
    setIsCreatingWorktree,
    selectWorkspace,
    rememberFolder,
    resetCompare,
    resetBranchPicker,
    giveBackMessage,
    composerRef,
    setNotice,
  } = deps;

  /** Records a new session and shows it, unless `focus` is false; the agent is started by its engine. */
  const recordSession = (spec: SessionSpec, options?: { focus?: boolean }): Session => {
    const session = newSessionRecord(spec);
    const { initialMessages } = spec;
    updateState((prev) => ({ ...prev, sessions: [session, ...prev.sessions] }));
    if (initialMessages) updateMessages(session.id, () => initialMessages);
    if (options?.focus !== false) setActiveSessionId(session.id);
    return session;
  };

  /**
   * Starts a session. A compare run passes the `choices` of this session's own agent (the draft's belong to
   * the draft agent) and clears the draft's once after the whole run, and `focus: false` to leave the view alone.
   */
  const startSession = (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => {
    const session = recordSession(spec, options);
    void startAcp(session, first, options?.choices ?? startChoices).then((isTaken) => {
      if (!isTaken && first) giveBackMessage(session.id, first.text, first.attachments);
    });
    // The picks went with the session; a later draft starts from the model picked last.
    if (!options?.choices) setAcpChoices(NO_CHOICES);
  };

  /** Makes `path` the active workspace; a folder only old sessions still use is added back to the recents. */
  const chooseFolder = (path: string) => {
    if (workspaces.some((ws) => ws.path === path)) selectWorkspace(path);
    else rememberFolder({ name: folderNameOf(path), path });
  };

  /**
   * Shows a new, empty session: the folder and agent can still be changed in
   * the composer, and the agent starts with the first message.
   */
  const openNewSession = (path?: string, agentId?: string, options?: OpenNewSessionOptions) => {
    setGalleryOpen(false);
    if (path) chooseFolder(path);
    setPickedAgentId(agentId ?? null);
    resetCompare();
    // A fresh draft: picks left from an earlier one would override the model picked last.
    // A failed import returns to the draft it started from, so its picks stay: it did not open.
    if (!options?.keepChoices) setAcpChoices(NO_CHOICES);
    setActiveSessionId('');
    setActiveRunId(null);
  };

  /**
   * Starts a session in the active workspace with the agent picked for it, in
   * a new worktree of it when Worktree is on.
   */
  const handleNewSession = async (first?: FirstMessage) => {
    // The backend rejects relative and missing cwds, so never spawn without a path.
    if (!activeWorkspace) {
      setNotice(noFolderNotice, 'warning');
      return;
    }
    if (!newSessionAgent) {
      setNotice(noAgentNotice(agentsInUse), 'warning');
      return;
    }
    rememberFolder(activeWorkspace);
    // Read now: the draft, and its Private chip with it, is gone once the session starts.
    const sessionPrivateMode = privateDraftMode
      ? { ...privateDraftMode, ...(paymentSource === 'ownKey' ? { ownKey: true } : {}) }
      : undefined;
    const naming = first
      ? namingFor(first, { agentName: newSessionAgent.name, folderName: activeWorkspace.name })
      : { name: nextSessionName(sessions) };
    const { name } = naming;
    let worktree: SessionWorktree | null = null;
    let cwd = activeWorkspace.path;
    let message = first;
    // The composer stays busy until the worktree and its attachments are ready, so a second Send cannot start.
    if (isWorktreeActive) setIsCreatingWorktree(true);
    try {
      if (isWorktreeActive) {
        try {
          ({ worktree, cwd } = await createSessionWorktree(activeWorkspace.path, name, baseBranch));
        } catch (error) {
          setNotice(`Could not create a worktree: ${String(error)}`);
          // The user may have opened another session meanwhile: the message goes
          // back into the new session it was written for, not that one's composer.
          openNewSession(activeWorkspace.path, newSessionAgent.id);
          if (first) composerRef.current?.restore(first.text, first.attachments);
          return;
        }
      }
      if (worktree && first?.attachments?.length) {
        // The composer attached paths in the main folder: the agent gets its worktree's files instead.
        try {
          message = { ...first, attachments: await attachmentsFor(activeWorkspace.path, cwd, first.attachments) };
        } catch (error) {
          setNotice(`Could not point the attachments into the worktree: ${String(error)}`);
        }
      }
    } finally {
      setIsCreatingWorktree(false);
    }
    setPickedAgentId(null);
    resetCompare();
    startSession({ agent: newSessionAgent, cwd, ...naming, worktree, privateMode: sessionPrivateMode }, message);
    // The base was this session's: the next draft starts from the folder's own branch.
    if (worktree) resetBranchPicker();
  };

  const handleSelectSession = (sessionId: string) => {
    setGalleryOpen(false);
    setActiveSessionId(sessionId);
    // An agent picked for a new session that was never started is forgotten.
    setPickedAgentId(null);
    resetCompare();
    const selected = sessions.find((s) => s.id === sessionId);
    const workspacePath = selected && workspacePathOf(selected);
    if (workspacePath && workspaces.some((ws) => ws.path === workspacePath)) selectWorkspace(workspacePath);
  };

  /** Shows a run's panel in the chat's place; no session stays selected, or the panel would not show. */
  const openRun = (runId: string) => {
    setGalleryOpen(false);
    setActiveSessionId('');
    setPickedAgentId(null);
    resetCompare();
    setActiveRunId(runId);
    const run = runOf(sessions, runId);
    const workspacePath = run && workspacePathOf(run.sessions[0]);
    if (workspacePath && workspaces.some((ws) => ws.path === workspacePath)) selectWorkspace(workspacePath);
  };

  const navigateTo = (sessionId: string | null) => {
    if (sessionId) handleSelectSession(sessionId);
  };

  return {
    recordSession,
    startSession,
    handleNewSession,
    chooseFolder,
    openNewSession,
    handleSelectSession,
    openRun,
    navigateTo,
  };
}
