import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { visualIdsOf } from "../lib/visuals";
import type { ChatMessage } from "../types";

/** The backend keeps a visual shown under a minute ago; the second sweep runs once that has passed. */
export const VISUAL_SWEEP_RETRY_MS = 65_000;

/**
 * Removes the visuals a rewind left behind. When the loaded transcript of the session on screen
 * stops naming a visual it named before, the backend is told what it names now and deletes the
 * rest (never one shown under a minute ago, so one more sweep follows after that minute, with
 * what the transcript names then). A first load, a switch of session and a transcript that is
 * not loaded never sweep.
 */
export function useVisualSweep(sessionId: string | null, messages: readonly ChatMessage[] | null): void {
  const seen = useRef<{ sessionId: string; ids: string[] } | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sessionId === null || messages === null) return;
    const ids = visualIdsOf(messages);
    const before = seen.current;
    seen.current = { sessionId, ids };
    if (before === null || before.sessionId !== sessionId) return;
    if (before.ids.every((id) => ids.includes(id))) return;
    // A failed sweep costs only disk: the files go with the session, or on the next rewind.
    const sweep = (keep: string[]) => invoke("visual_sweep", { sessionId, keep }).catch(() => undefined);
    void sweep(ids);
    if (retry.current !== null) clearTimeout(retry.current);
    retry.current = setTimeout(() => {
      retry.current = null;
      const now = seen.current;
      if (now !== null && now.sessionId === sessionId) void sweep(now.ids);
    }, VISUAL_SWEEP_RETRY_MS);
  }, [sessionId, messages]);

  // The later sweep belongs to the session it was set for: leaving that session drops it.
  useEffect(
    () => () => {
      if (retry.current !== null) clearTimeout(retry.current);
      retry.current = null;
    },
    [sessionId],
  );
}
