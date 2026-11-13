import { invoke } from '@tauri-apps/api/core';
import {
  TRANSPORT_ACP,
  type ChatMessage,
  type ChatMessagePart,
  type DelegationLink,
  type OpenedByLink,
  type DiffRow,
  type PersistedState,
  type Session,
  type SessionWorktree,
  type ToolDetail,
} from '../types';
import { markElicitationsUnanswered } from './acp-elicitation';
import { settlePermissionCards } from './acp-events';
import { diffDetail } from './diff-rows';
import { normalizeAppearance } from './appearance';
import type { AgentOptions } from './acp-draft';
import { validReviewComments } from './review-comments';
import { toCommands, toConfigOptions, toModels, toModes } from '../hooks/useAcpSessions';

export const STATE_VERSION = 2;

export function emptyPersistedState(): PersistedState {
  return {
    version: STATE_VERSION,
    settings: { appearance: 'system', defaultAgentId: null, onboardingCompleted: false },
    recentFolders: [],
    sessions: [],
  };
}

/** Agent ids from before the ACP registry catalog, by the registry id that replaced them. */
export const LEGACY_AGENT_IDS: Readonly<Record<string, string>> = {
  'claude-code': 'claude-acp',
  qwen: 'qwen-code',
  codex: 'codex-acp',
};

/** Removed agents (Oh-My-Pi and Aider); saved settings that name them are cleaned on load. */
export const REMOVED_AGENT_IDS: readonly string[] = ['omp', 'aider'];

function isRemovedAgent(id: string): boolean {
  return REMOVED_AGENT_IDS.includes(id);
}

export function canonicalAgentId(id: string): string {
  return Object.hasOwn(LEGACY_AGENT_IDS, id) ? LEGACY_AGENT_IDS[id] : id;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSession(value: unknown): value is Session {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.profileId === 'string' &&
    typeof value.cwd === 'string' &&
    typeof value.status === 'string' &&
    typeof value.createdAt === 'number'
  );
}

function isWorktree(value: unknown): value is SessionWorktree {
  return (
    isObject(value) &&
    typeof value.repoPath === 'string' &&
    typeof value.path === 'string' &&
    typeof value.branch === 'string'
  );
}

/** Which session's agent opened a session: a non-empty session id and a finite time. */
function isOpenedByLink(value: unknown): value is OpenedByLink {
  return isObject(value) && typeof value.sessionId === 'string' && value.sessionId !== '' && Number.isFinite(value.at);
}

/** A link to the session that delegated a task: both texts non-empty, its times numeric. */
function isDelegationLink(value: unknown): value is DelegationLink {
  return (
    isObject(value) &&
    typeof value.sessionId === 'string' &&
    value.sessionId !== '' &&
    typeof value.task === 'string' &&
    value.task !== '' &&
    typeof value.startedAt === 'number' &&
    (value.endedAt === undefined || value.endedAt === null || typeof value.endedAt === 'number')
  );
}

/** A worktree without a startCommit that is not a string; old worktrees have none. */
function withValidStartCommit(worktree: SessionWorktree): SessionWorktree {
  const { startCommit, ...rest } = worktree;
  return typeof startCommit === 'string' ? { ...rest, startCommit } : rest;
}

