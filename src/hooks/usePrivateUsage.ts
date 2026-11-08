import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import { parsePrivateSessionUsage } from "../lib/private-usage";
import type { Session } from "../types";

interface PrivateUsageDeps {
  sessions: readonly Session[];
  /** Writes the last total on the session, the only place it is kept across a restart. */
  updateSession: (sessionId: string, usage: NonNullable<Session["privateUsage"]>) => void;
}

/**
 * Reads a private session's usage at the same turn-end checks as verification. The backend's
 * records live for the app run, so the first read of a session adds its answer to the total saved
 * before the last restart.
 */
export function usePrivateUsage({ sessions, updateSession }: PrivateUsageDeps) {
  const deps = useRef({ sessions, updateSession });
  deps.current = { sessions, updateSession };
  const bases = useRef(new Map<string, NonNullable<Session["privateUsage"]>>());
  const runs = useRef(new Map<string, number>());

  const refresh = useCallback((sessionId: string) => {
    const { sessions, updateSession } = deps.current;
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session?.privateMode) return;
    const run = (runs.current.get(sessionId) ?? 0) + 1;
    runs.current.set(sessionId, run);
    void invoke<unknown>("private_session_usage", { sessionId })
      .then((answer) => {
        if (runs.current.get(sessionId) !== run) return;
        const usage = parsePrivateSessionUsage(answer);
        if (!usage) return;
        const base = bases.current.get(sessionId) ?? session.privateUsage ?? { credits: 0, estimated: false };
        bases.current.set(sessionId, base);
        updateSession(sessionId, {
          credits: base.credits + usage.credits,
          estimated: base.estimated || usage.estimated,
        });
      })
      .catch(() => {
        // A failed read leaves the last saved total in place; the next turn end asks again.
      });
  }, []);

  return { refresh };
}