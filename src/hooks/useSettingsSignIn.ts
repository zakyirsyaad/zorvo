import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseProbeAnswer } from './useAgentProbe';
import type { AgentSignInStatus } from './useAgentSignInStatus';
import type { AuthRequest } from './useAgentAuth';
import type { useAgentSignIn } from './useAgentSignIn';
import { useLatest } from './useLatest';
import { parseAuthRequired, type AuthMethod } from '../lib/acp-auth';
import { refreshQuietly } from '../lib/sign-in-check';
import { hasReportedOptions, type AgentOptions, type ProbedOptions } from '../lib/acp-draft';
import type { SignInState } from '../lib/agent-sign-in';
import type { AgentProfile } from '../types';

/**
 * The least time between two automatic sign-in checks of one agent: each one starts the agent's
 * process, so opening and closing Settings must not do it every time.
 */
const SWEEP_INTERVAL_MS = 60_000;

/** Where a check of one agent stands. `message` is the plain-words result of a check the user asked for. */
export interface AgentCheck {
  phase: 'idle' | 'checking' | 'done';
  message?: string;
  /** The message is a failure of the check itself, not an answer. */
  isFailure?: boolean;
}

const IDLE: AgentCheck = { phase: 'idle' };

/** What Settings → Agents shows and does about each agent's sign-in; the app builds one. */
export interface SettingsSignIn {
  /** The folder agents are asked in; undefined until the user opened one. */
  cwd: string | undefined;
  stateOf: (profileId: string) => SignInState;
  checkOf: (profileId: string) => AgentCheck;
  /** True/false once known, undefined until the agent was asked. */
  reportsStatusOf: (profileId: string) => boolean | undefined;
  /** The sign-in methods the agent last offered. */
  methodsOf: (profileId: string) => readonly AuthMethod[];
  /** The agent's sign-in as it runs now (from a row or the new-session draft), or null. */
  requestOf: (profileId: string) => AuthRequest | null;
  /** The user's Check sign-in. */
  check: (profileId: string) => void;
  /** Runs one of the agent's methods. */
  signInWith: (profileId: string, methodId: string) => void;
  /** Asks agents that can say so, and were not asked lately, whether someone is signed in. Opens no session. */
  sweep: (profileIds: readonly string[]) => void;
  /** The agent whose sign-in is running now, if any: another row's sign-in waits for it. */
  busyAgentId: string | null;
  /** The agent login's terminal, for a dialog drawn above Settings. */
  terminal: ReturnType<typeof useAgentSignIn>['terminal'];
  cancelSignIn: () => void;
  retrySignIn: () => void;
}

export interface SettingsSignInDeps {
  cwd: string | undefined;
  agents: readonly AgentProfile[];
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  /** Remembers what a probe learned about an agent's options. */
  rememberProbed: (profileId: string, probed: ProbedOptions) => void;
  status: AgentSignInStatus;
  signIn: ReturnType<typeof useAgentSignIn>;
  /** Reads the agents and the login shell's environment afresh: Settings' Check again. */
  refreshAgents: () => Promise<void>;
}

interface SignInProbeAnswer {
  reportsStatus?: unknown;
  signInChecked?: unknown;
}

/**
 * Settings → Agents' side of signing in: the same store as the sidebar chip (`status`) and the same
 * login as the draft's panel (`signIn`), so the two cannot disagree. A check the user asks for goes
 * through `acp_probe_agent` (it may open a session in an agent that cannot report who is signed in);
 * the check that runs on its own when Settings opens goes through `acp_probe_sign_in`, which never does.
 */