/** A session keeps everything else when one of its optional fields is malformed. */
function withValidFields(session: Session): Session {
  const { worktree, pinned, archivedAt, namedByUser, hasUnread, historyElsewhere, compareRunId, reviewComments, delegatedFrom, openedBy, ...rest } = session;
  const comments = validReviewComments(reviewComments);
  return {
    ...rest,
    ...(worktree == null ? { worktree } : isWorktree(worktree) ? { worktree: withValidStartCommit(worktree) } : {}),
    ...(typeof pinned === 'boolean' ? { pinned } : {}),
    ...(archivedAt == null || typeof archivedAt === 'number' ? { archivedAt } : {}),
    ...(typeof namedByUser === 'boolean' ? { namedByUser } : {}),
    ...(typeof hasUnread === 'boolean' ? { hasUnread } : {}),
    ...(typeof historyElsewhere === 'boolean' ? { historyElsewhere } : {}),
    ...(compareRunId == null || typeof compareRunId === 'string' ? { compareRunId } : {}),
    ...(delegatedFrom === null || isDelegationLink(delegatedFrom) ? { delegatedFrom } : {}),
    ...(isOpenedByLink(openedBy) ? { openedBy } : {}),
    ...(comments.length > 0 ? { reviewComments: comments } : {}),
  };
}

/** The remembered picks, keeping only string values. */
function toPreferredConfig(raw: unknown): Pick<AgentOptions, 'preferredConfig'> {
  if (!isObject(raw)) return {};
  const picks = Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return picks.length > 0 ? { preferredConfig: Object.fromEntries(picks) } : {};
}

/**
 * Re-keys a record by canonical agent id. When an old and a new key collide,
 * the new key's value wins.
 */
function withCanonicalKeys<T>(record: Record<string, T>): Record<string, T> {
  const entries = Object.entries(record);
  const current = entries.filter(([id]) => canonicalAgentId(id) === id);
  const legacy = entries.filter(([id]) => canonicalAgentId(id) !== id);
  return Object.fromEntries(
    [...legacy, ...current]
      .filter(([id]) => !isRemovedAgent(canonicalAgentId(id)))
      .map(([id, value]) => [canonicalAgentId(id), value]),
  );
}

/** The model picked last, when it is a string. */
function toPreferredModelId(raw: unknown): Pick<AgentOptions, 'preferredModelId'> {
  return typeof raw === 'string' ? { preferredModelId: raw } : {};
}

/** Each model's effort option, keeping only well-formed ones. */
function toEffortsByModel(raw: unknown): Pick<AgentOptions, 'effortsByModel'> {
  if (!isObject(raw)) return {};
  const efforts = Object.entries(raw).flatMap(([model, option]) => {
    const [valid] = toConfigOptions([option]);
    return valid ? [[model, valid] as const] : [];
  });
  return efforts.length > 0 ? { effortsByModel: Object.fromEntries(efforts) } : {};
}

function toOneAgentOptions(options: Record<string, unknown>): AgentOptions {
  const models = toModels(options.models);
  return {
    modes: toModes(options.modes),
    ...(models ? { models } : {}),
    configOptions: toConfigOptions(options.configOptions),
    commands: toCommands(options.commands),
    ...toPreferredConfig(options.preferredConfig),
    ...toPreferredModelId(options.preferredModelId),
    ...toEffortsByModel(options.effortsByModel),
  };
}

function toAgentOptions(raw: unknown): Record<string, AgentOptions> {
  if (!isObject(raw)) return {};
  return withCanonicalKeys(
    Object.fromEntries(
      Object.entries(raw)
        .filter((entry): entry is [string, Record<string, unknown>] => isObject(entry[1]))
        .map(([profileId, options]) => [profileId, toOneAgentOptions(options)]),
    ),
  );
}

/** A list of canonical agent ids without repeats, or undefined when it is not a list of strings. */
function toAgentIdList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string')) return undefined;
  return [...new Set((raw as string[]).map(canonicalAgentId).filter((id) => !isRemovedAgent(id)))];
}

function toAgentVersions(raw: unknown): Record<string, string> {
  if (!isObject(raw) || !Object.values(raw).every((v) => typeof v === 'string')) return {};
  return withCanonicalKeys(raw as Record<string, string>);
}

function toDefaultAgentId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = canonicalAgentId(raw);
  return isRemovedAgent(id) ? null : id;
}

/** Agent id to announced version; entries that are not strings are dropped. */
function toNotifiedUpdates(raw: unknown): Record<string, string> {
  if (!isObject(raw)) return {};
  const strings = Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return withCanonicalKeys(Object.fromEntries(strings));
}

