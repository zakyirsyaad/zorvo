import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { visualIdsOf } from "../lib/visuals";
import type { ChatMessage } from "../types";

/**
 * Removes the visuals a rewind left behind. When the loaded transcript of the session on screen
 * stops naming a visual it named before, the backend is told what it names now and deletes the
 * rest (never one shown under a minute ago). A first load, a switch of session and a transcript
 * that is not loaded never sweep.
 */
export function useVisualSweep(sessionId: string | null, messages: readonly ChatMessage[] | null): void {
  const seen = useRef<{ sessionId: string; ids: string[] } | null>(null);

  useEffect(() => {
    if (sessionId === null || messages === null) return;
    const ids = visualIdsOf(messages);
    const before = seen.current;
    seen.current = { sessionId, ids };
    if (before === null || before.sessionId !== sessionId) return;
    if (before.ids.every((id) => ids.includes(id))) return;
    // A failed sweep costs only disk: the files go with the session, or on the next rewind.
    invoke("visual_sweep", { sessionId, keep: ids }).catch(() => undefined);
  }, [sessionId, messages]);
}
