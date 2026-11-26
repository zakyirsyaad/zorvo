import type { ChatMessage } from '../types';
import { asSentence } from './sentence';
import { escapeVisible } from './visible-text';

/** One failed request is routine (the agent retries); this many in a row is worth saying. */
export const STALL_MIN_FAILURES = 2;
/**
 * How long an agent may send nothing before the chat says so. Three minutes, not one: a model at a
 * high effort (Gemini in Antigravity) thinks for over a minute without streaming a word.
 */
export const STALL_SILENCE_MS = 3 * 60_000;
/** How long a running tool may go without news: a build or a test suite takes minutes. */
export const STALL_TOOL_SILENCE_MS = 5 * 60_000;
/** How long after Stop the turn may go on before End agent is offered: an agent may finish a step first. */
export const STOP_IGNORED_MS = 10_000;
/** A tool's name past this many characters is cut, as the notice is one line of it. */
const MAX_TOOL_NAME_CHARS = 80;
const MAX_FAILURE_DETAIL_CHARS = 500;

const MS_PER_MINUTE = 60_000;

/** Requests an agent reported as failed in a row, and what it said about them. */
export interface AgentFailures {
  count: number;
  source: 'qwen-lifecycle' | 'codex' | 'opencode';
  model?: string;
  /** The agent's own words for the last error, when it gave any. */
  detail?: string;
}

export type FailureReport =
  | { kind: 'failed'; source: 'qwen-lifecycle'; model?: string }
  | { kind: 'failed'; source: 'codex'; detail?: string }
  | { kind: 'failed'; source: 'opencode'; attempt: number; detail: string }
  | { kind: 'recovered'; source?: 'opencode' };

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function qwenReport(meta: Record<string, unknown>): FailureReport | null {
  const lifecycle = recordOf(meta.executionLifecycle);
  if (!lifecycle || lifecycle.kind !== 'request' || lifecycle.phase !== 'ended') return null;
  if (lifecycle.outcome !== 'error') return { kind: 'recovered' };
  return { kind: 'failed', source: 'qwen-lifecycle', model: textOf(lifecycle.model) };
}

function codexReport(meta: Record<string, unknown>): FailureReport | null {
  const error = recordOf(recordOf(meta.codex)?.error);
  if (!error || error.willRetry !== true) return null;
  const detail = textOf(error.additionalDetails) ?? textOf(error.message);
  return { kind: 'failed', source: 'codex', detail };
}