/**
 * Coerces whatever the backend returned into a well-formed state, keeping the
 * valid parts. A malformed file must degrade to "empty", never crash the UI.
 */
export function normalizePersistedState(raw: unknown): PersistedState {
  const empty = emptyPersistedState();
  if (!isObject(raw)) return empty;

  const settings = isObject(raw.settings) ? raw.settings : {};
  return {
    version: STATE_VERSION,
    settings: {
      appearance: normalizeAppearance(settings.appearance),
      defaultAgentId: toDefaultAgentId(settings.defaultAgentId),
      onboardingCompleted: settings.onboardingCompleted === true,
      ...(toAgentIdList(settings.enabledAgents) ? { enabledAgents: toAgentIdList(settings.enabledAgents) } : {}),
      removedAgents: toAgentIdList(settings.removedAgents) ?? [],
      agentVersions: toAgentVersions(settings.agentVersions),
      notifiedUpdates: toNotifiedUpdates(settings.notifiedUpdates),
      signedInAgents: toAgentIdList(settings.signedInAgents) ?? [],
      // On unless the user turned it off: a state written before the setting existed has it on.
      agentTools: settings.agentTools !== false,
    },
    recentFolders: Array.isArray(raw.recentFolders)
      ? raw.recentFolders.filter(
          (f): f is PersistedState['recentFolders'][number] =>
            isObject(f) && typeof f.name === 'string' && typeof f.path === 'string',
        )
      : [],
    sessions: Array.isArray(raw.sessions)
      ? raw.sessions.filter(isSession).map(withValidFields).map((s) => ({ ...s, profileId: canonicalAgentId(s.profileId) }))
      : [],
    agentOptions: toAgentOptions(raw.agentOptions),
  };
}

/**
 * Terminal (PTY) sessions are gone, and sessions saved before ACP have no
 * transport at all, so only ACP sessions survive a load. Returns the same
 * state object when nothing is dropped.
 */
export function dropTerminalSessions(state: PersistedState): { state: PersistedState; droppedSessionIds: string[] } {
  const kept = state.sessions.filter((s) => s.transport === TRANSPORT_ACP);
  if (kept.length === state.sessions.length) return { state, droppedSessionIds: [] };
  const droppedSessionIds = state.sessions.filter((s) => s.transport !== TRANSPORT_ACP).map((s) => s.id);
  return { state: { ...state, sessions: kept }, droppedSessionIds };
}

export interface LoadedAppState {
  state: PersistedState;
  /** The file was written by an older version, so its clean-up must be saved. */
  isOutdated: boolean;
}

export async function loadAppState(): Promise<LoadedAppState> {
  const raw = await invoke<unknown>('load_app_state');
  return {
    state: normalizePersistedState(raw),
    isOutdated: !isObject(raw) || raw.version !== STATE_VERSION,
  };
}

export function saveAppState(state: PersistedState): Promise<void> {
  return invoke('save_app_state', { state });
}

function isMessagePart(value: unknown): value is ChatMessagePart {
  if (!isObject(value)) return false;
  if (value.kind === 'text') return typeof value.text === 'string';
  return (
    value.kind === 'tools' &&
    Array.isArray(value.toolIds) &&
    value.toolIds.every((id) => typeof id === 'string')
  );
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'agent') &&
    typeof value.content === 'string' &&
    typeof value.timestamp === 'number'
  );
}

/** A turn-end time that is not a finite number is dropped, so no figure is made from it. */
function withValidEndTime(message: ChatMessage): ChatMessage {
  if (!('completedAt' in message) || Number.isFinite(message.completedAt)) return message;
  const { completedAt: _dropped, ...rest } = message;
  return rest;
}

