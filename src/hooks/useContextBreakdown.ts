import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QWEN_CODE_ID } from "../lib/agent-ids";
import { parseBreakdown, parseInstructionFiles, type ContextBreakdown, type InstructionFile } from "../lib/context-usage";

/** Qwen Code is the one agent that reports what fills its window. */
export const REPORTS_BREAKDOWN = QWEN_CODE_ID;

export interface ContextBreakdownState {
  /** The agent's own breakdown; null for an agent that reports none, or when its answer failed. */
  breakdown: ContextBreakdown | null;
  /** The instruction files Zorvo found, for its own estimate. */
  files: InstructionFile[];
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Asks what fills the session's window while the panel is mounted: once at first, again on
 * Refresh and at each turn end (`turnKey`). Qwen Code is asked over ACP; for every other agent,
 * or when Qwen Code's answer fails, Zorvo reads the sizes of the instruction files for its estimate.
 */
export function useContextBreakdown(sessionId: string, agentId: string, cwd: string, turnKey: number): ContextBreakdownState {
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [asked, setAsked] = useState(0);
  // A newer ask wins: an answer that arrives after it is dropped.
  const latestRef = useRef(0);

  useEffect(() => {
    const ask = ++latestRef.current;
    const isCurrent = () => latestRef.current === ask;
    const readFiles = () =>
      invoke("instruction_files", { root: cwd, agentId })
        .then((raw) => {
          if (isCurrent()) setFiles(parseInstructionFiles(raw));
        })
        .catch(() => {
          if (isCurrent()) setFiles([]);
        });
    const run = async () => {
      setIsLoading(true);
      if (agentId === REPORTS_BREAKDOWN) {
        const parsed = await invoke("acp_context_usage", { sessionId }).then(parseBreakdown, () => null);
        if (!isCurrent()) return;
        setBreakdown(parsed);
        if (parsed === null) await readFiles();
      } else {
        await readFiles();
      }
      if (isCurrent()) setIsLoading(false);
    };
    void run();
  }, [sessionId, agentId, cwd, turnKey, asked]);

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  return { breakdown, files, isLoading, refresh };
}
