import { REPORTS_BREAKDOWN } from '../hooks/useContextBreakdown';
import type { ChatMessage } from '../types';

/** Qwen Code runs agents in the background inside its own process and lists them over ACP; no other agent is asked. */
export const REPORTS_TASKS: ReadonlySet<string> = new Set([REPORTS_BREAKDOWN]);

/** Zorvo's own words for a task's state; the backend maps the agent's. */
export type AgentTaskStatus = 'working' | 'done' | 'failed' | 'stopped' | 'unknown';

export interface AgentActivity {
  name: string;
  description: string;
  at?: number;
}

/** One background agent, as `acp_agent_tasks` reports it. */
export interface AgentTask {
  id: string;
  label: string;
  description: string;
  status: AgentTaskStatus;
  startedAt?: number;
  endedAt?: number;
  agentType?: string;
  /** The tool call that launched it, when the agent says which. */
  toolUseId?: string;
  isBackground: boolean;
  /** The newest last, at most `MAX_ACTIVITIES`. */
  activities: AgentActivity[];
}

export interface AgentTasks {
  tasks: AgentTask[];
  /** How many the backend left out. */
  more: number;
}

const MAX_ACTIVITIES = 5;
const STATUSES: readonly string[] = ['working', 'done', 'failed', 'stopped', 'unknown'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string cut by characters, as the backend cuts it. */
function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? Array.from(value).slice(0, max).join('') : undefined;
}

function time(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function activityOf(value: unknown): AgentActivity | null {
  if (!isObject(value)) return null;
  const name = text(value.name, 80);
  if (name === undefined) return null;
  const at = time(value.at);
  return { name, description: text(value.description, 200) ?? '', ...(at === undefined ? {} : { at }) };
}

function taskOf(value: unknown): AgentTask | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const idLength = Array.from(id).length;
  if (idLength < 1 || idLength > 200) return null;
  const startedAt = time(value.startedAt);
  const endedAt = time(value.endedAt);
  const agentType = text(value.agentType, 80);
  const toolUseId = text(value.toolUseId, 200);
  const activities = (Array.isArray(value.activities) ? value.activities : [])
    .flatMap((item) => activityOf(item) ?? [])
    .sort((a, b) => (a.at ?? -1) - (b.at ?? -1))
    .slice(-MAX_ACTIVITIES);
  return {
    id,
    label: text(value.label, 120) ?? '',
    description: text(value.description, 300) ?? '',
    status: typeof value.status === 'string' && STATUSES.includes(value.status) ? (value.status as AgentTaskStatus) : 'unknown',
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(agentType ? { agentType } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    isBackground: value.isBackground === true,
    activities,
  };
}

/** Validates the command's answer again, since it crosses a boundary; a shape it does not know gives null. */
export function parseAgentTasks(value: unknown): AgentTasks | null {
  if (!isObject(value) || !Array.isArray(value.tasks)) return null;
  const more = value.more;
  if (typeof more !== 'number' || !Number.isInteger(more) || more < 0) return null;
  return { tasks: value.tasks.flatMap((item) => taskOf(item) ?? []), more };
}

/** At work: reported working, or a status Zorvo does not know that has not ended. */
export function isWorkingTask(task: AgentTask): boolean {
  return task.status === 'working' || (task.status === 'unknown' && task.endedAt === undefined);
}

/** How many tool calls in the transcript are Qwen Code's own agent tool, which runs its agent in the background by default. */
export function launchedAgentCount(messages: readonly ChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + (message.tools ?? []).filter((tool) => tool.providerToolName?.toLowerCase() === 'agent').length,
    0,
  );
}

/** A session that never launched an agent is never asked, and neither is one whose agent is gone. */
export function canAskAgentTasks(on: { agentId: string | undefined; isRunning: boolean; launched: number }): boolean {
  return on.agentId !== undefined && REPORTS_TASKS.has(on.agentId) && on.isRunning && on.launched > 0;
}