/** A report or task mark keeps a non-empty agent name and, when it is a string, the agent's id. */
function withValidAgentMark(message: ChatMessage, key: 'delegationReport' | 'delegationTask'): ChatMessage {
  if (!(key in message)) return message;
  const { [key]: mark, ...rest } = message;
  if (!isObject(mark)) return rest as ChatMessage;
  const { agentName, agentId } = mark;
  if (typeof agentName !== 'string' || agentName === '') return rest as ChatMessage;
  return typeof agentId === 'string'
    ? ({ ...rest, [key]: { agentName, agentId } } as ChatMessage)
    : ({ ...rest, [key]: { agentName } } as ChatMessage);
}

function withValidDelegationReport(message: ChatMessage): ChatMessage {
  return withValidAgentMark(withValidAgentMark(message, 'delegationReport'), 'delegationTask');
}

/**
 * Keeps every well-formed saved message, dropping a `parts` list that does not
 * match the shape and dropping entries that are not messages. Messages saved
 * before parts existed simply have none, and render the way they always did.
 */
const DIFF_ROW_KINDS = new Set(['added', 'removed', 'context', 'skipped']);

function isDiffRow(value: unknown): value is DiffRow {
  return isObject(value) && typeof value.kind === 'string' && DIFF_ROW_KINDS.has(value.kind) && typeof value.text === 'string';
}

/**
 * A saved tool detail as this version keeps it. A diff an older Zorvo saved with the whole file before
 * and after becomes the rows it shows, so the transcript shrinks on its next save; a diff that is
 * neither is dropped. Other details are kept as they are.
 */
function toToolDetail(raw: unknown): ToolDetail | null {
  if (!isObject(raw) || raw.kind !== 'diff') return raw as ToolDetail;
  if (typeof raw.path !== 'string') return null;
  if (Array.isArray(raw.rows) && raw.rows.every(isDiffRow)) {
    return { kind: 'diff', path: raw.path, isNewFile: raw.isNewFile === true, rows: raw.rows };
  }
  const oldText = raw.oldText ?? null;
  if (typeof raw.newText === 'string' && (oldText === null || typeof oldText === 'string')) {
    return diffDetail(raw.path, oldText, raw.newText);
  }
  return null;
}

function withReadableDiffs(message: ChatMessage): ChatMessage {
  if (!Array.isArray(message.tools)) return message;
  const hasDiff = message.tools.some((tool) => Array.isArray(tool.details) && tool.details.some((detail) => isObject(detail) && detail.kind === 'diff'));
  if (!hasDiff) return message;
  return {
    ...message,
    tools: message.tools.map((tool) =>
      Array.isArray(tool.details)
        ? { ...tool, details: tool.details.flatMap((detail) => toToolDetail(detail) ?? []) }
        : tool,
    ),
  };
}

export function normalizeTranscript(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((raw): ChatMessage[] => {
    if (!isMessage(raw)) return [];
    const message = withValidDelegationReport(withReadableDiffs(withValidEndTime(raw)));
    if (!('parts' in message)) return [message];
    const { parts, ...rest } = message;
    const isWellFormed = Array.isArray(parts) && parts.length > 0 && parts.every(isMessagePart);
    return [isWellFormed ? { ...rest, parts } : (rest as ChatMessage)];
  });
}

export async function loadTranscript(sessionId: string): Promise<ChatMessage[]> {
  const messages = await invoke<unknown>('load_transcript', { sessionId });
  // Nothing runs after a restart, so no request saved as waiting can be answered.
  return settlePermissionCards(markElicitationsUnanswered(normalizeTranscript(messages)));
}

/** Resolves with the size the backend wrote, in bytes. */
export function saveTranscript(sessionId: string, messages: ChatMessage[]): Promise<unknown> {
  return invoke<unknown>('save_transcript', { sessionId, messages });
}

export function deleteTranscript(sessionId: string): Promise<void> {
  return invoke('delete_transcript', { sessionId });
}
