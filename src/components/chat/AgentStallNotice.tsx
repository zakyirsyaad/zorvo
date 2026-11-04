import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import {
  activityKeyOf,
  hasRunningTool,
  stallNoticeText,
  type AgentFailures,
} from "../../lib/agent-stall";
import type { ChatMessage } from "../../types";

const CHECK_EVERY_MS = 1000;

export interface AgentStallNoticeProps {
  agentName: string;
  messages: readonly ChatMessage[];
  /** Failed requests the agent reported in a row. */
  failures?: AgentFailures;
  onStop?: () => void;
}

/**
 * A soft warning under "Working…" when the agent reports failing requests or
 * has sent nothing for a minute. It says only what is known, never a cause,
 * and goes away on the agent's next news.
 */
export function AgentStallNotice({ agentName, messages, failures, onStop }: AgentStallNoticeProps) {
  const activityKey = activityKeyOf(messages);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // The agent sent news: silence counts from here.
  useEffect(() => {
    const at = Date.now();
    setSince(at);
    setNow(at);
  }, [activityKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  // A running tool is the agent working, however long it takes.
  const silentForMs = hasRunningTool(messages) ? 0 : Math.max(0, now - since);
  const text = stallNoticeText(agentName, { failures, silentForMs });
  if (!text) return null;

  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2 text-ui-sm text-fg-muted"
    >
      <span>{text}</span>
      {onStop && (
        <Button variant="outline" className="shrink-0 px-2 py-1" onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}
