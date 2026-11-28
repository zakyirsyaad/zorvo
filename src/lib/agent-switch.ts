import { isAgentRunnable } from './agent-readiness';
import { SIGN_IN_STATUS_WORDS, type SignInState } from './agent-sign-in';
import type { AgentProfile, ChatMessage, Session } from '../types';

/** How an agent stands for continuing a conversation with it. */
export type SwitchStatus = SignInState | 'not-installed';

/** One row of the composer's agent menu or the Fork menu. */
export interface SwitchTarget {
  id: string;
  name: string;
  /** The session's own agent: listed first, never a new session. */
  isSource: boolean;
  status: SwitchStatus;
  /** What the row says on its right. */
  word: string;
  isDisabled: boolean;
}

export const SWITCH_TEXT = {
  menuHeader: 'Continue in a new session with',
  privateHeader: 'Continue outside the TEE with',
  footer: 'This conversation goes with it. This session stays as it is.',
  sourceWord: 'This session',
  privateSourceWord: 'Private',
  notInstalled: 'Not installed',
  forkHeader: 'Continue with another agent',
  reviewLock: 'Send or clear the review comments first.',
  deletedSource: 'a deleted session',
} as const;

/**
 * The agents a session's conversation can go on with: its own first, then every other agent in use in the
 * order they are in use. One that cannot run is listed but cannot be picked; one that needs a sign-in can, since
 * the new session asks for it as any session does.
 */
export function switchTargets(
  agentsInUse: readonly AgentProfile[],
  sourceProfileId: string,
  signInOf: (profileId: string) => SignInState,
  isPrivate: boolean,
): SwitchTarget[] {
  const source = agentsInUse.find((agent) => agent.id === sourceProfileId);
  const others = agentsInUse.filter((agent) => agent.id !== sourceProfileId);
  const sourceRow: SwitchTarget[] = source
    ? [
        {
          id: source.id,
          name: source.name,
          isSource: true,
          status: 'ready',
          word: isPrivate ? SWITCH_TEXT.privateSourceWord : SWITCH_TEXT.sourceWord,
          isDisabled: false,
        },
      ]
    : [];
  return [...sourceRow, ...others.map((agent) => otherRow(agent, signInOf(agent.id)))];
}

function otherRow(agent: AgentProfile, signIn: SignInState): SwitchTarget {
  if (!isAgentRunnable(agent)) {
    return { id: agent.id, name: agent.name, isSource: false, status: 'not-installed', word: SWITCH_TEXT.notInstalled, isDisabled: true };
  }
  return { id: agent.id, name: agent.name, isSource: false, status: signIn, word: SIGN_IN_STATUS_WORDS[signIn], isDisabled: false };
}

/**
 * Whether a session offers no other agent: nothing to hand over yet, a compare run's session (its panel is the
 * place to compare), a worker still linked to its coordinator, or a popout, which only forwards actions.
 */
export function switchHiddenFor(session: Session, messageCount: number, isPopout: boolean): boolean {
  if (isPopout || messageCount === 0) return true;
  if (session.compareRunId) return true;
  return Boolean(session.delegatedFrom && !session.delegatedFrom.endedAt);
}

/** The note above the composer while a switch waits for Send. */
export function switchNote(agent: string, source: string): string {
  return `Your message starts a new ${agent} session that continues this one. ${source}'s session stays as it is.`;
}

/** Why Send waits while a switch is picked: the source agent is still in its turn. */
export function switchWaitsNote(source: string): string {
  return `${source} is still working. Wait for it to finish, or press Stop.`;
}

/** The line above a session's first message when it continued another agent's conversation. */
export function continuedLine(agent: string, source: string): string {
  return `Continued with ${agent} from ${source}`;
}

/**
 * What the "Continued with" line names: the agent the mark says took the conversation over (a mark copied into a
 * later fork keeps its own), else the session on screen's agent for marks written before that field; and the
 * source session, or null once it is gone.
 */
export function continuedFromView(
  mark: NonNullable<ChatMessage['continuedFrom']>,
  sessions: readonly Session[],
  agents: readonly Pick<AgentProfile, 'id' | 'name'>[],
  fallbackAgentName: string,
): { agentName: string; sourceName: string | null; sourceId: string | null } {
  const taker = mark.toAgentId ? agents.find((agent) => agent.id === mark.toAgentId) : undefined;
  const origin = sessions.find((session) => session.id === mark.sessionId);
  return { agentName: taker?.name ?? fallbackAgentName, sourceName: origin?.name ?? null, sourceId: origin?.id ?? null };
}
