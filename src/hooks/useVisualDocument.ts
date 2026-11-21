import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { VISUAL_GONE, parseVisualRead } from "../lib/visuals";

export type VisualDocument =
  | { status: "idle" | "loading" | "gone" | "failed" }
  | { status: "ready"; document: string };

/**
 * An inline visual's document, read once `isNear` first turns true. A read under way is never
 * dropped when the block leaves the screen, so a fast scroll cannot leave it loading for good.
 * A file that is gone is told apart from a read that failed, which `retry` asks for again.
 */
export function useVisualDocument(sessionId: string | undefined, id: string, isNear: boolean): VisualDocument & { retry: () => void } {
  const [state, setState] = useState<VisualDocument>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  /** The read asked for last: one per session, visual and attempt. */
  const requested = useRef<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (sessionId === undefined || !isNear) return;
    const key = `${sessionId}/${id}/${attempt}`;
    if (requested.current === key) return;
    requested.current = key;
    const isCurrent = () => isMounted.current && requested.current === key;
    setState({ status: "loading" });
    invoke("visual_read", { sessionId, id })
      .then((answer) => {
        if (!isCurrent()) return;
        const read = parseVisualRead(answer);
        setState(read ? { status: "ready", document: read.document } : { status: "failed" });
      })
      .catch((error: unknown) => {
        if (isCurrent()) setState({ status: error === VISUAL_GONE ? "gone" : "failed" });
      });
  }, [sessionId, id, isNear, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, retry };
}
