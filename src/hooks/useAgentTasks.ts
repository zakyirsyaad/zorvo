import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { canAskAgentTasks, isWorkingTask, launchedAgentCount, parseAgentTasks, type AgentTasks } from "../lib/agent-tasks";
import type { ChatMessage } from "../types";

/** How long to wait before asking again while a background agent works. */
const POLL_MS = 10_000;
/** Reads that fail in a row before asking stops, until the session changes or a turn ends. */
const MAX_FAILURES = 3;

export interface AgentTasksInput {
  /** The session on screen; null when none is. */
  sessionId: string | null;
  agentId?: string;
  /** The session's agent is alive. */
  isRunning: boolean;
  messages: readonly ChatMessage[];
  /** Moves at each turn end of the session. */
  turnKey: number;
}

/**
 * The background agents Qwen Code reports for the session on screen. It sends the client nothing
 * while they run, so Zorvo asks: only for a running session whose transcript launched an agent,
 * when it comes on screen, when the launched count changes, at each turn end, and every 10 seconds
 * while the last answer holds a task at work. A failed read is silent and keeps the last answer.
 */
export function useAgentTasks({ sessionId, agentId, isRunning, messages, turnKey }: AgentTasksInput): AgentTasks | null {
  const [answer, setAnswer] = useState<{ sessionId: string; tasks: AgentTasks } | null>(null);
  const failures = useRef({ key: "", count: 0 });
  const launched = useMemo(() => launchedAgentCount(messages), [messages]);
  const canAsk = sessionId !== null && canAskAgentTasks({ agentId, isRunning, launched });

  useEffect(() => {
    if (!canAsk || sessionId === null) return;
    const key = `${sessionId}:${turnKey}`;
    if (failures.current.key !== key) failures.current = { key, count: 0 };
    if (failures.current.count >= MAX_FAILURES) return;
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const parsed = await invoke("acp_agent_tasks", { sessionId }).then(parseAgentTasks, () => null);
      // The session left the screen, or the asking was restarted: this answer is stale.
      if (isCancelled) return;
      failures.current = { key, count: parsed ? 0 : failures.current.count + 1 };
      if (parsed) setAnswer({ sessionId, tasks: parsed });
      const isAskingOn = parsed ? parsed.tasks.some(isWorkingTask) : failures.current.count < MAX_FAILURES;
      if (isAskingOn) timer = setTimeout(() => void ask(), POLL_MS);
    };
    void ask();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [canAsk, sessionId, launched, turnKey]);

  // An ended session's agent is gone with its tasks, and nothing can ask it again.
  return isRunning && answer && answer.sessionId === sessionId ? answer.tasks : null;
}
