import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CREDITS_MAY_BE_UPDATING,
  creditsOutText,
  ownKeyOutText,
  type CreditsOutReason,
} from '../lib/private-session';
import { NO_CHOICES, withPreferred, type AgentOptions } from '../lib/acp-draft';
import { isAgentRunnable } from '../lib/agent-readiness';
import { actionError, type PaymentSource } from '../lib/private-credits';
import { nextSessionName } from '../lib/session-helpers';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import type { AgentProfile, ChatMessage, Session, Settings } from '../types';
import type { FirstMessage } from './session-engine/useAcpEngine';
import { usePrivateCredits } from './usePrivateCredits';
import { usePrivateCreditedNotice } from './usePrivateCreditedNotice';
import { usePrivateDraft } from './usePrivateDraft';
import { usePrivateRecoveryDialog } from './usePrivateRecoveryDialog';
import type { NoticeTone } from './useNotice';
import type { ForkOptions } from './useSessionFork';
import type { OpenNewSessionOptions } from './useSessionImport';

export interface PrivateWiringDeps {
  /** Settings → Private mode is on screen: a top-up shows its own result there. */
  isTopupShown: boolean;
  setNotice: (message: string, tone?: NoticeTone) => void;
  /** Shows a notice unless an error is on screen (`useNotice().offerNotice`). */
  offerNotice: (message: string, tone?: NoticeTone) => void;
  /** The agents the new-session draft would start; empty while no draft is shown. */
  draftAgentIds: readonly string[];
  draftAgentName?: string;
  draftAgentProvider?: string;
  paymentSource?: PaymentSource;
  activeSession: Session | undefined;
  /** Qwen Code is in use, so the draft's Private chip can pick it. */
  canPickPrivateAgent?: boolean;
  /** Turning the draft's Private chip on picks Qwen Code alone. */
  onTurnOnPrivate?: () => void;
}

/**
 * What App needs of Private mode before the engine exists: the credits, the recovery dialog, the draft's
 * Private chip, and the few rules the rest of App asks of them.
 */
export function usePrivateWiring({
  isTopupShown,
  setNotice,
  offerNotice,
  draftAgentIds,
  draftAgentName,
  draftAgentProvider,
  paymentSource,
  activeSession,
  canPickPrivateAgent,
  onTurnOnPrivate,
}: PrivateWiringDeps) {
  const credits = usePrivateCredits();
  usePrivateCreditedNotice(credits.flow, isTopupShown, offerNotice);
  const recoveryDialog = usePrivateRecoveryDialog();
  // The draft's Private chip: per draft, off by default; while on, the next session runs privately.
  const draft = usePrivateDraft({
    credits,
    agentIds: draftAgentIds,
    agentName: draftAgentName,
    agentProvider: draftAgentProvider,
    paymentSource,
    canPickPrivateAgent,
    onTurnOn: onTurnOnPrivate,
  });
  return {
    credits,
    recoveryDialog,
    draft,
    // A private launch never uses the agent's own sign-in: no probe, no sign-in panel and no wait for one.
    isPrivateLaunch: draft.isOn || Boolean(activeSession?.privateMode),
    /** A balance read that already shows credits clears the panel at once: say why the message came back. */
    onCreditsOut: (sessionId: string, reason: CreditsOutReason, isOwnKey = false) =>
      credits.markCreditsOut(sessionId, reason, {
        onBalanceLagging: () => setNotice(CREDITS_MAY_BE_UPDATING, 'warning'),
        isOwnKey,
      }),
    /** The popout's Send waits too; one that raced the refusal is not sent into a refusal again. */
    refusesSend: (sessionId: string): boolean => {
      const reason = credits.creditsOut[sessionId];
      if (reason) {
        const isOwnKey = activeSession?.id === sessionId && activeSession.privateMode?.ownKey === true;
        setNotice(
          isOwnKey ? ownKeyOutText(reason, credits.status?.ownKey?.saved !== false) : creditsOutText(reason),
        );
      }
      return reason !== undefined;
    },
  };
}

