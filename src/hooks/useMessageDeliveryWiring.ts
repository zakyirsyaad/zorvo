import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { ComposerHandle } from '../components/ComposerDock';
import { NO_CHOICES, type AcpChoices, type AgentOptions } from '../lib/acp-draft';
import { delegationChoicesFor as delegationChoicesForOptions } from '../lib/delegation-start';
import type { QueuedMessage } from '../lib/queued-messages';
import { isAutoName } from '../lib/session-helpers';
import { namingFor, titlePlaceOf } from '../lib/session-start';
import type { AgentProfile, ChatMessage, Session, WorkerTurnEnd } from '../types';
import type { FirstMessage } from './session-engine/useAcpEngine';
import type { useDelegation } from './useDelegation';
import { useQueuedMessages } from './useQueuedMessages';
import type { ReviewWiring } from './useReviewWiring';
import type { SecretGuardContext, SecretMessage } from './useSecretGuard';

export interface MessageDeliveryWiringDeps {
  sessions: readonly Session[];
  activeSession: Session | undefined;
  activeSessionId: string;
  isActiveRunning: boolean;
  isResumable: boolean;
  activeWorkspacePath: string | undefined;
  agents: readonly AgentProfile[];
  activeAgent: AgentProfile | undefined;
  newSessionAgent: AgentProfile | undefined;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  startChoices: AcpChoices;
  setAcpChoices: (choices: AcpChoices) => void;
  isCompare: boolean;
  isPrivateLaunch: boolean;
  isSecretGuardEnabled: boolean;
  delegationMention: { agentId: string; task: string } | null;
  delegation: Pick<ReturnType<typeof useDelegation>, 'start' | 'sendBlockedReason'>;
  review: Pick<ReviewWiring, 'slot' | 'rearm' | 'sendFrom'>;
  secretGuardCheck: (message: SecretMessage, onAllow: () => void, context: SecretGuardContext) => void;
  dropCompareSignIn: (sessionId: string) => void;
  sendAcp: (sessionId: string, text: string, attachments?: readonly string[]) => Promise<boolean>;
  resumeAcp: (session: Session, acpSessionId: string, message: FirstMessage, choices: AcpChoices) => Promise<boolean>;
  isAcpBusy: (sessionId: string) => boolean;
  isTurnUnderWay: (sessionId: string) => boolean;
  isStarting: (sessionId: string) => boolean;
  isRestarting: (sessionId: string) => boolean;
  isSessionWaiting: (sessionId: string) => boolean;
  restartSession: (session: Session, message: FirstMessage, choices: AcpChoices) => Promise<unknown>;
  handleInterrupt: (sessionId: string) => void;
  handleNewRun: (first: FirstMessage) => void;
  handleNewSession: (first?: FirstMessage) => Promise<void>;
  patchSession: (sessionId: string, patch: Partial<Session>) => void;
  giveBackMessage: (sessionId: string, text: string, attachments?: readonly string[]) => void;
  composerRef: RefObject<ComposerHandle | null>;
  onNotice: (message: string) => void;
  queueTurnSettledRef: MutableRefObject<(sessionId: string, end: { how: WorkerTurnEnd }) => void>;
  queueAgentEndedRef: MutableRefObject<(sessionId: string) => void>;
  queuePromptStartedRef: MutableRefObject<(sessionId: string) => void>;
  queueRewoundRef: MutableRefObject<(sessionId: string) => void>;
}

/**
 * Coordinates direct sends, session resumption, queued message delivery, and
 * composer send routing (delegation mentions, queueing, secret scanning, and review slots).
 */
