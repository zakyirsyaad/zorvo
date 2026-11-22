import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { areAllWorkingQuiet, canAskAgentTasks, isWorkingTask, launchedAgentCount, parseAgentTasks, type AgentTasks } from "../lib/agent-tasks";
import type { ChatMessage } from "../types";

/** How long to wait before asking again while a background agent works. */
const POLL_MS = 10_000;
/** The wait while every task at work is quiet: asking more often only repeats the same silence. */
const QUIET_POLL_MS = 60_000;
/** Reads that fail in a row before asking stops, until the session changes or a turn ends. */
const MAX_FAILURES = 3;

export interface AgentTasksInput {
  /** The session on screen; null when none is. */
  sessionId: string | null;
  agentId?: string;
  /** The agent's own id for the session: another one means a new agent process. */
  acpSessionId?: string | null;
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
 * while the last answer holds a task at work. Every task at work being quiet makes it every 60 seconds. A failed read is silent and keeps the last answer until the third in a row drops it.
 */
export function useAgentTasks({ sessionId, agentId, acpSessionId, isRunning, messages, turnKey }: AgentTasksInput): AgentTasks | null {
  const [answer, setAnswer] = useState<{ sessionId: string; epoch: number; tasks: AgentTasks } | null>(null);
  // A new agent process (the session went from ended to running, or its ACP id changed) has its own agents:
  // what the last one reported is not shown while the new answer is on its way.
  const [process, setProcess] = useState({ isRunning, acpSessionId, epoch: 0 });
  if (process.isRunning !== isRunning || process.acpSessionId !== acpSessionId) {
    setProcess({ isRunning, acpSessionId, epoch: process.epoch + 1 });
  }
  const { epoch } = process;
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
      if (parsed) setAnswer({ sessionId, epoch, tasks: parsed });
      // Once the status cannot be read, the last one is not claimed any more: its clock would stand still.
      else if (failures.current.count >= MAX_FAILURES) setAnswer(null);
      const isAskingOn = parsed ? parsed.tasks.some(isWorkingTask) : failures.current.count < MAX_FAILURES;
      const wait = parsed && areAllWorkingQuiet(parsed.tasks, parsed.asOf) ? QUIET_POLL_MS : POLL_MS;
      if (isAskingOn) timer = setTimeout(() => void ask(), wait);
    };
    void ask();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [canAsk, sessionId, launched, turnKey, epoch]);

  // Shown only while asking is allowed: a rewind that took the agent call away, or an ended agent, leaves nothing to show.
  return canAsk && answer && answer.sessionId === sessionId && answer.epoch === epoch ? answer.tasks : null;
}
