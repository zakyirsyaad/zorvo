import type { PullRequestStatus } from '../hooks/usePullRequest';
import type { TaskTab } from '../hooks/useTaskTabs';
import type { Artifact, ChatMessage } from '../types';
import { isQuiet, isWorkingTask, quietMinutes, quietMs, quietShortText, type AgentTask } from './agent-tasks';
import { isImagePath } from './attachments';
import type { BackgroundTask } from './background-tasks';
import type { CreatedFile } from './created-files';
import { escapeVisible } from './visible-text';
import { secondLine, shownTools, subagentTaskOf, waitingToolCallIds, type TaskStatus } from './task-view';

/** Rows a section shows before "Show N more". */
export const SECTION_CAP = 5;

/** A subagent or a shell command of the session, as the card lists it. */
export interface OverviewTask {
  key: string;
  kind: 'subagent' | 'shell';
  title: string;
  /** "Subagent · Explore · 8 steps", "Shell · localhost:1420". */
  detail: string;
  /** Running and waiting tasks show above; failed ones stay in sight; done ones fold away. */
  state: 'running' | 'needs-you' | 'failed' | 'done';
  /** The word a screen reader hears and a failed row shows. */
  status: TaskStatus | 'Running' | 'Quiet';
  startedAt?: number;
  /** What a click opens; a task Zorvo has no tab for (a background agent) has none and shows as a plain row. */
  tab?: TaskTab;
}

export interface OverviewInputs {
  messages: readonly ChatMessage[];
  /** The session's agent is in a turn. */
  isBusy: boolean;
  /** The session's live shell commands. */
  shellTasks: readonly BackgroundTask[];
  pages: readonly Artifact[];
  files: readonly CreatedFile[];
  pullRequest: PullRequestStatus | null;
  /** The background agents Qwen Code reports, when it does. */
  agentTasks?: readonly AgentTask[];
  /** The agent's clock in that answer, for how long a task has been quiet. */
  agentTasksAsOf?: number;
}

/** What the card shows; a section is left out while it has nothing to show, Artifacts aside. */
export interface Overview {
  /** Running and waiting tasks, then failed ones, newest first. */
  tasks: OverviewTask[];
  /** Finished tasks, newest first: under "N finished" while others run, else their own "Finished N" section. */
  finished: OverviewTask[];
  /** Files the user attached, newest first, one row per path. */
  sources: { path: string; isImage: boolean }[];
  pages: readonly Artifact[];
  files: readonly CreatedFile[];
  pullRequest: PullRequestStatus | null;
  /** Tasks at work now, for the collapsed pill. */
  runningCount: number;
}

const STATE_OF: Record<TaskStatus, OverviewTask['state']> = {
  Working: 'running',
  'Needs you': 'needs-you',
  Failed: 'failed',
  Done: 'done',
  'Did not finish': 'done',
};

/** The subagents of every reply, each marked as the chat would mark its row. */
function subagentTasks(messages: readonly ChatMessage[], isBusy: boolean): OverviewTask[] {
  const waiting = waitingToolCallIds(messages);
  let lastUser = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUser = index;
  });
  return messages.flatMap((message, index) => {
    // A reply before the user's last message belongs to a turn that has ended.
    const isTurnOver = !isBusy || index < lastUser;
    return shownTools(message.tools ?? [])
      // A subagent whose steps the agent marks; one it does not mark stays a plain tool in the reply.
      .filter((tool) => tool.steps !== undefined)
      .map((tool): OverviewTask => {
        const task = subagentTaskOf(tool, message, { isTurnOver, waitingToolCallIds: waiting });
        return {
          key: `subagent:${tool.id}`,
          kind: 'subagent',
          title: task.title,
          detail: `Subagent · ${secondLine(task)}`,
          state: STATE_OF[task.status],
          status: task.status,
          ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
          tab: { kind: 'subagent', toolId: tool.id },
        };
      });
  });
}

function shellTask(task: BackgroundTask): OverviewTask {
  return {
    key: `shell:${task.id}`,
    kind: 'shell',
    title: task.name,
    detail: task.detail ? `Shell · ${task.detail}` : 'Shell',
    state: 'running',
    status: 'Running',
    startedAt: task.startedAt,
    tab: { kind: 'shell', taskId: task.id },
  };
}

