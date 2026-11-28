import { NO_CHOICES, withPreferred, type AgentOptions } from "../lib/acp-draft";
import type { ContinueChoice } from "../components/private/ContinueOutsideTeeDialog";
import type { ForkOptions } from "./useSessionFork";
import type { AgentProfile, Session } from "../types";

export interface ContinueActionsDeps {
  activeSession: Session | undefined;
  agents: readonly AgentProfile[];
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  forkSession: (messageId: string, options?: ForkOptions) => Promise<boolean>;
  /** The composer's pick of another agent (`useAgentSwitch().pick`). */
  pick: (sessionId: string, agentId: string) => void;
  /** Asks before a private session's conversation leaves the TEE; calls back only on Continue. */
  confirmOutsideTee: (agent: ContinueChoice, onConfirm: () => void) => void;
  onNotice: (message: string) => void;
}

/**
 * The two ways to continue with another agent: Fork from here under a reply (`forkFromMessage`, no agent id for
 * the session's own) and the composer's agent menu (`pickSwitchAgent`). A private session asks first for another agent.
 */
export function useContinueActions({ activeSession, agents, agentOptions, forkSession, pick, confirmOutsideTee, onNotice }: ContinueActionsDeps) {
  const askIfPrivate = (agent: AgentProfile, run: () => void) => {
    if (activeSession?.privateMode && agent.id !== activeSession.profileId) confirmOutsideTee({ id: agent.id, name: agent.name }, run);
    else run();
  };

  const forkFromMessage = (messageId: string, agentId?: string) => {
    if (agentId === undefined) {
      void forkSession(messageId);
      return;
    }
    const agent = agents.find((candidate) => candidate.id === agentId);
    // Never fall back to the session's own agent for a pick the user made.
    if (!agent) {
      onNotice("That agent is no longer available, so the conversation did not continue there.");
      return;
    }
    askIfPrivate(agent, () => void forkSession(messageId, { agent, choices: withPreferred(NO_CHOICES, agentOptions?.[agent.id]) }));
  };

  const pickSwitchAgent = (agentId: string) => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    askIfPrivate(agent, () => pick(sessionId, agentId));
  };

  return { forkFromMessage, pickSwitchAgent };
}
