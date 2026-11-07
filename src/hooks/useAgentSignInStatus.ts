import { useCallback, useMemo, useState } from 'react';
import { signInStateOf, type SignInState } from '../lib/agent-sign-in';
import type { PersistedState, Settings } from '../types';

export interface AgentSignInStatus {
  stateOf: (profileId: string) => SignInState;
  /** The agent said it needs a sign-in: it stops counting as signed in. */
  markNeeded: (profileId: string) => void;
  /** Someone was seen signed in to the agent; remembered across launches. */
  markSignedIn: (profileId: string) => void;
  /**
   * A check could not confirm the agent's sign-in (a missing key variable): it stops counting as signed in,
   * without being told to sign in, since a key saved by its own setup is not visible to Zorvo.
   */
  markUnconfirmed: (profileId: string) => void;
}

export interface UseAgentSignInStatusOptions {
  settings: Settings;
  updateState: (updater: (prev: PersistedState) => PersistedState) => void;
}

/** `state` without `profileId` among the agents seen signed in (the same object when it was not there). */
function withoutSignedIn(state: PersistedState, profileId: string): PersistedState {
  const signedIn = state.settings.signedInAgents;
  return signedIn?.includes(profileId)
    ? { ...state, settings: { ...state.settings, signedInAgents: signedIn.filter((id) => id !== profileId) } }
    : state;
}

/**
 * What the app knows about each agent's sign-in. Only a sign-in actually seen
 * counts (a probe that showed an account, a sign-in that took), and it is kept
 * in `settings.signedInAgents`; an agent that asks for a sign-in is `needed`
 * until it is seen signed in again.
 */
export function useAgentSignInStatus({ settings, updateState }: UseAgentSignInStatusOptions): AgentSignInStatus {
  const [needed, setNeeded] = useState<ReadonlySet<string>>(new Set());
  const { signedInAgents } = settings;

  const stateOf = useCallback(
    (profileId: string) => signInStateOf(profileId, signedInAgents, needed),
    [signedInAgents, needed],
  );

  const markNeeded = useCallback(
    (profileId: string) => {
      setNeeded((prev) => (prev.has(profileId) ? prev : new Set(prev).add(profileId)));
      updateState((prev) => withoutSignedIn(prev, profileId));
    },
    [updateState],
  );

  const markSignedIn = useCallback(
    (profileId: string) => {
      setNeeded((prev) => {
        if (!prev.has(profileId)) return prev;
        const next = new Set(prev);
        next.delete(profileId);
        return next;
      });
      updateState((prev) =>
        prev.settings.signedInAgents?.includes(profileId)
          ? prev
          : {
              ...prev,
              settings: { ...prev.settings, signedInAgents: [...(prev.settings.signedInAgents ?? []), profileId] },
            },
      );
    },
    [updateState],
  );

  const markUnconfirmed = useCallback((profileId: string) => updateState((prev) => withoutSignedIn(prev, profileId)), [updateState]);

  return useMemo(
    () => ({ stateOf, markNeeded, markSignedIn, markUnconfirmed }),
    [stateOf, markNeeded, markSignedIn, markUnconfirmed],
  );
}
