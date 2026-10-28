import { useCallback, useRef, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentAuth, type AgentAuth, type AuthRequest } from './useAgentAuth';
import { useLatest } from './useLatest';
import { useTerminalSignIn, type LoginOutcome } from './useTerminalSignIn';
import type { FirstMessage } from './session-engine/useAcpEngine';
import type { ComposerHandle } from '../components/ComposerDock';
import type { AuthMethod } from '../lib/acp-auth';
import { SIGN_IN_RUNNING_NOTICE } from '../lib/agent-sign-in';
import { checkSignIn } from '../lib/sign-in-check';
import type { AgentProfile, Session } from '../types';

/** An agent and the methods it offers, for a sign-in started from outside the draft (Settings). */
export type SignInStart = Pick<AuthRequest, 'profileId' | 'cwd' | 'methods'>;

export interface AgentSignInDeps {
  agents: AgentProfile[];
  composerRef: RefObject<ComposerHandle | null>;
  activeSessionIdRef: { readonly current: string | undefined };
  /** Resolves to false when the message did not go out, for a reason other than a sign-in. */
  retryAfterSignIn: (sessionId: string, message: FirstMessage) => Promise<boolean>;
  /** Puts a message back in the composer of the session it was written for. */
  onRestore: (sessionId: string, text: string, attachments?: readonly string[]) => void;
  /** The agent said it needs a sign-in. */
  onSignInNeeded?: (profileId: string) => void;
  /** Someone was seen signed in to the agent. */
  onSignedIn?: (profileId: string) => void;
  /** A refusal could not open its sign-in panel because another agent's sign-in is running. */
  onSignInBlocked?: (message: string) => void;
}

/**
 * Signs in to an agent that refused to work without it: in the agent itself
 * or through its terminal login, then asks the agent whether it took, and
 * sends the refused message again when it still waits untouched in its own
 * session's composer.
 */
