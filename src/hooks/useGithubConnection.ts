import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createId } from '../lib/ids';
import { GITHUB_CHECK_FAILED, toGithubStatus, type GithubStatus } from '../lib/github';
import { createPtyOutputStore, type PtyOutputStore } from '../lib/pty-output-store';
import { useLatest } from './useLatest';
import type { TerminalSignInState } from './useTerminalSignIn';

type GithubSignInEvent =
  | { terminalId: string; kind: 'output'; data: string }
  | { terminalId: string; kind: 'exit'; exitCode: number | null };

interface Run {
  terminalId: string;
  isStarted: boolean;
  isCancelled: boolean;
}

export interface GithubConnection {
  /** null until the first check answers. */
  status: GithubStatus | null;
  isChecking: boolean;
  check: () => Promise<GithubStatus>;
  /** Opens the sign-in terminal; the user's own `gh` signs them in there. */
  connect: () => void;
  /** The sign-in terminal's dialog, while one is open. */
  dialog: TerminalSignInState | null;
  output: PtyOutputStore;
  closeDialog: () => void;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
}

/**
 * The user's GitHub connection, read from their own GitHub CLI (the backend
 * asks `gh`; Zorvo holds no token), and the terminal in which `gh auth login`
 * runs. The status is read once at start, after a sign-in ends, and on request.
 */
export function useGithubConnection(): GithubConnection {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [dialog, setDialog] = useState<TerminalSignInState | null>(null);
  const [output] = useState<PtyOutputStore>(() => createPtyOutputStore());
  const runRef = useRef<Run | null>(null);
  // An older answer arriving after a newer check began counts for nothing.
  const latestCheck = useRef(0);

  const check = useCallback(async (): Promise<GithubStatus> => {
    const read = ++latestCheck.current;
    setIsChecking(true);
    const result = await invoke('github_status').then(toGithubStatus, () => GITHUB_CHECK_FAILED);
    if (read === latestCheck.current) {
      setStatus(result);
      setIsChecking(false);
    }
    return result;
  }, []);

  useEffect(() => {
    void check();
    return () => {
      latestCheck.current += 1;
    };
  }, [check]);

  // Someone who installed gh or signed in in their own terminal finds it noticed on coming back. A
  // connected account is not asked again on every focus: that would be a request to GitHub each time.
  const statusRef = useLatest(status);
  useEffect(() => {
    const recheck = () => {
      const current = statusRef.current;
      // Not while the sign-in terminal runs: its exit checks.
      if (current && current.state !== 'signed-in' && !runRef.current) void check();
    };
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [check, statusRef]);

  const patch = useCallback((terminalId: string, change: Partial<TerminalSignInState>) => {
    setDialog((current) => (current?.terminalId === terminalId ? { ...current, ...change } : current));
  }, []);

  /** The login ended well: asks `gh` whether it took, and closes the dialog when it did. */
  const finishSignIn = useCallback(
    async (run: Run) => {
      patch(run.terminalId, { phase: 'checking', error: undefined });
      const result = await check();
      if (run.isCancelled) return;
      if (result.state === 'signed-in') {
        runRef.current = null;
        setDialog(null);
        output.forget(run.terminalId);
        return;
      }
      patch(run.terminalId, {
        phase: 'failed',
        error:
          result.state === 'signed-out'
            ? 'GitHub still says you are signed out'
            : (result.message ?? GITHUB_CHECK_FAILED.message),
      });
    },
    [check, patch, output],
  );

  useEffect(() => {
    const unlisten = listen<GithubSignInEvent>('github-sign-in-terminal', ({ payload }) => {
      const run = runRef.current;
      if (!run || payload.terminalId !== run.terminalId || run.isCancelled) return;
      if (payload.kind === 'output') {
        output.append(payload.terminalId, payload.data);
      } else if (payload.exitCode === 0) {
        void finishSignIn(run);
      } else {
        patch(run.terminalId, { phase: 'failed', error: `The sign-in ended with code ${payload.exitCode}` });
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [output, finishSignIn, patch]);

  const end = useCallback(
    (run: Run) => {
      run.isCancelled = true;
      if (run.isStarted) void invoke('terminate_session', { sessionId: run.terminalId }).catch(() => {});
      output.forget(run.terminalId);
    },
    [output],
  );

  const closeDialog = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    setDialog(null);
    if (run) end(run);
  }, [end]);

  const connect = useCallback(() => {
    // A sign-in under way, or a failed one's dialog, gives way to the new one.
    if (runRef.current) end(runRef.current);
    const terminalId = createId('ghlogin');
    const run: Run = { terminalId, isStarted: false, isCancelled: false };
    output.forget(terminalId);
    runRef.current = run;
    setDialog({ terminalId, agentName: 'GitHub', methodName: 'GitHub CLI', phase: 'starting' });
    invoke('github_start_sign_in', { terminalId }).then(
      () => {
        run.isStarted = true;
        if (run.isCancelled) {
          void invoke('terminate_session', { sessionId: terminalId }).catch(() => {});
          return;
        }
        // The login may already have ended (its exit can beat this reply).
        setDialog((state) =>
          state?.terminalId === terminalId && state.phase === 'starting' ? { ...state, phase: 'running' } : state,
        );
      },
      (error: unknown) => {
        if (!run.isCancelled) patch(terminalId, { phase: 'failed', error: String(error) });
      },
    );
  }, [end, output, patch]);

  const sendInput = useCallback((data: string) => {
    const run = runRef.current;
    if (run) void invoke('send_input', { sessionId: run.terminalId, data }).catch(() => {});
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const run = runRef.current;
    if (run) void invoke('resize_session', { sessionId: run.terminalId, cols, rows }).catch(() => {});
  }, []);

  return { status, isChecking, check, connect, dialog, output, closeDialog, sendInput, resize };
}
