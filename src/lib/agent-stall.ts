import type { ChatMessage } from '../types';

/** One failed request is routine (the agent retries); this many in a row is worth saying. */
export const STALL_MIN_FAILURES = 2;
/** How long an agent may send nothing before the chat says so. */
export const STALL_SILENCE_MS = 60_000;

const MS_PER_MINUTE = 60_000;

/** Requests an agent reported as failed in a row, and what it said about them. */
export interface AgentFailures {
  count: number;
  source: 'qwen-lifecycle' | 'codex';
  model?: string;
  /** The agent's own words for the last error, when it gave any. */
  detail?: string;
}

export type FailureReport =
  | { kind: 'failed'; source: 'qwen-lifecycle'; model?: string }
  | { kind: 'failed'; source: 'codex'; detail?: string }
  | { kind: 'recovered' };

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

/** What a session update says about the agent's failed requests, if anything. */
export function failureReportOf(update: unknown): FailureReport | null {
  const meta = recordOf(recordOf(update)?._meta);
  if (!meta) return null;
  return qwenReport(meta) ?? codexReport(meta);
}

/** The failures after one more report; `undefined` once a request goes through. */
export function nextFailures(prev: AgentFailures | undefined, report: FailureReport): AgentFailures | undefined {
  if (report.kind === 'recovered') return undefined;
  const model = report.source === 'qwen-lifecycle' ? (report.model ?? prev?.model) : prev?.model;
  const detail = report.source === 'codex' ? (report.detail ?? prev?.detail) : prev?.detail;
  return {
    count: (prev?.count ?? 0) + 1,
    source: report.source,
    ...(model ? { model } : {}),
    ...(detail ? { detail } : {}),
  };
}

/** The agent's own words, closed with a full stop when they have no end punctuation. */
function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export interface StallState {
  failures?: AgentFailures;
  silentForMs: number;
}

/** The notice's text, or null while there is nothing worth saying. Only states what the agent reported. */
export function stallNoticeText(agentName: string, { failures, silentForMs }: StallState): string | null {
  if (failures && failures.count >= STALL_MIN_FAILURES) {
    const target = failures.model ? ` to ${failures.model}` : '';
    const last = failures.detail ? ` Last error: ${asSentence(failures.detail)}` : '';
    return `${agentName}'s requests${target} failed ${failures.count} times in a row.${last}`;
  }
  if (silentForMs < STALL_SILENCE_MS) return null;
  const minutes = Math.floor(silentForMs / MS_PER_MINUTE);
  return `${agentName} hasn't sent anything for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

function lastAgentMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'agent') return messages[i];
  }
  return undefined;
}

/** True while the turn's last reply has a tool that has not finished: a long tool is not a stall. */
export function hasRunningTool(messages: readonly ChatMessage[]): boolean {
  return lastAgentMessage(messages)?.tools?.some((tool) => tool.status === 'running') ?? false;
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