export function useAgentSignIn(deps: AgentSignInDeps) {
  const { authRequest, requestSignIn: openPanel, dismiss: closePanel, setStatus, stopSigningIn } = useAgentAuth();
  const terminal = useTerminalSignIn();
  const closeTerminal = terminal.close;
  // Read when a sign-in ends, renders after it began.
  const depsRef = useLatest(deps);
  // The sign-in under way: one that was cancelled, dismissed or replaced by another request no longer acts.
  const attemptRef = useRef<object | null>(null);

  // Read when a request comes in, renders after the one it may replace was shown.
  const currentRequestRef = useLatest(authRequest);

  const requestSignIn = useCallback<AgentAuth['requestSignIn']>(
    (profileId, cwd, methods, pending) => {
      const current = currentRequestRef.current;
      const isOtherAgentSigningIn =
        current !== null && current.profileId !== profileId && (current.status === 'signing-in' || current.status === 'checking');
      depsRef.current.onSignInNeeded?.(profileId);
      // Another agent's login that is running is not cut off: this agent is asked again the next time it refuses.
      if (isOtherAgentSigningIn) return false;
      attemptRef.current = null;
      // A login of the request this one replaces ends with it, and so does its dialog.
      closeTerminal();
      openPanel(profileId, cwd, methods, pending);
      return true;
    },
    [closeTerminal, openPanel, depsRef, currentRequestRef],
  );

  const dismiss = useCallback(() => {
    attemptRef.current = null;
    closePanel();
  }, [closePanel]);

  /** The dialog's Cancel or Close: stops the login, or stops waiting for it, and sends nothing. */
  const cancel = useCallback(() => {
    attemptRef.current = null;
    closeTerminal();
    stopSigningIn();
  }, [closeTerminal, stopSigningIn]);

  /** The agent refused: puts the message back in its session's composer (when active) and opens the panel. */
  const handBack = useCallback(
    (session: Pick<Session, 'id' | 'profileId' | 'cwd'>, methods: AuthMethod[], unsent?: FirstMessage) => {
      const { composerRef, activeSessionIdRef } = depsRef.current;
      const composer = composerRef.current;
      // The composer on screen may be another session's by now: the message goes back only into its own.
      const isRestored = unsent !== undefined && composer !== null && session.id === activeSessionIdRef.current;
      if (isRestored) composer.restore(unsent.text, unsent.attachments);
      const pending = isRestored
        ? { sessionId: session.id, text: unsent.text, attachments: unsent.attachments }
        : undefined;
      // The message is back in the composer either way; when no panel opens, the user is told why.
      if (!requestSignIn(session.profileId, session.cwd, methods, pending)) depsRef.current.onSignInBlocked?.(SIGN_IN_RUNNING_NOTICE);
    },
    [depsRef, requestSignIn],
  );


  /** Runs the method in the agent, or its login in a terminal. */
  const runMethod = async ({ profileId, cwd }: AuthRequest, method: AuthMethod, agentName: string) => {
    if (method.kind === 'agent') {
      return invoke('acp_authenticate', { profileId, cwd, methodId: method.id }).then(
        (): LoginOutcome => ({ ok: true }),
        (error: unknown): LoginOutcome => ({ ok: false, reason: String(error) }),
      );
    }
    // A failed login's dialog gives way to the new one.
    terminal.close();
    return terminal.run({ profileId, cwd, agentName, method });
  };

  /**
   * Sends the refused message again, but only into its own session and only as
   * the user left it. A message that still does not go out comes back.
   */
  const sendRefused = (pending: AuthRequest['pending']) => {
    const { composerRef, activeSessionIdRef, retryAfterSignIn } = depsRef.current;
    const composer = composerRef.current;
    if (!pending || activeSessionIdRef.current !== pending.sessionId || !composer?.holdsRestored()) return false;
    const { sessionId, text, attachments } = pending;
    composer.clear();
    dismiss();
    void retryAfterSignIn(sessionId, { text, attachments }).then((isHandled) => {
      if (!isHandled) depsRef.current.onRestore(sessionId, text, attachments);
    });
    return true;
  };

  const signInWith = async (methodId: string, request: AuthRequest | null = authRequest, isQuiet = false) => {
    const method = request?.methods.find((m) => m.id === methodId);
    if (!request || !method || method.kind === 'explain') return;
    const attempt = {};
    attemptRef.current = attempt;
    const isCurrent = () => attemptRef.current === attempt;
    setStatus('signing-in');
    const agentName = depsRef.current.agents.find((a) => a.id === request.profileId)?.name ?? request.profileId;

    const outcome = await runMethod(request, method, agentName);
    if (!isCurrent()) return;
    if (!outcome.ok) {
      if (outcome.cancelled) setStatus('idle');
      else setStatus('failed', outcome.reason, outcome.methods);
      return;
    }

    if (method.kind === 'terminal') terminal.showChecking();
    const check = await checkSignIn(request.profileId, request.cwd);
    if (!isCurrent()) return;
    attemptRef.current = null;
    if (check === 'signed-out') {
      const reason = `${agentName} still says you are signed out`;
      if (method.kind === 'terminal') terminal.fail(reason);
      setStatus('failed', reason);
      return;
    }
    finishSignedIn(request, check === 'signed-in', isQuiet);
  };

  /**
   * The sign-in is taken as done: closes the login and sends the refused message again. The agent is
   * remembered as signed in only when it showed someone (`isSeen`), not when it just could not be asked.
   */
  const finishSignedIn = (request: AuthRequest, isSeen: boolean, isQuiet = false) => {
    if (isSeen) depsRef.current.onSignedIn?.(request.profileId);
    terminal.close();
    // The composer takes focus: the dialog's opener, the panel's button, is gone by now. A sign-in
    // started in Settings leaves focus there, for the row to take.
    if (!isQuiet) depsRef.current.composerRef.current?.focus();
    if (!sendRefused(request.pending)) setStatus('signed-in');
  };

  const lastStartRef = useRef<{ start: SignInStart; methodId: string } | null>(null);

  /** Signs in to an agent from Settings: the same login as the draft's panel, for the methods the row shows. */
  const startSignIn = (start: SignInStart, methodId: string): boolean => {
    // Without its request (refused while another agent signs in) no login may run.
    if (!requestSignIn(start.profileId, start.cwd, start.methods)) return false;
    lastStartRef.current = { start, methodId };
    void signInWith(methodId, { ...start, status: 'idle' }, true);
    return true;
  };

  /** The login dialog's Try again, for a sign-in started with `startSignIn`. */
  const retryStart = () => {
    const last = lastStartRef.current;
    if (last) startSignIn(last.start, last.methodId);
  };

  /** Asks the agent again, for a sign-in made outside the app (a key in the shell, a terminal). */
  const recheck = async () => {
    const request = authRequest;
    if (!request) return;
    const attempt = {};
    attemptRef.current = attempt;
    setStatus('checking');
    const check = await checkSignIn(request.profileId, request.cwd);
    if (attemptRef.current !== attempt) return;
    attemptRef.current = null;
    if (check === 'signed-in') {
      finishSignedIn(request, true);
      return;
    }
    const agentName = depsRef.current.agents.find((a) => a.id === request.profileId)?.name ?? request.profileId;
    setStatus(
      'failed',
      check === 'signed-out' ? `${agentName} still says you are signed out` : `Could not ask ${agentName} whether you are signed in`,
    );
  };

  const auth: AgentAuth = {
    authRequest,
    requestSignIn,
    signIn: (methodId) => void signInWith(methodId),
    recheck: () => void recheck(),
    dismiss,
  };

  return { auth, handBack, cancel, terminal, startSignIn, retryStart };
}
