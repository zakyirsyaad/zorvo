import { isVisualId, isVisualKind } from './visuals';
import { parseNextStep } from './next-step';
import { invoke } from '@tauri-apps/api/core';
import {
  TRANSPORT_ACP,
  type ChatMessage,
  type ChatMessagePart,
  type ToolExecution,
  type DelegationLink,
  type WorkerLastTurn,
  type WorkerOutcome,
  type WorkerTurnEnd,
  type OpenedByLink,
  type DiffRow,
  type MessageVerification,
  type PersistedState,
  type Session,
  type SessionWorktree,
  type ToolDetail,
} from '../types';
import { markElicitationsUnanswered } from './acp-elicitation';
import { firstChars } from './session-helpers';
import { settlePermissionCards } from './acp-events';
import { withoutSettledIcons } from './computer-use-card';
import { diffDetail } from './diff-rows';
import { normalizeAppearance } from './appearance';
import type { AgentOptions } from './acp-draft';
import { validArtifactComments } from './artifact-comments';
import { validReviewComments } from './review-comments';
import { validAgentWork } from './agent-work';
import { parseArtifactCard } from './artifacts';
import { WORKER_STATES, type WorkerState } from './workers';
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

function isPrivateMode(value: unknown): value is { modelId: string; ownKey?: boolean; sessionCap?: number } {
  return isObject(value) && typeof value.modelId === 'string' && value.modelId.length > 0;
}

