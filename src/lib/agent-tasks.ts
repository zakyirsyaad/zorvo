import type { ChatMessage } from '../types';
import { QWEN_CODE_ID } from './agent-ids';

/** Qwen Code runs agents in the background inside its own process and lists them over ACP; no other agent is asked. */
export const REPORTS_TASKS: ReadonlySet<string> = new Set([QWEN_CODE_ID]);

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
  /** The newest activity's time, else the start. */
  lastActivityAt?: number;
  agentType?: string;
  /** The tool call that launched it, when the agent says which. */
  toolUseId?: string;
  isBackground: boolean;
  /** The newest last, at most `MAX_ACTIVITIES`. */
  activities: AgentActivity[];
}

export interface AgentTasks {
  /** The agent's clock when it answered, in ms. */
  asOf?: number;
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
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
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
  const lastActivityAt = time(value.lastActivityAt);
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
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
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
  const asOf = time(value.asOf);
  return { ...(asOf === undefined ? {} : { asOf }), tasks: value.tasks.flatMap((item) => taskOf(item) ?? []), more };
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

/** The patience the stalled-agent notice gives a running tool: an activity is recorded when a tool starts, and a build or a test run takes minutes. */
export const QUIET_AFTER_MS = 5 * 60_000;
const MS_PER_MINUTE = 60_000;
/** Past this many minutes a time reads in hours and minutes. */
const HOURS_FROM_MINUTES = 90;

/** How long a task at work has reported nothing, by the agent's own clock; 0 when it cannot be told. */
export function quietMs(task: AgentTask, asOf: number | undefined): number {
  if (!isWorkingTask(task) || asOf === undefined || task.lastActivityAt === undefined) return 0;
  return Math.max(0, asOf - task.lastActivityAt);
}

export function isQuiet(task: AgentTask, asOf: number | undefined): boolean {
  return quietMs(task, asOf) >= QUIET_AFTER_MS;
}

export function quietMinutes(ms: number): number {
  return Math.floor(ms / MS_PER_MINUTE);
}

/** "55 min", or "1 h 35 min" past 90 minutes. */
export function quietShortText(minutes: number): string {
  if (minutes <= HOURS_FROM_MINUTES) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "55 minutes", or "1 hour 35 minutes" past 90 minutes. */
export function quietSpanText(minutes: number): string {
  if (minutes <= HOURS_FROM_MINUTES) return plural(minutes, 'minute');
  const hours = plural(Math.floor(minutes / 60), 'hour');
  return minutes % 60 === 0 ? hours : `${hours} ${plural(minutes % 60, 'minute')}`;
}

export interface QuietNoticeParts {
  title: string;
  body: string;
}

/** The notice under the chat while background agents have gone quiet; null while none has. An unknown agent name is left out, not replaced. */
export function quietNoticeParts(agentName: string | undefined, tasks: readonly AgentTask[], asOf: number | undefined): QuietNoticeParts | null {
  const quiet = tasks.filter((task) => isQuiet(task, asOf));
  if (quiet.length === 0) return null;
  const span = quietSpanText(quietMinutes(Math.max(...quiet.map((task) => quietMs(task, asOf)))));
  const one = quiet.length === 1;
  const subject = one
    ? agentName ? `A background agent of ${agentName} has` : 'A background agent has'
    : agentName ? `${quiet.length} of ${agentName}'s background agents have` : `${quiet.length} background agents have`;
  return {
    title: `${subject} not reported anything for ${span}.`,
    body: `${one ? 'It' : 'They'} may be waiting on the model or running a long tool. Send a message to check.`,
  };
}

/** Every task at work is quiet, so asking often only repeats the same silence. */
export function areAllWorkingQuiet(tasks: readonly AgentTask[], asOf: number | undefined): boolean {
  const working = tasks.filter(isWorkingTask);
  return working.length > 0 && working.every((task) => isQuiet(task, asOf));
}