export function useMessageDeliveryWiring(deps: MessageDeliveryWiringDeps) {
  const {
    sessions,
    activeSession,
    activeSessionId,
    isActiveRunning,
    isResumable,
    activeWorkspacePath,
    agents,
    activeAgent,
    newSessionAgent,
    agentOptions,
    transcripts,
    startChoices,
    setAcpChoices,
    isCompare,
    isPrivateLaunch,
    isSecretGuardEnabled,
    delegationMention,
    delegation,
    review,
    secretGuardCheck,
    dropCompareSignIn,
    sendAcp,
    resumeAcp,
    isAcpBusy,
    isTurnUnderWay,
    isStarting,
    isRestarting,
    isSessionWaiting,
    restartSession,
    handleInterrupt,
    handleNewRun,
    handleNewSession,
    patchSession,
    giveBackMessage,
    composerRef,
    onNotice,
    queueTurnSettledRef,
    queueAgentEndedRef,
    queuePromptStartedRef,
    queueRewoundRef,
  } = deps;

  const sessionById = (sessionId: string) => sessions.find((s) => s.id === sessionId);

  /** Resolves to whether the agent took the message. */
  const sendTo = async (sessionId: string, message: FirstMessage): Promise<boolean> => {
    dropCompareSignIn(sessionId);
    const session = sessionById(sessionId);
    // A numbered session takes its title from the first thing the user asks.
    const isFirstMessage = !(transcripts[sessionId]?.some((m) => m.role === 'user') ?? false);
    const sent = await sendAcp(sessionId, message.text, message.attachments);
    if (sent && session && isFirstMessage && isAutoName(session.name) && !session.namedByUser) {
      patchSession(sessionId, { titleSource: undefined, ...namingFor(message, titlePlaceOf(session, agents)) });
    }
    return sent;
  };

  /**
   * Resolves true when the agent took the message. One it did not take goes back to the composer,
   * unless `giveBack` is false: a next-step press stays a press, and the draft in the box is left alone.
   */
  const sendFromComposer = (sessionId: string, message: FirstMessage, giveBack = true): Promise<boolean> => {
    if (delegation.sendBlockedReason(sessionId) !== null) {
      if (giveBack) giveBackMessage(sessionId, message.text, message.attachments);
      return Promise.resolve(false);
    }
    return sendTo(sessionId, message).then((isTaken) => {
      if (!isTaken && giveBack) giveBackMessage(sessionId, message.text, message.attachments);
      return isTaken;
    });
  };

  /**
   * Continues an ended ACP session: a fresh agent process loads it, then gets
   * the message. A rewound one has no agent session left to load.
   */
  const resumeSession = (
    session: Session,
    message: FirstMessage,
    options?: { keepUnsent?: boolean },
  ): Promise<boolean | null> => {
    dropCompareSignIn(session.id);
    if (!session.acpSessionId) {
      // A rewound session: `restart` gives the message back itself.
      void restartSession(session, message, startChoices);
      setAcpChoices(NO_CHOICES);
      // The outcome is not known here, so the queue announces nothing for it.
      return Promise.resolve(null);
    }
    // Continuing an archived session brings it back into the list.
    patchSession(session.id, { status: 'running', endedAt: null, exitCode: null, archivedAt: null });
    const taken = resumeAcp(session, session.acpSessionId, message, startChoices).then((isTaken) => {
      // The queue gives back and announces for itself (`keepUnsent`): it must know whether the agent took the message.
      if (!isTaken && !options?.keepUnsent) giveBackMessage(session.id, message.text, message.attachments);
      return isTaken;
    });
    setAcpChoices(NO_CHOICES);
    return taken;
  };

  /** Sends one queued message the way the composer's Send does; false when the agent or the delegation pair refused it. */
  const deliverQueued = async (sessionId: string, queued: QueuedMessage, mode: 'send' | 'resume') => {
    const session = sessionById(sessionId);
    if (!session) return false;
    const message = { text: queued.text, attachments: [...queued.attachments] };
    if (mode === 'resume') {
      return resumeSession(session, message, { keepUnsent: true });
    }
    if (delegation.sendBlockedReason(sessionId) !== null) return false;
    return sendTo(sessionId, message);
  };

  /** The composer's own rule for continuing an ended session: its agent is ready. */
  const canResumeSession = (sessionId: string) => {
    const session = sessionById(sessionId);
    return session !== undefined && session.status !== 'running' && agents.find((a) => a.id === session.profileId)?.detected === true;
  };

  const queue = useQueuedMessages({
    sessionIds: sessions.map((s) => s.id),
    deliver: deliverQueued,
    stop: handleInterrupt,
    giveBack: giveBackMessage,
    focusComposer: () => composerRef.current?.focus(),
    isWaiting: isSessionWaiting,
    isTurnUnderWay,
    isStarting,
    isEnded: (sessionId) => sessionById(sessionId)?.status !== 'running',
    canResume: canResumeSession,
    agentNameOf: (sessionId) => agents.find((a) => a.id === sessionById(sessionId)?.profileId)?.name ?? 'The agent',
    onNotice,
  });

  queueTurnSettledRef.current = queue.onTurnSettled;
  queueAgentEndedRef.current = queue.onAgentEnded;
  queuePromptStartedRef.current = queue.onPromptStarted;
  queueRewoundRef.current = queue.clearForRewind;

  // What was announced belongs to the session on screen: another session starts quiet.
  const { clearAnnouncement } = queue;
  useEffect(() => clearAnnouncement(), [activeSessionId, clearAnnouncement]);

  // A message sent while the agent works waits in a queue, unless review comments are held: those are marked Sent at Send.
  const canQueueActive =
    activeSession !== undefined &&
    isActiveRunning &&
    isAcpBusy(activeSessionId) &&
    !isStarting(activeSessionId) &&
    !isRestarting(activeSessionId);
  const isQueueingActive = canQueueActive && review.slot === null;
  const isQueueFull = isQueueingActive && queue.isFull(activeSessionId);

  /** What a delegation to an agent starts with: the picks, and the agent's remembered model and effort. */
  const delegationChoicesFor = (agentId: string): AcpChoices => delegationChoicesForOptions(agentOptions?.[agentId]);

  /** True when a message sent now joins the session's queue: a turn is under way (read from refs) and no comments are held. */
  const isQueueingNow = (sessionId: string) =>
    isQueueingActive && sessionId === activeSessionId && isTurnUnderWay(sessionId) && !isStarting(sessionId);

  /** Sends to the active session, continues it when it can be resumed, or starts a new one (or a run). */
  const handleSendMessage = (text: string, attachments?: string[]) => {
    const message = { text, attachments };
    // A mention is the whole message: it starts the other agent instead of sending this one.
    if (delegationMention !== null && activeSession !== undefined) {
      const sourceId = activeSession.id;
      const { agentId, task } = delegationMention;
      void delegation
        .start(sourceId, agentId, task, {
          attachments,
          choices: delegationChoicesFor(agentId),
        })
        .then((isStarted) => {
          if (!isStarted) giveBackMessage(sourceId, text, attachments);
        });
      return;
    }
    // While a turn runs, a message waits in the session's queue. The secret guard scans it now, with the user
    // at the keyboard; the queue later sends it through `sendTo`, which scans nothing again.
    if (activeSession !== undefined && isQueueingNow(activeSession.id)) {
      const sessionId = activeSession.id;
      secretGuardCheck(
        message,
        () => {
          // The turn may have ended during the scan: no turn end is left to send it.
          if (!isTurnUnderWay(sessionId)) void sendFromComposer(sessionId, message);
          else if (!queue.add(sessionId, text, attachments ?? [])) giveBackMessage(sessionId, text, attachments);
        },
        {
          isEnabled: isPrivateLaunch && isSecretGuardEnabled,
          root: activeSession.cwd ?? activeWorkspacePath,
          agentName: activeAgent?.name ?? 'The agent',
          sessionId,
        },
      );
      return;
    }
    // The pair's report hand-over blocks both sides; nothing goes out, and held review comments stay held.
    if (activeSession !== undefined && delegation.sendBlockedReason(activeSession.id) !== null) {
      giveBackMessage(activeSession.id, text, attachments);
      return;
    }
    // The composer empties on Send, which clears the slot; keep it so the comments still go with this
    // message after a secret review, whether the user picks Send anyway or edits and sends again.
    const reviewSlot = review.slot;
    const deliver = () => {
      if (reviewSlot) review.rearm(reviewSlot);
      if (activeSession && isActiveRunning) {
        review.sendFrom(activeSession.id, text);
        void sendFromComposer(activeSession.id, message);
      } else if (activeSession && isResumable) {
        review.sendFrom(activeSession.id, text);
        void resumeSession(activeSession, message);
      } else if (isCompare) handleNewRun(message);
      else void handleNewSession(message);
    };
    // A private message pauses here when it may hold a secret; nothing goes out until the user picks.
    secretGuardCheck(message, deliver, {
      isEnabled: isPrivateLaunch && isSecretGuardEnabled,
      root: activeSession?.cwd ?? activeWorkspacePath,
      agentName: activeAgent?.name ?? newSessionAgent?.name ?? 'The agent',
      sessionId: activeSession?.id,
      ...(reviewSlot ? { reviewSlot } : {}),
    });
  };

  return {
    queue,
    sendTo,
    sendFromComposer,
    resumeSession,
    canQueueActive,
    isQueueingActive,
    isQueueFull,
    handleSendMessage,
  };
}
