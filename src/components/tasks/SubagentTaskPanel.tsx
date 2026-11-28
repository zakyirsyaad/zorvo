import { useEffect, useRef } from "react";
import { Users } from "lucide-react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { ThinkingBlock } from "../chat/ReplyExtras";
import { ToolCallList } from "../chat/ToolCallList";
import { ToolDetails } from "../chat/ToolDetails";
import { useNow } from "../../hooks/useNow";
import { STICK_TO_BOTTOM_PX } from "../../hooks/useStickToBottom";
import { formatElapsed } from "../../lib/background-tasks";
import { formatRelativeTime } from "../../lib/relative-time";
import { stepsLabel, type SubagentTask } from "../../lib/task-view";
import type { ChatMessagePart, ToolDetail, ToolExecution } from "../../types";
import { TaskHeader, TaskNote } from "./TaskHeader";

export interface SubagentTaskPanelProps {
  task: SubagentTask;
  parts: readonly ChatMessagePart[];
  tools: readonly ToolExecution[];
  thinking?: string;
  isTextCut?: boolean;
  /** What the subagent's own tool call returned to the agent, when the agent sends it. */
  details?: readonly ToolDetail[];
  agentName: string;
}

function detailOf(task: SubagentTask, agentName: string, isLive: boolean): string {
  const who = [task.agentType, `subagent of ${agentName}`].filter(Boolean);
  if (isLive) {
    const started = task.startedAt === undefined ? undefined : formatRelativeTime(task.startedAt);
    return [...who, started && `started ${started === "Just now" ? "just now" : started}`].filter(Boolean).join(" · ");
  }
  return [...who, stepsLabel(task.stepCount)].join(" · ");
}

/** What a subagent did, as its agent reported it: its steps in order, followed live while it works. */
export function SubagentTaskPanel({ task, parts, tools, thinking, isTextCut, details, agentName }: SubagentTaskPanelProps) {
  const isLive = task.status === "Working" || task.status === "Needs you";
  const now = useNow(1000, isLive && task.startedAt !== undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolsById = new Map(tools.map((tool) => [tool.id, tool]));

  // While it works the newest step stays in sight, until you scroll up to read an earlier one;
  // back near the bottom it follows again, as the chat does.
  const isFollowingRef = useRef(true);
  const onScroll = () => {
    const node = scrollRef.current;
    if (node) isFollowingRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= STICK_TO_BOTTOM_PX;
  };
  useEffect(() => {
    const node = scrollRef.current;
    if (isLive && node && isFollowingRef.current) node.scrollTop = node.scrollHeight;
  });

  // Once it is done, its last text is what it handed back, so it is shown apart from the steps.
  const hasReport = !isLive && task.lastText !== undefined && parts[parts.length - 1]?.kind === "text";
  const steps = hasReport ? parts.slice(0, -1) : parts;
  const who = task.agentType ?? "The subagent";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskHeader icon={<Users size={14} />} title={task.title} detail={detailOf(task, agentName, isLive)} />
      <div ref={scrollRef} onScroll={onScroll} data-testid="subagent-steps" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 pb-3.5 select-text">
        {thinking && <ThinkingBlock text={thinking} isDone={!isLive} />}
        {steps.map((part, index) =>
          part.kind === "text" ? (
            <div key={index} className="text-ui text-fg-secondary">
              <MarkdownRenderer content={part.text} />
            </div>
          ) : part.kind === "tools" ? (
            <div key={index} data-tool-rail="" className="ml-[7px] border-l border-border">
              <ToolCallList
                tools={part.toolIds.flatMap((id) => toolsById.get(id) ?? [])}
                defaultOpenDiffs={false}
                isTurnOver={!isLive}
              />
            </div>
          ) : null,
        )}
        {isTextCut && <TaskNote>The rest of its text was left out.</TaskNote>}
        {hasReport && (
          <section aria-label={`What it told ${agentName}`} className="flex flex-col gap-2">
            <p className="text-caption font-medium text-fg-muted">What it told {agentName}</p>
            <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-ui text-fg-secondary">
              <MarkdownRenderer content={task.lastText ?? ""} />
            </div>
          </section>
        )}
        {details && details.length > 0 && (
          <section aria-label="Result" className="flex flex-col gap-2">
            <p className="text-caption font-medium text-fg-muted">Result</p>
            <ToolDetails details={[...details]} />
          </section>
        )}
        {!isLive && (
          <TaskNote>This is {agentName}'s own report of what its subagent did. Rewinding the chat removes it too.</TaskNote>
        )}
      </div>
      {isLive && (
        <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-3.5 py-2.5">
          <p role="status" className="flex min-w-0 flex-1 items-center gap-2.5">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-running ring-4 ring-chip" />
            <span className="truncate text-fg-secondary">
              {task.status === "Needs you" ? `${who} needs your answer in the chat` : `${who} is working`}
            </span>
            {task.startedAt !== undefined && (
              <span className="shrink-0 font-mono text-caption tabular-nums text-fg-subtle">{formatElapsed(now - task.startedAt)}</span>
            )}
          </p>
          <span className="shrink-0 text-caption text-fg-subtle">Stop {agentName} to stop it</span>
        </div>
      )}
    </div>
  );
}