export interface PrivateContinueDeps {
  credits: ReturnType<typeof usePrivateCredits>;
  activeSession: Session | undefined;
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  agentsInUse: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  agentOptions: Record<string, AgentOptions> | undefined;
  openNewSession: (path?: string, agentId?: string, options?: OpenNewSessionOptions) => void;
  forkSession: (messageId: string, options?: ForkOptions) => Promise<void>;
  patchSession: (sessionId: string, patch: Partial<Session>) => void;
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setNotice: (message: string, tone?: NoticeTone) => void;
}

/**
 * A private session out of credits or a working key: its Send waits, and it offers a top-up or, once
 * the user agreed the conversation leaves the TEE, the same conversation with another agent.
 */
export function usePrivateContinue({
  credits,
  activeSession,
  sessions,
  agents,
  agentsInUse,
  transcripts,
  agentOptions,
  openNewSession,
  forkSession,
  patchSession,
  startSession,
  updateSettings,
  setNotice,
}: PrivateContinueDeps) {
  const [isRaisingCap, setIsRaisingCap] = useState(false);
  const creditsOutReason = activeSession ? credits.creditsOut[activeSession.id] : undefined;
  const continueAgents = activeSession
    ? agentsInUse.filter((agent) => agent.id !== activeSession.profileId && isAgentRunnable(agent))
    : [];
  const continueWithAgent = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const lastMessage = (transcripts[activeSession?.id ?? ''] ?? []).at(-1);
    if (!agent || !activeSession) return;
    // Nothing to hand over yet: a new draft of that agent in the same folder.
    if (!lastMessage) openNewSession(activeSession.cwd, agent.id);
    // The new agent starts from what it was last picked with, never the private session's picks.
    else void forkSession(lastMessage.id, { agent, choices: withPreferred(NO_CHOICES, agentOptions?.[agent.id]) });
  };
  const creditsOutNote =
    creditsOutReason && creditsOutReason !== 'session_limit'
      ? activeSession?.privateMode?.ownKey === true
        ? ownKeyOutText(creditsOutReason, credits.status?.ownKey?.saved !== false)
        : creditsOutText(creditsOutReason)
      : undefined;

  const raiseCap = async () => {
    const session = activeSession;
    const cap = session?.privateMode?.sessionCap;
    if (!session?.privateMode || cap === undefined || isRaisingCap) return;
    setIsRaisingCap(true);
    try {
      const raised = await invoke<number>('private_raise_session_cap', {
        sessionId: session.id,
        credits: cap * 2,
      });
      patchSession(session.id, {
        privateMode: { ...session.privateMode, sessionCap: raised },
      });
      credits.clearCreditsOut(session.id);
    } catch (error) {
      setNotice(actionError('raise', String(error)), 'warning');
    } finally {
      setIsRaisingCap(false);
    }
  };

  const forkOrStartPrivate = (session: Session, forkOptions: ForkOptions) => {
    if (!session.privateMode) return;
    const last = (transcripts[session.id] ?? []).at(-1);
    if (last) {
      void forkSession(last.id, forkOptions);
      return;
    }
    const agent = agents.find((candidate) => candidate.id === session.profileId);
    if (!agent) return;
    startSession({
      agent,
      cwd: session.cwd,
      name: nextSessionName(sessions),
      privateMode: { modelId: session.privateMode.modelId },
    });
  };

  /** Starts a fresh private session from this one, with no cap. */
  const startUncappedSession = () => {
    if (activeSession?.privateMode) forkOrStartPrivate(activeSession, { uncappedPrivate: true });
  };

  /**
   * Switches this Mac to Zorvo credits and starts a fresh credits session from this one: the running
   * agent holds an own-key proxy token, so only a new process can pay with credits.
   */
  const switchToCredits = () => {
    updateSettings({ paymentSource: 'credits' });
    const session = activeSession;
    if (!session?.privateMode) return;
    credits.clearCreditsOut(session.id);
    forkOrStartPrivate(session, { creditsPrivate: true });
  };

  return {
    creditsOutReason,
    creditsOutNote,
    continueAgents,
    continueWithAgent,
    isRaisingCap,
    raiseCap,
    startUncappedSession,
    switchToCredits,
  };
}
