import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseProbeAnswer } from './useAgentProbe';
import { useLatest } from './useLatest';
import { parseAuthRequired } from '../lib/acp-auth';
import { hasReportedOptions, type AgentOptions, type ProbedOptions } from '../lib/acp-draft';

export interface CompareModelProbeDeps {
  /** The draft's folder; nothing is asked without one. */
  cwd: string | undefined;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  /** Stores what an agent answered (App's `rememberProbed`). */
  onProbed: (profileId: string, probed: ProbedOptions) => void;
  /** The answer showed someone signed in to the agent. */
  onSignedIn: (profileId: string) => void;
  /** The agent refused to answer until someone signs in to it. */
  onNeedsSignIn: (profileId: string) => void;
}

type AskState = 'asking' | 'failed';

/**
 * Asks a compare agent for its models when its chip is opened, never when it is ticked: an ask starts the agent's
 * process and, for an agent that cannot report its sign-in, may leave a session in its history. One agent is asked
 * at a time; others wait in order. An agent is asked once, unless the ask failed and is tried again.
 */
export function useCompareModelProbe(deps: CompareModelProbeDeps): {
  ask: (profileId: string) => void;
  stateOf: (profileId: string) => AskState | undefined;
} {
  const [states, setStates] = useState<Readonly<Record<string, AskState>>>({});
  const depsRef = useLatest(deps);
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef<string | null>(null);
  // Agents that answered, or said they need a sign-in: asking them again would only start their process again.
  const settledRef = useRef(new Set<string>());

  const setState = useCallback((profileId: string, state: AskState | undefined) => {
    setStates((current) => {
      if (current[profileId] === state) return current;
      const next = { ...current };
      if (state) next[profileId] = state;
      else delete next[profileId];
      return next;
    });
  }, []);

  const runNext = useCallback(() => {
    if (runningRef.current !== null) return;
    const profileId = queueRef.current.shift();
    const cwd = depsRef.current.cwd;
    if (!profileId || !cwd) return;
    runningRef.current = profileId;
    invoke('acp_probe_agent', { profileId, cwd, needsOptions: true })
      .then((raw) => {
        const answer = parseProbeAnswer(raw);
        if (!answer) {
          setState(profileId, 'failed');
          return;
        }
        settledRef.current.add(profileId);
        depsRef.current.onProbed(profileId, answer.options);
        if (answer.facts.signInChecked) depsRef.current.onSignedIn(profileId);
        setState(profileId, undefined);
      })
      .catch((error: unknown) => {
        if (parseAuthRequired(error)) {
          settledRef.current.add(profileId);
          depsRef.current.onNeedsSignIn(profileId);
          setState(profileId, undefined);
        } else {
          setState(profileId, 'failed');
        }
      })
      .finally(() => {
        runningRef.current = null;
        runNext();
      });
  }, [depsRef, setState]);

  const ask = useCallback(
    (profileId: string) => {
      const { cwd, agentOptions } = depsRef.current;
      if (!cwd || hasReportedOptions(agentOptions?.[profileId])) return;
      if (settledRef.current.has(profileId)) return;
      if (runningRef.current === profileId || queueRef.current.includes(profileId)) return;
      queueRef.current.push(profileId);
      setState(profileId, 'asking');
      runNext();
    },
    [depsRef, runNext, setState],
  );

  const stateOf = useCallback((profileId: string) => states[profileId], [states]);

  return { ask, stateOf };
}