/** OpenCode V2 reports retries as an extension on session_info_update. */
function opencodeReport(update: Record<string, unknown>, meta: Record<string, unknown>): FailureReport | null {
  if (update.sessionUpdate !== 'session_info_update') return null;
  const value = meta['opencode/retry'];
  if (value === null) return { kind: 'recovered', source: 'opencode' };
  const retry = recordOf(value);
  if (!retry || typeof retry.attempt !== 'number' || !Number.isSafeInteger(retry.attempt) || retry.attempt < 1) return null;
  const at = retry.nextRetryAt;
  if (typeof at !== 'string' || at.length > 40 || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return null;
  const message = textOf(recordOf(retry.error)?.message);
  if (!message) return null;
  // Only the error message belongs in the notice, never response bodies or other
  // provider metadata. Bound it before escaping controls, then bound the result.
  const detail = escapeVisible(message.slice(0, MAX_FAILURE_DETAIL_CHARS)).slice(0, MAX_FAILURE_DETAIL_CHARS);
  return { kind: 'failed', source: 'opencode', attempt: retry.attempt, detail };
}

/** What a session update says about the agent's failed requests, if anything. */
export function failureReportOf(update: unknown): FailureReport | null {
  const record = recordOf(update);
  const meta = recordOf(record?._meta);
  if (!record || !meta) return null;
  return qwenReport(meta) ?? codexReport(meta) ?? opencodeReport(record, meta);
}

/** The failures after one more report; `undefined` once a request goes through. */
export function nextFailures(prev: AgentFailures | undefined, report: FailureReport): AgentFailures | undefined {
  if (report.kind === 'recovered') return report.source && prev?.source !== report.source ? prev : undefined;
  const sameSource = prev?.source === report.source ? prev : undefined;
  if (report.source === 'opencode') {
    // OpenCode gives an absolute attempt, which may be delivered more than once.
    if (sameSource && report.attempt <= sameSource.count) return sameSource;
    return { count: report.attempt, source: report.source, detail: report.detail };
  }
  const model = report.source === 'qwen-lifecycle' ? (report.model ?? sameSource?.model) : sameSource?.model;
  const detail = report.source === 'codex' ? (report.detail ?? sameSource?.detail) : sameSource?.detail;
  return {
    count: (sameSource?.count ?? 0) + 1,
    source: report.source,
    ...(model ? { model } : {}),
    ...(detail ? { detail } : {}),
  };
}


export interface StallState {
  failures?: AgentFailures;
  /** The running tool's name as shown, while one runs (`runningToolOf`). */
  runningTool?: string;
  silentForMs: number;
}

/** The notice's text, or null while there is nothing worth saying. Only states what the agent reported. */
/** The stall notice as a title and the sentence under it. Built apart, since a model name or an error may hold periods. */
export interface StallNoticeParts {
  title: string;
  body?: string;
}

function minutesText(ms: number): string {
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export function stallNoticeParts(agentName: string, { failures, runningTool, silentForMs }: StallState): StallNoticeParts | null {
  if (failures && failures.count >= STALL_MIN_FAILURES) {
    const target = failures.model ? ` to ${failures.model}` : '';
    return {
      title: `${agentName}'s requests${target} failed ${failures.count} times in a row.`,
      body: failures.detail ? `Last error: ${asSentence(failures.detail)}` : undefined,
    };
  }
  if (runningTool !== undefined) {
    if (silentForMs < STALL_TOOL_SILENCE_MS) return null;
    return {
      title: `${agentName} has been running one tool for ${minutesText(silentForMs)}.`,
      body: `${runningTool}. It may be stuck.`,
    };
  }
  if (silentForMs < STALL_SILENCE_MS) return null;
  return {
    title: `${agentName} hasn't sent anything for ${minutesText(silentForMs)}.`,
    body: 'It may be stuck.',
  };
}

/** The notice for a Stop the agent has not acted on: only ending its process stops it then. */
export function stopIgnoredParts(agentName: string): StallNoticeParts {
  return {
    title: `${agentName} hasn't stopped.`,
    body: 'End agent stops its process now. You can continue this session afterwards.',
  };
}

/** The stall notice as one line of text. */
export function stallNoticeText(agentName: string, state: StallState): string | null {
  const parts = stallNoticeParts(agentName, state);
  if (!parts) return null;
  return parts.body ? `${parts.title} ${parts.body}` : parts.title;
}

function lastAgentMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'agent') return messages[i];
  }
  return undefined;
}

/**
 * The name of the first tool of the turn's last reply that has not finished, as
 * the notice shows it (control and bidi characters spelled out, cut to one line),
 * or undefined while none runs. A running tool gets longer before the notice.
 */
export function runningToolOf(messages: readonly ChatMessage[]): string | undefined {
  const tool = lastAgentMessage(messages)?.tools?.find((entry) => entry.status === 'running');
  if (!tool) return undefined;
  const name = escapeVisible(tool.name.replace(/\s+/g, ' ').trim()) || 'A tool';
  return name.length > MAX_TOOL_NAME_CHARS ? `${name.slice(0, MAX_TOOL_NAME_CHARS)}…` : name;
}

/** Changes whenever the agent writes, thinks, updates a plan or a tool; equal while nothing arrives. */
export function activityKeyOf(messages: readonly ChatMessage[]): string {
  const reply = lastAgentMessage(messages);
  const tools = reply?.tools?.map((tool) => `${tool.id}:${tool.status}:${tool.details?.length ?? 0}`).join(',') ?? '';
  const plan = reply?.plan?.map((entry) => entry.status).join(',') ?? '';
  return [
    messages.length,
    reply?.id ?? '',
    reply?.content.length ?? 0,
    reply?.thinking?.length ?? 0,
    reply?.parts?.length ?? 0,
    tools,
    plan,
  ].join('|');
}

const NEWS_UPDATES = new Set(['tool_call', 'tool_call_update', 'plan']);
const CHUNK_UPDATES = new Set(['agent_message_chunk', 'agent_thought_chunk']);

/**
 * True when an update shows the agent got through: text, reasoning, a tool or a
 * plan. Empty chunks (Qwen's lifecycle notes) are not news, as the chat ignores them too.
 */
export function isNewsUpdate(update: unknown): boolean {
  const record = recordOf(update);
  const kind = record?.sessionUpdate;
  if (typeof kind !== 'string') return false;
  if (NEWS_UPDATES.has(kind)) return true;
  if (!CHUNK_UPDATES.has(kind)) return false;
  return textOf(recordOf(record?.content)?.text) !== undefined;
}
