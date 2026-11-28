import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { ComposerHandle } from '../components/ComposerDock';
import type { DelegateAgentChoice } from '../components/delegation/DelegateDialog';
import { NO_CHOICES, withPreferred, type AcpChoices, type AgentOptions } from '../lib/acp-draft';
import { isAgentReady } from '../lib/agent-readiness';
import type { SignInState } from '../lib/agent-sign-in';
import {
  followUpSummary,
  isOpenLink,
  mentionBlockedReason,
  openDelegatesOf,
  soleOpenDelegateOf,
  startSummary,
  type MentionAgentStatus,
} from '../lib/delegation';
import { delegatedStartOf } from '../lib/delegation-start';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import type { StartPlaces } from '../lib/start-places';
import type { AgentProfile, ChatMessage, DelegationLink, Session, WorkerTurnEnd } from '../types';
import type { AttentionReason, FirstMessage } from './session-engine/useAcpEngine';
import { useDelegateDialog, type DelegateDialogDeps } from './useDelegateDialog';
import { useDelegation, type DelegationDeps } from './useDelegation';
import { useNow } from './useNow';
import { useWorkerAutoClose } from './useWorkerAutoClose';
import { useWorkerStops } from './useWorkerStops';

export interface DelegationRuntimeDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  isSessionBusy: (sessionId: string) => boolean;
  isSessionWaiting: (sessionId: string) => boolean;
  isAgentRemovedFor: (sessionId: string) => boolean;
  signInStateOf: (profileId: string) => SignInState;
  startPlaces: StartPlaces;
  send: DelegationDeps['send'];
  stopAgent: (sessionId: string) => Promise<boolean>;
  resumeAgent: (session: Session, acpSessionId: string, message: FirstMessage, choices: AcpChoices) => Promise<boolean>;
  canReopen: (sessionId: string) => boolean;
  isTurnUnderWay: (sessionId: string) => boolean;
  hasLiveTasks: (sessionId: string) => boolean;
  hasFailedTurn: (sessionId: string) => boolean;
  hasQueuedMessages: (sessionId: string) => boolean;
  ensureLoaded: (sessionId: string) => void;
  patchSession: (sessionId: string, patch: Partial<Session>) => void;
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
  selectSession: (sessionId: string) => void;
  updateLink: (sessionId: string, change: (link: DelegationLink) => DelegationLink) => void;
  readMessages: (sessionId: string) => Promise<ChatMessage[]>;
  giveBack: (sessionId: string, text: string, attachments?: readonly string[]) => void;
  onNotice: (message: string) => void;
  delegationTurnEndedRef: MutableRefObject<(sessionId: string, reason: AttentionReason) => void>;
  delegationTurnSettledRef: MutableRefObject<(sessionId: string, end: { how: WorkerTurnEnd; reason?: string }) => void>;
  delegationBlockedRef: MutableRefObject<(sessionId: string) => string | null>;
}

/**
 * Coordinates worker stop tracking, worker resumption, delegation lifecycle, auto-close timers,
 * ACP engine ref synchronization, and archiving cleanup for delegation links.
 */
