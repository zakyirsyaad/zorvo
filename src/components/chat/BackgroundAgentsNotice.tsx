import { Clock } from "lucide-react";
import { quietNoticeParts, type AgentTask } from "../../lib/agent-tasks";

export interface BackgroundAgentsNoticeProps {
  agentName: string;
  tasks: readonly AgentTask[];
  /** The agent's clock in the answer the tasks came from. */
  asOf?: number;
}

/**
 * A soft warning under the chat while Qwen Code's background agents have reported nothing for five
 * minutes. It has no button: Zorvo cannot stop one background agent. The 10 s ask that keeps the
 * tasks fresh refreshes it, and it goes away when they report again, finish or the session ends.
 */
export function BackgroundAgentsNotice({ agentName, tasks, asOf }: BackgroundAgentsNoticeProps) {
  const parts = quietNoticeParts(agentName, tasks, asOf);
  if (!parts) return null;
  return (
    <div role="status" className="mx-auto flex w-full max-w-chat items-center gap-3 rounded-xl border border-border bg-surface-2 py-3 pr-3 pl-4">
      <Clock size={14} aria-hidden="true" className="shrink-0 text-status-attention" />
      <span className="flex min-w-0 flex-1 flex-col text-ui">
        <span className="font-semibold text-fg">{parts.title}</span>
        <span className="text-fg-muted">{parts.body}</span>
      </span>
    </div>
  );
}
