import { useEffect, useState } from "react";
import { Clock, Square } from "lucide-react";
import { Button } from "../ui/Button";
import {
  activityKeyOf,
  hasRunningTool,
  stallNoticeParts,
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
  const parts = stallNoticeParts(agentName, { failures, silentForMs });
  if (!parts) return null;

  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-chat items-center gap-3 rounded-xl border border-border bg-surface-2 py-3 pr-3 pl-4"
    >
      <Clock size={14} aria-hidden="true" className="shrink-0 text-status-attention" />
      <span className="flex min-w-0 flex-1 flex-col text-ui">
        <span data-notice-title="" className="font-semibold text-fg">{parts.title}</span>
        {parts.body && <span data-notice-body="" className="text-fg-muted">{" "}{parts.body}</span>}
      </span>
      {onStop && (
        <Button variant="outline" icon={<Square size={10} aria-hidden="true" />} className="shrink-0" onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}