const TASK_STATUS_WORDS: Record<Exclude<AgentTask['status'], 'unknown'>, TaskStatus> = {
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Did not finish',
};

/** What a background agent last did, as "name: description". */
function lastActivityText(task: AgentTask): string | undefined {
  const activity = task.activities[task.activities.length - 1];
  if (!activity) return undefined;
  return activity.description ? `${activity.name}: ${activity.description}` : activity.name;
}

/** A background agent as a row. Everything the agent wrote is made visible text first. */
function agentTaskRow(task: AgentTask, asOf: number | undefined): OverviewTask {
  const isQuietNow = isQuiet(task, asOf);
  const status: TaskStatus = task.status === 'unknown' ? (isWorkingTask(task) ? 'Working' : 'Done') : TASK_STATUS_WORDS[task.status];
  const last = lastActivityText(task);
  const detail = isQuietNow
    ? `No activity for ${quietShortText(quietMinutes(quietMs(task, asOf)))}${last ? `. Last: ${last}` : ''}`
    : (last ?? task.agentType ?? 'Subagent');
  return {
    key: `agent-task:${task.id}`,
    kind: 'subagent',
    title: escapeVisible(task.label || task.description || 'Background agent'),
    detail: escapeVisible(detail),
    state: STATE_OF[status],
    status: isQuietNow ? 'Quiet' : status,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
  };
}

/** Background agents, less those a foreground subagent with steps already shows under the tool call that launched them. The card's rows and the chat's notice both count these. */
export function visibleAgentTasks(tasks: readonly AgentTask[], messages: readonly ChatMessage[]): AgentTask[] {
  const shown = new Set(messages.flatMap((message) => shownTools(message.tools ?? []).filter((tool) => tool.steps !== undefined).map((tool) => tool.id)));
  return tasks.filter((task) => task.toolUseId === undefined || !shown.has(task.toolUseId));
}

function agentTaskRows(tasks: readonly AgentTask[], messages: readonly ChatMessage[], asOf: number | undefined): OverviewTask[] {
  return visibleAgentTasks(tasks, messages).map((task) => agentTaskRow(task, asOf));
}

const newestFirst = (a: OverviewTask, b: OverviewTask) => (b.startedAt ?? 0) - (a.startedAt ?? 0);

/** The files the user attached to their messages, newest first, each once. */
function sourcesOf(messages: readonly ChatMessage[]): Overview['sources'] {
  const seen = new Set<string>();
  const sources: Overview['sources'] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    for (const path of [...(message.attachments ?? [])].reverse()) {
      if (seen.has(path)) continue;
      seen.add(path);
      sources.push({ path, isImage: isImagePath(path) });
    }
  }
  return sources;
}

/** The overview card of one session, worked out from what Zorvo already has; nothing is stored. */
export function overviewOf(inputs: OverviewInputs): Overview {
  const all = [
    ...subagentTasks(inputs.messages, inputs.isBusy),
    ...agentTaskRows(inputs.agentTasks ?? [], inputs.messages, inputs.agentTasksAsOf),
    ...inputs.shellTasks.map(shellTask),
  ].sort(newestFirst);
  const tasks = all.filter((task) => task.state !== 'done');
  return {
    // Failed ones stay in sight, after what is still at work.
    tasks: [...tasks.filter((task) => task.state !== 'failed'), ...tasks.filter((task) => task.state === 'failed')],
    finished: all.filter((task) => task.state === 'done'),
    sources: sourcesOf(inputs.messages),
    pages: inputs.pages,
    files: inputs.files,
    pullRequest: inputs.pullRequest,
    runningCount: all.filter((task) => task.state === 'running' || task.state === 'needs-you').length,
  };
}

/** The collapsed pill's words: "3 running · +42 −11", each part left out when it is zero. */
export function pillParts(runningCount: number, changes: { added: number; removed: number } | null): {
  running: string | null;
  added: number;
  removed: number;
} {
  return {
    running: runningCount > 0 ? `${runningCount} running` : null,
    added: changes?.added ?? 0,
    removed: changes?.removed ?? 0,
  };
}
