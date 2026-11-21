import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { VISUAL_GONE, parseVisualRead } from "../lib/visuals";

export type VisualDocument =
  | { status: "idle" | "loading" | "gone" | "failed" }
  | { status: "ready"; document: string };

/**
 * An inline visual's document, read once `isNear` first turns true. A file that is gone is told
 * apart from a read that failed, which `retry` asks for again.
 */
export function useVisualDocument(sessionId: string | undefined, id: string, isNear: boolean): VisualDocument & { retry: () => void } {
  const [state, setState] = useState<VisualDocument>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const isWanted = sessionId !== undefined && isNear;
  const isStarted = state.status !== "idle";

  useEffect(() => {
    if (!isWanted || sessionId === undefined) return;
    if (isStarted && attempt === 0) return;
    let isCurrent = true;
    setState({ status: "loading" });
    invoke("visual_read", { sessionId, id })
      .then((answer) => {
        if (!isCurrent) return;
        const read = parseVisualRead(answer);
        setState(read ? { status: "ready", document: read.document } : { status: "failed" });
      })
      .catch((error: unknown) => {
        if (isCurrent) setState({ status: error === VISUAL_GONE ? "gone" : "failed" });
      });
    return () => {
      isCurrent = false;
    };
    // `isStarted` only guards the first read; a later change of it must not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWanted, sessionId, id, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, retry };
}