/** A whole positive credit cap, or nothing; an old or malformed value drops only the cap. */
function privateSessionCap(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** A saved usage total, with its estimated flag; malformed entries are dropped. */
function toPrivateUsage(value: unknown): Session['privateUsage'] | undefined {
  if (!isObject(value) || typeof value.credits !== 'number' || !Number.isFinite(value.credits) || value.credits < 0) {
    return undefined;
  }
  return { credits: value.credits, estimated: value.estimated === true };
}

const SESSION_HANDLE = /^session-[1-9][0-9]{0,5}$/;

/** The link with its handle only when that is one Zorvo could have issued. */
function withValidHandle(link: OpenedByLink): OpenedByLink {
  const base = { sessionId: link.sessionId, at: link.at };
  return typeof link.handle === 'string' && SESSION_HANDLE.test(link.handle) ? { ...base, handle: link.handle } : base;
}

/** Which session's agent opened a session: a non-empty session id and a finite time. */
function isOpenedByLink(value: unknown): value is OpenedByLink {
  return isObject(value) && typeof value.sessionId === 'string' && value.sessionId !== '' && Number.isFinite(value.at);
}

const WORKER_HANDLE = /^worker-[1-9][0-9]*$/;
const MAX_WORKER_SUMMARY = 2000;
const MAX_WORKER_FILES = 50;
const MAX_WORKER_REASON = 300;
const TURN_ENDS: readonly string[] = ['finished', 'failed', 'cancelled', 'exited'];

function validOutcome(value: unknown): WorkerOutcome | undefined {
  if (!isObject(value) || (value.result !== 'succeeded' && value.result !== 'failed') || typeof value.at !== 'number' || !Number.isFinite(value.at)) {
    return undefined;
  }
  return {
    result: value.result,
    at: value.at,
    ...(typeof value.summary === 'string' ? { summary: firstChars(value.summary, MAX_WORKER_SUMMARY) } : {}),
    ...(Array.isArray(value.files) ? { files: value.files.filter((file): file is string => typeof file === 'string').slice(0, MAX_WORKER_FILES) } : {}),
  };
}

function validLastTurn(value: unknown): WorkerLastTurn | undefined {
  if (!isObject(value) || typeof value.endedAt !== 'number' || !Number.isFinite(value.endedAt) || typeof value.how !== 'string' || !TURN_ENDS.includes(value.how)) {
    return undefined;
  }
  return {
    endedAt: value.endedAt,
    how: value.how as WorkerTurnEnd,
    ...(typeof value.reason === 'string' ? { reason: firstChars(value.reason, MAX_WORKER_REASON) } : {}),
  };
}

/** The link with each worker field kept only when it is well formed. */
function withValidWorkerFields(link: DelegationLink): DelegationLink {
  const { handle, outcome, lastTurn, reportedAt, ...rest } = link;
  const validOutcomeValue = validOutcome(outcome);
  const validLastTurnValue = validLastTurn(lastTurn);
  return {
    ...rest,
    ...(typeof handle === 'string' && WORKER_HANDLE.test(handle) ? { handle } : {}),
    ...(validOutcomeValue ? { outcome: validOutcomeValue } : {}),
    ...(validLastTurnValue ? { lastTurn: validLastTurnValue } : {}),
    ...(typeof reportedAt === 'number' && Number.isFinite(reportedAt) ? { reportedAt } : {}),
  };
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
  const { worktree, pinned, archivedAt, namedByUser, hasUnread, historyElsewhere, titleSource, compareRunId, reviewComments, artifactComments, privateMode, privateUsage, delegatedFrom, openedBy, agentWork, ...rest } = session;
  const comments = validReviewComments(reviewComments);
  const pageComments = validArtifactComments(artifactComments);
  const usage = toPrivateUsage(privateUsage);
  const work = validAgentWork(agentWork);
  const sessionCap = isPrivateMode(privateMode) ? privateSessionCap(privateMode.sessionCap) : undefined;
  return {
    ...rest,
    ...(worktree == null ? { worktree } : isWorktree(worktree) ? { worktree: withValidStartCommit(worktree) } : {}),
    ...(typeof pinned === 'boolean' ? { pinned } : {}),
    ...(archivedAt == null || typeof archivedAt === 'number' ? { archivedAt } : {}),
    ...(typeof namedByUser === 'boolean' ? { namedByUser } : {}),
    ...(typeof hasUnread === 'boolean' ? { hasUnread } : {}),
    ...(typeof historyElsewhere === 'boolean' ? { historyElsewhere } : {}),
    ...(typeof titleSource === 'string' && titleSource !== '' ? { titleSource } : {}),
    ...(compareRunId == null || typeof compareRunId === 'string' ? { compareRunId } : {}),
    ...(delegatedFrom === null ? { delegatedFrom } : isDelegationLink(delegatedFrom) ? { delegatedFrom: withValidWorkerFields(delegatedFrom) } : {}),
    ...(isOpenedByLink(openedBy) ? { openedBy: withValidHandle(openedBy) } : {}),
    ...(comments.length > 0 ? { reviewComments: comments } : {}),
    ...(pageComments.length > 0 ? { artifactComments: pageComments } : {}),
    ...(isPrivateMode(privateMode)
      ? {
          privateMode: {
            modelId: privateMode.modelId,
            ...(privateMode.ownKey === true ? { ownKey: true } : {}),
            ...(sessionCap !== undefined ? { sessionCap } : {}),
          },
        }
      : {}),
    ...(usage ? { privateUsage: usage } : {}),
    ...(work ? { agentWork: work } : {}),
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
      privateLowBalanceNotified: settings.privateLowBalanceNotified === true,
      secretGuard: settings.secretGuard !== false,
      paymentSource: settings.paymentSource === 'ownKey' ? 'ownKey' : 'credits',
      // On unless the user turned it off: a state written before the setting existed has it on.
      agentTools: settings.agentTools !== false,
      // Off unless the user turned it on: any other value reads as off.
      computerUse: settings.computerUse === true,
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
  if (value.kind === 'visual') return isVisualId(value.id) && typeof value.title === 'string' && isVisualKind(value.visualKind);
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

/**
 * A verification that does not match the shape is dropped; the reply itself stays. One saved while
 * still `checking` reads as not signed: the proxy's records are gone after a restart, so nothing
 * would ever finish the check and the badge would spin for good.
 */
function withValidVerification(message: ChatMessage): ChatMessage {
  if (!('verification' in message)) return message;
  const { verification, ...rest } = message;
  if (!isVerification(verification)) return rest;
  return verification.state === 'checking'
    ? { ...rest, verification: { ...verification, state: 'not_signed' } }
    : message;
}

/** A report or task mark keeps a non-empty agent name and, when they are strings, the agent's id and a report's worker handle. */
function withValidAgentMark(message: ChatMessage, key: 'delegationReport' | 'delegationTask'): ChatMessage {
  if (!(key in message)) return message;
  const { [key]: mark, ...rest } = message;
  if (!isObject(mark)) return rest as ChatMessage;
  const { agentName, agentId, handle } = mark as { agentName?: unknown; agentId?: unknown; handle?: unknown };
  if (typeof agentName !== 'string' || agentName === '') return rest as ChatMessage;
  const kept = {
    agentName,
    ...(typeof agentId === 'string' ? { agentId } : {}),
    ...(key === 'delegationReport' && typeof handle === 'string' ? { handle } : {}),
  };
  return { ...rest, [key]: kept } as ChatMessage;
}

/** A next step keeps the fields that fit (`parseNextStep`); the end mark only as `true`. */
function withValidNextStep(message: ChatMessage): ChatMessage {
  const { nextStep, endedNormally, ...rest } = message;
  const step = nextStep === undefined ? null : parseNextStep(nextStep);
  return {
    ...(rest as ChatMessage),
    ...(step ? { nextStep: step } : {}),
    ...(endedNormally === true ? { endedNormally: true as const } : {}),
  };
}

/** An artifact card keeps its three fields when they fit, else the message goes on without it. */
function withValidArtifactCard(message: ChatMessage): ChatMessage {
  if (!('artifactCard' in message)) return message;
  const { artifactCard, ...rest } = message;
  const card = parseArtifactCard(artifactCard);
  return card === null ? (rest as ChatMessage) : { ...rest, artifactCard: card };
}

const MAX_REPORTED_WORKERS = 50;

/** A worker report mark keeps its well-formed entries (the first of a repeated handle, at most 50); a mark left with none is dropped. */
function withValidWorkerReport(message: ChatMessage): ChatMessage {
  if (!('workerReport' in message)) return message;
  const { workerReport, ...rest } = message;
  const list = isObject(workerReport) ? (workerReport as { workers?: unknown }).workers : undefined;
  if (!Array.isArray(list)) return rest as ChatMessage;
  const workers = list
    .flatMap((item): NonNullable<ChatMessage['workerReport']>['workers'] => {
      if (!isObject(item)) return [];
      const { agentName, agentId, handle, state } = item as Record<string, unknown>;
      if (typeof agentName !== 'string' || typeof handle !== 'string') return [];
      if (typeof state !== 'string' || !(WORKER_STATES as readonly string[]).includes(state)) return [];
      return [{ agentName, ...(typeof agentId === 'string' ? { agentId } : {}), handle, state: state as WorkerState }];
    })
    .filter((worker, index, all) => all.findIndex((other) => other.handle === worker.handle) === index)
    .slice(0, MAX_REPORTED_WORKERS);
  return workers.length === 0 ? (rest as ChatMessage) : { ...rest, workerReport: { workers } };
}

/** A continued-from mark keeps both ids when they are non-empty strings, else the message goes on without it. */
function withValidContinuedFrom(message: ChatMessage): ChatMessage {
  if (!('continuedFrom' in message)) return message;
  const { continuedFrom, ...rest } = message;
  if (!isObject(continuedFrom)) return rest as ChatMessage;
  const { sessionId, agentId, toAgentId } = continuedFrom as { sessionId?: unknown; agentId?: unknown; toAgentId?: unknown };
  if (typeof sessionId !== 'string' || sessionId === '' || typeof agentId !== 'string' || agentId === '') {
    return rest as ChatMessage;
  }
  const taker = typeof toAgentId === 'string' && toAgentId !== '' ? { toAgentId } : {};
  return { ...rest, continuedFrom: { sessionId, agentId, ...taker } } as ChatMessage;
}

function withValidDelegationReport(message: ChatMessage): ChatMessage {
  return withValidContinuedFrom(
    withValidWorkerReport(withValidAgentMark(withValidAgentMark(message, 'delegationReport'), 'delegationTask')),
  );
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

/** Whether `steps` is a subagent's steps: well-formed parts whose tools are this tool's own children. */
function hasValidSteps(tool: Record<string, unknown>, byId: ReadonlyMap<string, Record<string, unknown>>): boolean {
  const steps = tool.steps;
  if (!Array.isArray(steps) || !steps.every(isMessagePart)) return false;
  return steps.every(
    (step) => step.kind !== 'tools' || step.toolIds.every((id) => byId.get(id)?.parentId === tool.id),
  );
}

/**
 * Keeps what a subagent did only where it holds together: a parent's steps must name its own
 * children, and a child must be named by its parent. A tool that loses its parent is added to the
 * reply's parts, so nothing a transcript holds stops showing.
 */
function withValidSubagentFields(message: ChatMessage): ChatMessage {
  if (!Array.isArray(message.tools)) return message;
  const raws = message.tools as unknown as Record<string, unknown>[];
  const marked = ['parentId', 'steps', 'agentType', 'thinking', 'isTextCut'];
  if (!raws.some((tool) => isObject(tool) && marked.some((key) => key in tool))) return message;

  const objects = raws.filter(isObject);
  const byId = new Map(objects.map((tool) => [String(tool.id), tool]));
  // A parent is never a child itself: one level, so two tools cannot hide each other.
  const parents = new Set(
    objects.filter((tool) => tool.parentId === undefined && hasValidSteps(tool, byId)).map((tool) => tool.id),
  );
  const listed = new Set(
    objects.flatMap((tool) =>
      parents.has(tool.id) ? (tool.steps as ChatMessagePart[]).flatMap((step) => (step.kind === 'tools' ? step.toolIds : [])) : [],
    ),
  );
  const orphans: string[] = [];
  const tools = raws.map((raw) => {
    if (!isObject(raw)) return raw;
    const { parentId, steps, agentType, thinking, isTextCut, ...rest } = raw;
    const isChild = typeof parentId === 'string' && parents.has(parentId) && listed.has(String(raw.id));
    if (parentId !== undefined && !isChild) orphans.push(String(raw.id));
    return {
      ...rest,
      ...(isChild ? { parentId } : {}),
      ...(parents.has(raw.id) ? { steps } : {}),
      ...(typeof agentType === 'string' ? { agentType } : {}),
      ...(typeof thinking === 'string' ? { thinking } : {}),
      ...(isTextCut === true ? { isTextCut } : {}),
    };
  }) as unknown as ToolExecution[];
  const parts =
    orphans.length && Array.isArray(message.parts)
      ? [...message.parts, { kind: 'tools' as const, toolIds: orphans }]
      : message.parts;
  return { ...message, tools, ...(parts ? { parts } : {}) };
}

/** A message's tools without anything that is not a tool with an id: the rest of the app reads their fields. */
function withOnlyTools(message: ChatMessage): ChatMessage {
  if (!Array.isArray(message.tools)) return message;
  const tools = message.tools.filter((tool) => isObject(tool) && typeof tool.id === 'string');
  return tools.length === message.tools.length ? message : { ...message, tools };
}

export function normalizeTranscript(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): ChatMessage[] => {
    if (!isMessage(entry)) return [];
    const raw = withOnlyTools(entry);
    const message = withValidNextStep(withValidArtifactCard(
      withValidSubagentFields(withValidVerification(withValidDelegationReport(withReadableDiffs(withValidEndTime(raw))))),
    ));
    if (!('parts' in message)) return [message];
    const { parts, ...rest } = message;
    const isWellFormed = Array.isArray(parts) && parts.length > 0 && parts.every(isMessagePart);
    return [isWellFormed ? { ...rest, parts } : (rest as ChatMessage)];
  });
}

export async function loadTranscript(sessionId: string): Promise<ChatMessage[]> {
  const messages = await invoke<unknown>('load_transcript', { sessionId });
  // Nothing runs after a restart, so no request saved as waiting can be answered.
  return withoutSettledIcons(settlePermissionCards(markElicitationsUnanswered(normalizeTranscript(messages))));
}

/** Resolves with the size the backend wrote, in bytes. */
export function saveTranscript(sessionId: string, messages: ChatMessage[]): Promise<unknown> {
  return invoke<unknown>('save_transcript', { sessionId, messages });
}

export function deleteTranscript(sessionId: string): Promise<void> {
  return invoke('delete_transcript', { sessionId });
}
