import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { foldVerifications, type VerificationRecord } from '../lib/private-verification';
import type { ChatMessage } from '../types';

/** One more ask after the turn, to catch a record the proxy finishes a moment later. */
const EXTRA_CHECK_MS = 2_000;
/** A checking answer is asked again after this long, until the backend reaches its own cap. */
const CHECK_AGAIN_MS = 10_000;
/** The Rust verifier gives up after three calls; stop asking after three checking answers too. */
const MAX_CHECKS = 3;
/**
 * The proxy closes a call's record only when NEAR AI ends the response body, which live came well
 * after the agent's turn end. An answer with no record yet is asked again this often, this many times.
 */
const WAIT_AGAIN_MS = 5_000;
const MAX_WAITS = 24;

type SessionTimers = {
  extra?: ReturnType<typeof setTimeout>;
  again?: ReturnType<typeof setTimeout>;
  checks: number;
  waits: number;
};

export interface PrivateVerificationDeps {
  updateMessages: (sessionId: string, change: (prev: ChatMessage[]) => ChatMessage[]) => void;
  /** Writes the transcript after the badge lands; a failed check leaves the next turn to retry. */
  saveSoon?: (sessionId: string) => void;
  /** A session deleted while a check was in flight no longer takes its result. */
  isKnownSession?: (sessionId: string) => boolean;
  /** Runs on each check (the turn end, its 2 s extra ask and the 10 s re-asks): usage shares this timer. */
  onCheck?: (sessionId: string) => void;
}

/** Asks for the session's private call states and puts them on the replies they belong to. */
export function usePrivateVerification({ updateMessages, saveSoon, isKnownSession, onCheck }: PrivateVerificationDeps) {
  const deps = useRef({ updateMessages, saveSoon, isKnownSession, onCheck });
  deps.current = { updateMessages, saveSoon, isKnownSession, onCheck };
  const timersRef = useRef(new Map<string, SessionTimers>());
  const runsRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);
  const checkRef = useRef<(sessionId: string, run: number) => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    const runs = runsRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach(clearTimers);
      timers.clear();
      runs.clear();
    };
  }, []);

  const forget = useCallback((sessionId: string) => {
    const entry = timersRef.current.get(sessionId);
    if (entry) clearTimers(entry);
    timersRef.current.delete(sessionId);
    runsRef.current.delete(sessionId);
  }, []);

  const clearAgain = useCallback((sessionId: string) => {
    const entry = timersRef.current.get(sessionId);
    if (entry?.again === undefined) return;
    clearTimeout(entry.again);
    entry.again = undefined;
  }, []);

  const noteChecking = useCallback(
    (sessionId: string, run: number) => {
      const entry = timersRef.current.get(sessionId);
      if (!entry) return;
      entry.checks += 1;
      if (entry.checks >= MAX_CHECKS) {
        clearAgain(sessionId);
        return;
      }
      if (entry.again !== undefined) return;
      entry.again = setTimeout(() => {
        const current = timersRef.current.get(sessionId);
        if (current) current.again = undefined;
        checkRef.current(sessionId, run);
      }, CHECK_AGAIN_MS);
    },
    [clearAgain],
  );

  /** No record yet, or the check failed: ask again, on its own longer count. */
  const noteWaiting = useCallback((sessionId: string, run: number) => {
    const entry = timersRef.current.get(sessionId);
    if (!entry || entry.again !== undefined) return;
    entry.waits += 1;
    if (entry.waits > MAX_WAITS) return;
    entry.again = setTimeout(() => {
      const current = timersRef.current.get(sessionId);
      if (current) current.again = undefined;
      checkRef.current(sessionId, run);
    }, WAIT_AGAIN_MS);
  }, []);

  const check = useCallback(
    (sessionId: string, run: number) => {
      if (!mountedRef.current || runsRef.current.get(sessionId) !== run) return;
      const { updateMessages, saveSoon, isKnownSession, onCheck } = deps.current;
      if (isKnownSession?.(sessionId) === false) {
        forget(sessionId);
        return;
      }
      onCheck?.(sessionId);
      void invoke<VerificationRecord[]>('private_verify', { sessionId })
        .then((records) => {
          if (!mountedRef.current || runsRef.current.get(sessionId) !== run) return;
          if (isKnownSession?.(sessionId) === false) {
            forget(sessionId);
            return;
          }
          if (!Array.isArray(records)) {
            clearAgain(sessionId);
            return;
          }
          // The proxy closes a call's record a moment after the agent ends its turn (seen live): no
          // record yet is asked again like a checking one, or the badge waits for the next turn.
          if (records.length === 0) {
            noteWaiting(sessionId, run);
            return;
          }
          updateMessages(sessionId, (prev) => foldVerifications(prev, records));
          saveSoon?.(sessionId);
          if (!records.some((record) => record.state === 'checking')) {
            clearAgain(sessionId);
            return;
          }
          noteChecking(sessionId, run);
        })
        .catch(() => {
          // No key yet, or the app is closing: asked again like a missing record, then the next turn end.
          if (mountedRef.current && runsRef.current.get(sessionId) === run) noteWaiting(sessionId, run);
        });
    },
    [clearAgain, forget, noteChecking, noteWaiting],
  );
  checkRef.current = check;

  const verifyTurn = useCallback(
    (sessionId: string) => {
      if (!mountedRef.current) return;
      const run = (runsRef.current.get(sessionId) ?? 0) + 1;
      runsRef.current.set(sessionId, run);
      const previous = timersRef.current.get(sessionId);
      if (previous) clearTimers(previous);
      const entry: SessionTimers = { checks: 0, waits: 0 };
      timersRef.current.set(sessionId, entry);
      check(sessionId, run);
      // A new turn replaces the last turn's timers: its late answers belong to an old reply window.
      if (timersRef.current.get(sessionId) === entry) {
        entry.extra = setTimeout(() => {
          const current = timersRef.current.get(sessionId);
          if (current) current.extra = undefined;
          checkRef.current(sessionId, run);
        }, EXTRA_CHECK_MS);
      }
    },
    [check],
  );

  return { verifyTurn };
}

function clearTimers(entry: SessionTimers) {
  if (entry.extra !== undefined) clearTimeout(entry.extra);
  if (entry.again !== undefined) clearTimeout(entry.again);
  entry.extra = undefined;
  entry.again = undefined;
}
