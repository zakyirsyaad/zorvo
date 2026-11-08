import { CREDITS_MAY_BE_UPDATING, creditsOutText, type CreditsOutReason } from '../lib/private-session';
import { NO_CHOICES, withPreferred, type AgentOptions } from '../lib/acp-draft';
import { isAgentRunnable } from '../lib/agent-readiness';
import type { PaymentSource } from '../lib/private-credits';
import type { AgentProfile, ChatMessage, Session } from '../types';
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
  });
  return {
    credits,
    recoveryDialog,
    draft,
    // A private launch never uses the agent's own sign-in: no probe, no sign-in panel and no wait for one.
    isPrivateLaunch: draft.isOn || Boolean(activeSession?.privateMode),
    /** A balance read that already shows credits clears the panel at once: say why the message came back. */
    onCreditsOut: (sessionId: string, reason: CreditsOutReason) =>
      credits.markCreditsOut(sessionId, reason, () => setNotice(CREDITS_MAY_BE_UPDATING, 'warning')),
    /** The popout's Send waits too; one that raced the refusal is not sent into a refusal again. */
    refusesSend: (sessionId: string): boolean => {
      const reason = credits.creditsOut[sessionId];
      if (reason) setNotice(creditsOutText(reason));
      return reason !== undefined;
    },
  };
}

export interface PrivateContinueDeps {
  credits: ReturnType<typeof usePrivateCredits>;
  activeSession: Session | undefined;
  agents: readonly AgentProfile[];
  agentsInUse: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  agentOptions: Record<string, AgentOptions> | undefined;
  openNewSession: (path?: string, agentId?: string, options?: OpenNewSessionOptions) => void;
  forkSession: (messageId: string, options?: ForkOptions) => Promise<void>;
}

/**
 * A private session out of credits or a working key: its Send waits, and it offers a top-up or, once
 * the user agreed the conversation leaves the TEE, the same conversation with another agent.
 */
export function usePrivateContinue({
  credits,
  activeSession,
  agents,
  agentsInUse,
  transcripts,
  agentOptions,
  openNewSession,
  forkSession,
}: PrivateContinueDeps) {
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
  const creditsOutNote = creditsOutReason && creditsOutText(creditsOutReason);
  return { creditsOutReason, creditsOutNote, continueAgents, continueWithAgent };
}
