import { useMemo } from "react";
import { switchHiddenFor, switchTargets, type SwitchTarget } from "../lib/agent-switch";
import type { SignInState } from "../lib/agent-sign-in";
import type { AgentProfile, Session } from "../types";

export interface SwitchTargetsInput {
  session: Session | undefined;
  messageCount: number;
  agentsInUse: readonly AgentProfile[];
  signInOf: (profileId: string) => SignInState;
}

/**
 * The agents the session on screen's conversation can continue with, as one list whose identity changes only when
 * a row does: it is handed to every chat row, and a new array each render would re-render all of them.
 */
export function useSwitchTargets({ session, messageCount, agentsInUse, signInOf }: SwitchTargetsInput): readonly SwitchTarget[] {
  const rows =
    session && !switchHiddenFor(session, messageCount, false)
      ? switchTargets(agentsInUse, session.profileId, signInOf, Boolean(session.privateMode))
      : [];
  const key = JSON.stringify(rows);
  return useMemo(() => JSON.parse(key) as SwitchTarget[], [key]);
}