export function useSettingsSignIn(deps: SettingsSignInDeps): SettingsSignIn {
  const { cwd, signIn, status } = deps;
  const [checks, setChecks] = useState<Readonly<Record<string, AgentCheck>>>({});
  const [reports, setReports] = useState<Readonly<Record<string, boolean>>>({});
  const [methods, setMethods] = useState<Readonly<Record<string, readonly AuthMethod[]>>>({});
  const depsRef = useLatest(deps);
  const inFlightRef = useRef(new Set<string>());
  const lastSweepRef = useRef(new Map<string, number>());
  const sweepingRef = useRef(false);
  // Agents that said they cannot report who is signed in: asking again would only start them for nothing.
  const cannotReportRef = useRef(new Set<string>());
  // Agents a sweep was asked for while another ran: the running one asks them when it ends.
  const queuedRef = useRef<readonly string[] | null>(null);
  const sweepRef = useRef<(profileIds: readonly string[]) => void>(() => {});
  // The agent whose sign-in was started from a row, so a Cancel there clears its request.
  const startedHereRef = useRef<string | null>(null);

  const setCheck = useCallback(
    (profileId: string, next: AgentCheck) => setChecks((prev) => ({ ...prev, [profileId]: next })),
    [],
  );
  const reportsRef = useRef<Readonly<Record<string, boolean>>>({});
  const learnReports = useCallback(
    (profileId: string, reportsStatus: boolean) => {
      reportsRef.current = { ...reportsRef.current, [profileId]: reportsStatus };
      setReports((prev) => (prev[profileId] === reportsStatus ? prev : { ...prev, [profileId]: reportsStatus }));
    },
    [],
  );
  const learnMethods = useCallback(
    (profileId: string, offered: readonly AuthMethod[]) => setMethods((prev) => ({ ...prev, [profileId]: offered })),
    [],
  );

  const check = useCallback(
    (profileId: string) => {
      const { cwd: folder, agents, agentOptions, rememberProbed, status: store } = depsRef.current;
      const name = agents.find((a) => a.id === profileId)?.name ?? profileId;
      if (inFlightRef.current.has(profileId)) return;
      if (!folder) {
        setCheck(profileId, { phase: 'done', message: `Open a folder first, then check ${name}.`, isFailure: true });
        return;
      }
      inFlightRef.current.add(profileId);
      setCheck(profileId, { phase: 'checking' });
      // The result of an earlier sign-in (done or failed) gives way to this check's own. A request that
      // still waits (idle) stays, with the refused message it will send again once signed in.
      const earlier = depsRef.current.signIn.auth.authRequest;
      const isFinished = earlier?.status === 'signed-in' || earlier?.status === 'failed';
      if (earlier?.profileId === profileId && isFinished && earlier.pending === undefined) {
        depsRef.current.signIn.auth.dismiss();
      }
      // The login shell's environment is read afresh first: a key exported after Zorvo started is only seen then.
      refreshQuietly(depsRef.current.refreshAgents)
        .then(() => invoke('acp_probe_agent', { profileId, cwd: folder, needsOptions: !hasReportedOptions(agentOptions?.[profileId]) }))
        .then((raw) => {
          const answer = parseProbeAnswer(raw);
          if (answer) rememberProbed(profileId, answer.options);
          if (answer?.facts.signInChecked) {
            store.markSignedIn(profileId);
            // Only an agent that reports its sign-in has shown who is signed in; the others just opened a session.
            const reported = reportsRef.current[profileId];
            const message =
              reported === true
                ? `You are signed in to ${name}.`
                : reported === false
                  ? `${name} opened a session, so it looks ready. It cannot confirm who is signed in.`
                  : `${name} looks ready.`;
            setCheck(profileId, { phase: 'done', message });
          } else {
            setCheck(profileId, { phase: 'done', message: `${name} did not say whether you are signed in.` });
          }
        })
        .catch((error: unknown) => {
          const offered = parseAuthRequired(error);
          if (offered) {
            learnMethods(profileId, offered);
            store.markNeeded(profileId);
            setCheck(profileId, { phase: 'done', message: `${name} needs you to sign in.` });
            return;
          }
          // The agent's own words (stderr, a path) stay out of the UI: they say little to the user.
          setCheck(profileId, {
            phase: 'done',
            message: `Could not check ${name}. Make sure it is installed and starts, then try again.`,
            isFailure: true,
          });
        })
        .finally(() => inFlightRef.current.delete(profileId));
    },
    [depsRef, setCheck, learnMethods],
  );

  /** The agent's sign-in is running now (from a row or the draft). */
  const isSigningIn = useCallback(
    (profileId: string) => {
      const request = depsRef.current.signIn.auth.authRequest;
      return request?.profileId === profileId && (request.status === 'signing-in' || request.status === 'checking');
    },
    [depsRef],
  );
  /** A sign-in of the agent is running or just ended, so an answer asked before it is out of date. */
  const hasNewerSignIn = useCallback(
    (profileId: string) => {
      const request = depsRef.current.signIn.auth.authRequest;
      return isSigningIn(profileId) || (request?.profileId === profileId && request.status === 'signed-in');
    },
    [depsRef, isSigningIn],
  );

  const askWithoutSession = useCallback(
    async (profileId: string, folder: string) => {
      const { status: store } = depsRef.current;
      // The user's own check of this agent got here first: it owns the agent until it ends. So does a sign-in under way.
      if (inFlightRef.current.has(profileId) || isSigningIn(profileId)) return;
      inFlightRef.current.add(profileId);
      setCheck(profileId, { phase: 'checking' });
      try {
        const raw = (await invoke('acp_probe_sign_in', { profileId, cwd: folder })) as SignInProbeAnswer | null;
        learnReports(profileId, raw?.reportsStatus === true);
        if (raw?.reportsStatus !== true) cannotReportRef.current.add(profileId);
        // A sign-in that began or ended while the agent was asked knows better than this answer.
        if (raw?.signInChecked === true && !hasNewerSignIn(profileId)) store.markSignedIn(profileId);
      } catch (error) {
        const offered = parseAuthRequired(error);
        if (offered) {
          learnReports(profileId, true);
          learnMethods(profileId, offered);
          if (!hasNewerSignIn(profileId)) store.markNeeded(profileId);
        }
        // Any other failure is left for the user's own Check sign-in, which explains it.
      } finally {
        inFlightRef.current.delete(profileId);
        setCheck(profileId, IDLE);
      }
    },
    [depsRef, setCheck, learnReports, learnMethods, isSigningIn, hasNewerSignIn],
  );

  const sweep = useCallback(
    (profileIds: readonly string[]) => {
      const { cwd: folder, agentOptions } = depsRef.current;
      if (!folder) return;
      if (sweepingRef.current) {
        queuedRef.current = profileIds;
        return;
      }
      const now = Date.now();
      // Only agents whose options are known: asking never opens a session, but it does start the agent.
      const due = profileIds.filter((id) => {
        const last = lastSweepRef.current.get(id);
        const isDue = last === undefined || now - last >= SWEEP_INTERVAL_MS;
        return hasReportedOptions(agentOptions?.[id]) && !cannotReportRef.current.has(id) && isDue;
      });
      if (due.length === 0) return;
      sweepingRef.current = true;
      void (async () => {
        try {
          // One agent at a time, so opening Settings does not start them all at once.
          for (const id of due) {
            lastSweepRef.current.set(id, Date.now());
            await askWithoutSession(id, folder);
          }
        } finally {
          sweepingRef.current = false;
          const queued = queuedRef.current;
          queuedRef.current = null;
          if (queued) sweepRef.current(queued);
        }
      })();
    },
    [depsRef, askWithoutSession],
  );
  useEffect(() => {
    sweepRef.current = sweep;
  }, [sweep]);

  const authRequest = signIn.auth.authRequest;
  const methodsOf = useCallback(
    (profileId: string): readonly AuthMethod[] =>
      authRequest?.profileId === profileId ? authRequest.methods : (methods[profileId] ?? []),
    [authRequest, methods],
  );

  const signInWith = useCallback(
    (profileId: string, methodId: string) => {
      const { cwd: folder, signIn: login } = depsRef.current;
      const offered = methodsOf(profileId);
      if (!folder || offered.length === 0) return;
      if (login.startSignIn({ profileId, cwd: folder, methods: [...offered] }, methodId)) startedHereRef.current = profileId;
    },
    [depsRef, methodsOf],
  );

  /** The login dialog's Cancel. A request left idle by a cancel would make a new session of that agent wait on its panel. */
  const { cancel, auth } = signIn;
  const cancelSignIn = useCallback(() => {
    cancel();
    if (startedHereRef.current !== null) auth.dismiss();
    startedHereRef.current = null;
  }, [cancel, auth]);

  return useMemo<SettingsSignIn>(
    () => ({
      cwd,
      stateOf: status.stateOf,
      checkOf: (profileId) => checks[profileId] ?? IDLE,
      reportsStatusOf: (profileId) => reports[profileId],
      methodsOf,
      requestOf: (profileId) => (authRequest?.profileId === profileId ? authRequest : null),
      check,
      signInWith,
      sweep,
      busyAgentId: authRequest && (authRequest.status === 'signing-in' || authRequest.status === 'checking') ? authRequest.profileId : null,
      terminal: signIn.terminal,
      cancelSignIn,
      retrySignIn: signIn.retryStart,
    }),
    [cwd, status.stateOf, checks, reports, methodsOf, authRequest, check, signInWith, sweep, signIn.terminal, cancelSignIn, signIn.retryStart],
  );
}