export function useDelegationRuntime(deps: DelegationRuntimeDeps) {
  const {
    sessions,
    agents,
    transcripts,
    agentOptions,
    isSessionBusy,
    isSessionWaiting,
    isAgentRemovedFor,
    signInStateOf,
    startPlaces,
    send,
    stopAgent,
    resumeAgent,
    canReopen,
    isTurnUnderWay,
    hasLiveTasks,
    hasFailedTurn,
    hasQueuedMessages,
    ensureLoaded,
    patchSession,
    startSession,
    selectSession,
    updateLink,
    readMessages,
    giveBack,
    onNotice,
    delegationTurnEndedRef,
    delegationTurnSettledRef,
    delegationBlockedRef,
  } = deps;

  const sessionById = (sessionId: string) => sessions.find((s) => s.id === sessionId);

  /** Whether a session's agent can take a prompt now: the test a delegation report is delivered by. */
  const canPrompt = (sessionId: string): boolean => {
    const session = sessionById(sessionId);
    if (session === undefined || session.status !== 'running') return false;
    if (isSessionBusy(sessionId) || isSessionWaiting(sessionId) || isAgentRemovedFor(sessionId)) return false;
    const agent = agents.find((candidate) => candidate.id === session.profileId);
    return agent !== undefined && isAgentReady(agent) && signInStateOf(agent.id) !== 'needed';
  };

  const workerStops = useWorkerStops({
    sessions,
    stop: stopAgent,
    markTerminated: (sessionId) => patchSession(sessionId, { status: 'terminated', endedAt: Date.now() }),
  });

  /** Reopens a worker whose agent was closed after its turn; the session and its history stayed. */
  const resumeWorker = async (sessionId: string, message: FirstMessage): Promise<boolean> => {
    const session = sessionById(sessionId);
    if (session === undefined || !session.acpSessionId) return false;
    workerStops.forget(sessionId);
    // Its chat may not have been opened in this run: without the load registered first, the task
    // would be saved as the whole conversation, over the history on disk.
    ensureLoaded(sessionId);
    patchSession(sessionId, { status: 'running', endedAt: null, exitCode: null });
    // The model last picked for this agent is applied again, as for a user's resume; the draft's own picks are not this worker's.
    return resumeAgent(session, session.acpSessionId, message, withPreferred(NO_CHOICES, agentOptions?.[session.profileId]));
  };

  const delegation = useDelegation({
    sessions,
    agents,
    transcripts,
    isBusy: isSessionBusy,
    canPrompt,
    isWaiting: isSessionWaiting,
    places: startPlaces,
    send,
    resume: resumeWorker,
    canResume: (sessionId) => Boolean(sessionById(sessionId)?.acpSessionId),
    pendingStop: workerStops.pendingStop,
    stopWorker: workerStops.stopWorker,
    isTurnUnderWay,
    startSession,
    selectSession,
    updateLink,
    messagesOf: async (sessionId) => {
      try {
        return await readMessages(sessionId);
      } catch {
        return null;
      }
    },
    giveBack,
    onNotice,
  });

  // Main window only: a popout must not stop agents.
  useWorkerAutoClose({
    sessions,
    isBusy: isSessionBusy,
    isWaiting: isSessionWaiting,
    canReopen,
    isTurnUnderWay,
    isSendingTo: delegation.isSendingTo,
    hasLiveTasks,
    hasFailedTurn,
    hasQueuedMessages,
    stop: workerStops.stopWorker,
  });

  // The engine was built before this hook: its turn ends reach it through the ref.
  delegationTurnEndedRef.current = delegation.onTurnEnded;
  delegationTurnSettledRef.current = delegation.onTurnSettled;
  // A retry reads this when it runs: the hook's latest verdict, not the render that built the engine.
  useEffect(() => {
    delegationBlockedRef.current = delegation.sendBlockedReason;
  });

  const endForArchived = (sessionId: string, latestSessions: readonly Session[]) => {
    delegation.end(sessionId);
    for (const delegate of openDelegatesOf(sessionId, latestSessions)) delegation.end(delegate.id);
  };

  return { delegation, endForArchived };
}

