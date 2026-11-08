import { invoke } from '@tauri-apps/api/core';
import { TRANSPORT_ACP, type ChatMessage, type ChatMessagePart, type MessageVerification, type PersistedState, type Session, type SessionWorktree } from '../types';
import { markElicitationsUnanswered } from './acp-elicitation';
import { settlePermissionCards } from './acp-events';
import { normalizeAppearance } from './appearance';
import type { AgentOptions } from './acp-draft';
import { validReviewComments } from './review-comments';
import { toCommands, toConfigOptions, toModels, toModes } from '../hooks/useAcpSessions';

export const STATE_VERSION = 2;

export function emptyPersistedState(): PersistedState {
  return {
    version: STATE_VERSION,
    settings: { appearance: 'system', defaultAgentId: null, onboardingCompleted: false, secretGuard: true, paymentSource: 'credits' },
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

function isPrivateMode(value: unknown): value is { modelId: string; ownKey?: boolean } {
  return isObject(value) && typeof value.modelId === 'string' && value.modelId.length > 0;
}

/** A saved usage total, with its estimated flag; malformed entries are dropped. */
function toPrivateUsage(value: unknown): Session['privateUsage'] | undefined {
  if (!isObject(value) || typeof value.credits !== 'number' || !Number.isFinite(value.credits) || value.credits < 0) {
    return undefined;
  }
  return { credits: value.credits, estimated: value.estimated === true };
}

/** A worktree without a startCommit that is not a string; old worktrees have none. */
function withValidStartCommit(worktree: SessionWorktree): SessionWorktree {
  const { startCommit, ...rest } = worktree;
  return typeof startCommit === 'string' ? { ...rest, startCommit } : rest;
}

/** A session keeps everything else when one of its optional fields is malformed. */
function withValidFields(session: Session): Session {
  const { worktree, pinned, archivedAt, namedByUser, hasUnread, historyElsewhere, compareRunId, reviewComments, privateMode, privateUsage, ...rest } = session;
  const comments = validReviewComments(reviewComments);
  const usage = toPrivateUsage(privateUsage);
  return {
    ...rest,
    ...(worktree == null ? { worktree } : isWorktree(worktree) ? { worktree: withValidStartCommit(worktree) } : {}),
    ...(typeof pinned === 'boolean' ? { pinned } : {}),
    ...(archivedAt == null || typeof archivedAt === 'number' ? { archivedAt } : {}),
    ...(typeof namedByUser === 'boolean' ? { namedByUser } : {}),
    ...(typeof hasUnread === 'boolean' ? { hasUnread } : {}),
    ...(typeof historyElsewhere === 'boolean' ? { historyElsewhere } : {}),
    ...(compareRunId == null || typeof compareRunId === 'string' ? { compareRunId } : {}),
    ...(comments.length > 0 ? { reviewComments: comments } : {}),
    ...(isPrivateMode(privateMode)
      ? { privateMode: { modelId: privateMode.modelId, ...(privateMode.ownKey === true ? { ownKey: true } : {}) } }
      : {}),
    ...(usage ? { privateUsage: usage } : {}),
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

function toOneAgentOptions(options: Record<string, unknown>): AgentOptions {
  const models = toModels(options.models);
  return {
    modes: toModes(options.modes),
    ...(models ? { models } : {}),
    configOptions: toConfigOptions(options.configOptions),
    commands: toCommands(options.commands),
    ...toPreferredConfig(options.preferredConfig),
    ...toPreferredModelId(options.preferredModelId),
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
      privateLowBalanceNotified: settings.privateLowBalanceNotified === true,
      secretGuard: settings.secretGuard !== false,
      paymentSource: settings.paymentSource === 'ownKey' ? 'ownKey' : 'credits',
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

const VERIFICATION_STATES = new Set(['verified', 'didnt_verify', 'not_signed', 'checking']);
const VERIFICATION_KINDS = new Set(['provider_tee', 'gateway', 'unknown']);

function isVerification(value: unknown): value is MessageVerification {
  return (
    isObject(value) &&
    typeof value.state === 'string' &&
    VERIFICATION_STATES.has(value.state) &&
    typeof value.signed === 'number' &&
    Number.isFinite(value.signed) &&
    value.signed >= 0 &&
    typeof value.total === 'number' &&
    Number.isFinite(value.total) &&
    value.total >= 0 &&
    (value.kind === undefined || (typeof value.kind === 'string' && VERIFICATION_KINDS.has(value.kind))) &&
    (value.signer === undefined || typeof value.signer === 'string')
  );
}

/** A verification that does not match the shape is dropped; the reply itself stays. */
function withValidVerification(message: ChatMessage): ChatMessage {
  if (!('verification' in message) || isVerification(message.verification)) return message;
  const { verification: _dropped, ...rest } = message;
  return rest;
}

/**
 * Keeps every well-formed saved message, dropping a `parts` list that does not
 * match the shape and dropping entries that are not messages. Messages saved
 * before parts existed simply have none, and render the way they always did.
 */
export function normalizeTranscript(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((raw): ChatMessage[] => {
    if (!isMessage(raw)) return [];
    const message = withValidVerification(withValidEndTime(raw));
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