export interface DelegationUiDeps {
  sessions: readonly Session[];
  activeSession: Session | undefined;
  activeSessionId: string;
  sessionOfItsOwn: Session | undefined;
  agents: readonly AgentProfile[];
  agentsInUse: readonly AgentProfile[];
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  signInStateOf: (profileId: string) => SignInState;
  isInCompareRun: (sessionId: string) => boolean;
  isSessionBusy: (sessionId: string) => boolean;
  delegationMention: { agentId: string; task: string } | null;
  delegation: Pick<ReturnType<typeof useDelegation>, 'start' | 'end' | 'delegateBlockedReason' | 'sendBlockedReason' | 'viewsFor'>;
  compareModelProbe: DelegateDialogDeps['probe'];
  composerRef: RefObject<ComposerHandle | null>;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

/** What the @ list and dialog say about an agent: its install and sign-in state. */
export function delegationStatusFor(
  agent: AgentProfile,
  signInStateOf: (profileId: string) => SignInState,
): MentionAgentStatus {
  if (!isAgentReady(agent)) return 'not-installed';
  const signIn = signInStateOf(agent.id);
  return signIn === 'needed' ? 'needs-sign-in' : signIn === 'ready' ? 'ready' : 'not-checked';
}

/**
 * Derives delegation UI state for the composer mention bar, delegate dialog,
 * session menu actions, and active delegation status banners.
 */
export function useDelegationUi(deps: DelegationUiDeps) {
  const {
    sessions,
    activeSession,
    activeSessionId,
    sessionOfItsOwn,
    agents,
    agentsInUse,
    agentOptions,
    signInStateOf,
    isInCompareRun,
    isSessionBusy,
    delegationMention,
    delegation,
    compareModelProbe,
    composerRef,
    menuButtonRef,
  } = deps;

  const delegationStatusOf = (agent: AgentProfile): MentionAgentStatus =>
    delegationStatusFor(agent, signInStateOf);

  const mentionedAgent =
    delegationMention === null ? undefined : agents.find((agent) => agent.id === delegationMention.agentId);

  // A mention is the whole message, so the @ group shows only for a session of its own that may delegate.
  const activeDelegateBlockedReason = sessionOfItsOwn
    ? delegation.delegateBlockedReason(sessionOfItsOwn.id)
    : null;
  const mayDelegateHere =
    activeSession !== undefined &&
    !isInCompareRun(activeSession.id) &&
    activeSession.delegatedFrom == null &&
    activeDelegateBlockedReason !== '';
  const delegationAgents = mayDelegateHere
    ? agentsInUse.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: delegationStatusOf(agent),
      }))
    : undefined;

  const delegateDialog = useDelegateDialog({
    agents,
    agentOptions,
    probe: compareModelProbe,
    sourceId: activeSession?.id,
    start: delegation.start,
    composerRef,
    menuButtonRef,
  });

  const mentionBlock =
    delegationMention === null || mentionedAgent === undefined
      ? null
      : mentionBlockedReason({
          agentName: mentionedAgent.name,
          task: delegationMention.task,
          status: delegationStatusOf(mentionedAgent),
          delegateReason: activeSession ? delegation.delegateBlockedReason(activeSession.id, mentionedAgent.id) : null,
        });
  // Why Send waits: the mention's own reason first, then the pair's report hand-over.
  const delegationBlock = mentionBlock ?? (activeSession ? delegation.sendBlockedReason(activeSession.id) : null) ?? undefined;

  /** What B starts on, under A's prompt; only while the mention names an agent that can start. */
  const delegationSummary =
    delegationMention !== null && mentionedAgent !== undefined && mentionBlock === null
      ? {
          // The agent has exactly one worker here: the task goes to it, and nothing new starts.
          text:
            activeSession !== undefined && soleOpenDelegateOf(activeSession.id, mentionedAgent.id, sessions) !== undefined
              ? followUpSummary(mentionedAgent.name)
              : startSummary({
                  agentName: mentionedAgent.name,
                  ...delegatedStartOf(agentOptions?.[mentionedAgent.id]),
                }),
          onChange: (attachments?: readonly string[]) =>
            delegateDialog.open({
              initialAgentId: mentionedAgent.id,
              initialTask: delegationMention.task,
              attachments,
              clearsComposer: true,
              returnsFocusToMenu: false,
            }),
        }
      : undefined;
  const delegationSendLabel =
    delegationMention !== null && mentionedAgent !== undefined ? `Delegate to ${mentionedAgent.name}` : undefined;

  const delegateAgents: readonly DelegateAgentChoice[] = agentsInUse.map((agent) => ({
    profile: agent,
    status: delegationStatusOf(agent),
    // Its task would go to its one worker here, which keeps its own model and mode.
    ...(activeSession !== undefined && soleOpenDelegateOf(activeSession.id, agent.id, sessions) !== undefined
      ? { hasDelegate: true }
      : {}),
  }));

  // End delegation: one item per open delegate of A, or B's own open link. A delegated session offers no Delegate of its own.
  const openDelegates = sessionOfItsOwn ? openDelegatesOf(sessionOfItsOwn.id, sessions) : [];
  const delegationEnds =
    openDelegates.length > 0
      ? openDelegates.map((delegate) => ({
          label:
            openDelegates.length === 1
              ? 'End delegation'
              : `End delegation to ${agents.find((agent) => agent.id === delegate.profileId)?.name ?? delegate.profileId}`,
          run: () => delegation.end(delegate.id),
        }))
      : sessionOfItsOwn !== undefined && isOpenLink(sessionOfItsOwn.delegatedFrom)
        ? [{ label: 'End delegation', run: () => delegation.end(sessionOfItsOwn.id) }]
        : undefined;

  const onDelegate =
    sessionOfItsOwn !== undefined && sessionOfItsOwn.delegatedFrom == null
      ? () => delegateDialog.open({ clearsComposer: false, returnsFocusToMenu: true })
      : undefined;

  // A's line while B works or waits, and B's while A works on its report; while A is in a turn its own status shows.
  // The session whose agent opened this one, when it still exists.
  const openerSession = activeSession?.openedBy ? sessions.find((s) => s.id === activeSession.openedBy?.sessionId) : undefined;
  const delegationViews = activeSession ? delegation.viewsFor(activeSession.id) : [];
  // B's own line, or the first of A's: the region that announces the lines stays mounted on it.
  const delegationView = delegationViews[0] ?? null;
  const shownDelegationViews = isSessionBusy(activeSessionId)
    ? []
    : delegationViews.filter(
        (view) =>
          (view.role === 'source' &&
            (view.state === 'working' || view.state === 'needs-answer' || view.state === 'failed')) ||
          view.state === 'source-working',
      );
  const isDelegationWorking = shownDelegationViews.some(
    (view) => view.state === 'working' || view.state === 'source-working',
  );
  // One-second ticks while a working line shows; the time is read in whole seconds, as the canvas draws it.
  const delegationNow = useNow(1000, isDelegationWorking);

  return {
    activeDelegateBlockedReason,
    delegateDialog,
    delegationAgents,
    delegationBlock,
    delegationSummary,
    delegationSendLabel,
    delegateAgents,
    delegationEnds,
    onDelegate,
    openerSession,
    delegationView,
    shownDelegationViews,
    delegationNow,
  };
}
