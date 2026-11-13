/**
 * Core type definitions for Zorvo GUI
 */

import type { AgentOptions } from '../lib/acp-draft';
import type { Appearance } from '../lib/appearance';

/** Mirrors the Rust `AgentProfile` (snake_case on the wire). */
export interface AgentProfile {
  id: string;
  name: string;
  command: string;
  detected: boolean;
  detected_path?: string | null;
  acp_program?: string | null;
  acp_args: string[];
  acp_program_path?: string | null;
  source: 'registry';
  version: string | null;
  distribution: 'npx' | 'uvx' | 'binary' | null;
  availability: AgentAvailability;
  /** What Install would do; null when the agent is ready. */
  install_plan: InstallStep[] | null;
  description: string | null;
  installed_on_system: boolean;
  listed: boolean;
}

export type AgentAvailability = 'ready' | 'needs_runtime' | 'not_installed';

/** One step of an agent's install plan, in the order the installer runs them. */
export interface InstallStep {
  kind: 'node' | 'uv' | 'agent' | 'prerequisite';
  /** "Node.js", "uv", the agent's name, or the prerequisite's command. */
  name: string;
  version: string;
  /** Known for runtimes only. */
  download_bytes: number | null;
}

export type CatalogStatus = 'by_zorvo' | 'on_your_mac' | 'ready' | 'not_installed' | 'unsupported' | 'waiting';

/** One registry agent as the catalog lists it, whether or not the user has it in use. */
export interface CatalogAgent {
  id: string;
  name: string;
  description: string | null;
  distribution: 'npx' | 'uvx' | 'binary';
  /** False once the registry dropped the agent. */
  listed: boolean;
  version: string | null;
  /** The newer version on offer, if any. */
  updateVersion: string | null;
  status: CatalogStatus;
  /** Unix seconds; set while a new version waits out its seven days. */
  availableFrom: number | null;
  /** Where a program installed outside Zorvo lives. */
  location: string | null;
}

/** Why Zorvo cannot offer an agent the registry lists. */
export type UnavailableReason = 'no_checksum' | 'invalid_entry';

/** An agent the registry lists but Zorvo cannot offer; it cannot be added or installed. */
export interface UnavailableAgent {
  id: string;
  name: string;
  description: string | null;
  reason: UnavailableReason;
}

export interface AgentCatalog {
  /** Unix seconds of the last registry fetch; null if it never succeeded. */
  lastChecked: number | null;
  agents: CatalogAgent[];
  /** Registry agents Zorvo cannot offer, not in `agents`. */
  unavailable: UnavailableAgent[];
}

export type AgentTransport = 'acp';

export const TRANSPORT_ACP: AgentTransport = 'acp';

/** A permission mode id; `"ask"` is the safe default. */
export type PermissionMode = string;

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'ask';

/** A project folder: `name` is shown in the UI, `path` is the absolute spawn cwd. */
export interface Workspace {
  name: string;
  path: string;
}

/** How much of an agent's context window is in use, in tokens. */
export interface ContextUsage {
  used: number;
  /** The window's size; 0 when the agent does not know it. */
  size: number;
  /** What the session has cost so far, when the agent reports it. */
  cost?: { amount: number; currency: string };
}

/** A git worktree a session runs in: its own checkout, on its own branch. */
export interface SessionWorktree {
  /** The workspace it was made from; the sidebar lists the session there. */
  repoPath: string;
  /** The worktree's root folder. */
  path: string;
  branch: string;
  /** The commit the worktree was made from; missing on worktrees saved before it was recorded. */
  startCommit?: string;
}

/** A delegated task: the session that delegated it, the task, and when it ran. */
export interface DelegationLink {
  /** A, the session that delegated. */
  sessionId: string;
  /** The task as the user typed it. */
  task: string;
  startedAt: number;
  /** Set by End delegation; no report is sent after it. */
  endedAt?: number | null;
}

export interface Session {
  id: string;
  name: string;
  profileId: string;
  cwd: string;
  status: 'running' | 'idle' | 'waiting_approval' | 'terminated';
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  createdAt: number;
  endedAt?: number | null;
  exitCode?: number | null;
  forkedFrom?: string | null;
  agentSessionId?: string | null;
  /** Always `acp` now; old files may hold other values. */
  transport?: string;
  acpSessionId?: string | null;
  /** Set when the session runs in a worktree; `cwd` is then inside it. */
  worktree?: SessionWorktree | null;
  /** Shown in the sidebar's Pinned section. */
  pinned?: boolean;
  /** When the session was archived: hidden from the session list until unarchived. */
  archivedAt?: number | null;
  /** The user renamed the session, so the agent's own titles no longer replace its name. */
  namedByUser?: boolean;
  /** The agent finished while the user was looking at another session. */
  hasUnread?: boolean;
  /** The session was imported where the agent kept it, so its earlier messages are not shown here. */
  historyElsewhere?: boolean;
  /** The compare run this session belongs to, when it was started from one. */
  compareRunId?: string | null;
  /** The session this one was delegated from; absent when the user started it themselves. */
  delegatedFrom?: DelegationLink | null;
  /** Comments written on lines of the session's diff; absent when there are none. */
  reviewComments?: ReviewComment[];
}

/** What a diff is compared with: the last commit, the base branch, or where the worktree started. */
export type ReviewTarget = 'head' | 'base' | 'start';

/** A comment on one line of a session's diff. A comment never moves: it is checked, not rebased. */
export interface ReviewComment {
  id: string;
  /** The path from the repository's root, as the diff lists it. */
  file: string;
  /** The path before a rename, for a comment on a removed line. */
  oldFile?: string;
  side: 'new' | 'old';
  /** Line number in that side's file, when the comment was written. */
  line: number;
  /** FNV-1a (32-bit, hex) of the row's raw text, so a long line needs no full copy. */
  lineHash: string;
  /** The line as written, cut to `MAX_QUOTE_LENGTH`. */
  quote: string;
  /** What the diff was compared with. A removed line's number depends on it. */
  target: ReviewTarget;
  body: string;
  createdAt: number;
  /** When a message holding this comment was sent. It says Send was pressed, not that the agent acted. */
  sentAt?: number;
}

export interface Settings {
  appearance: Appearance;
  defaultAgentId: string | null;
  onboardingCompleted: boolean;
  /** Agents the user switched on; undefined until they choose, when the defaults apply. */
  enabledAgents?: string[];
  /** Agents the user removed from the catalog. */
  removedAgents?: string[];
  /** The version last seen for each agent, by agent id. */
  agentVersions?: Record<string, string>;
  /** The update version already announced for each agent, by agent id. */
  notifiedUpdates?: Record<string, string>;
  /** Agents last seen signed in, by agent id: what lets the sidebar say Ready without asking again. */
  signedInAgents?: string[];
  /** Whether sessions are told about Zorvo's own tools. Off unless true; kept so a save does not drop it. */
  agentTools?: boolean;
}

export interface RecentFolder {
  name: string;
  path: string;
  lastOpenedAt: number;
}

/** Everything the backend store keeps in `state.json` (camelCase on the wire). */
export interface PersistedState {
  version: number;
  settings: Settings;
  recentFolders: RecentFolder[];
  sessions: Session[];
  /** What each ACP agent offered last, by profile id; missing in files from older builds. */
  agentOptions?: Record<string, AgentOptions>;
}

export interface ActionCard {
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  commandSnippet?: string;
  toolName?: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: number;
  /** ACP permission requests: the agent's own choices and the request to answer. */
  options?: PermissionChoice[];
  requestId?: string | number;
  /** The option the user picked, once answered. */
  chosenOptionId?: string;
  /** The mode changed after the agent asked; the card still needs its answer. */
  modeChanged?: boolean;
  /**
   * The files an edit would change, with its lines, from the request's diffs. A diff too large
   * to keep has no counts. Absent when the request carries none, and in transcripts saved
   * before it existed.
   */
  edits?: { path: string; added?: number; removed?: number }[];
  /**
   * Qwen Code's `ask_user_question`: the questions the agent asks, shown as a form.
   * Only the agent's own text; what the user types is never kept on the card.
   */
  questions?: UserQuestion[];
}

/** One question of Qwen Code's `ask_user_question`. */
export interface UserQuestion {
  question: string;
  /** A short label for the question. */
  header: string;
  options: UserQuestionOption[];
  multiSelect: boolean;
}

export interface UserQuestionOption {
  label: string;
  description?: string;
}

/** A command an agent offers, typed as `/name` in the prompt. */
export interface SlashCommand {
  name: string;
  description: string;
  /** What to type after the command, when it takes input. */
  hint?: string;
}

export interface PermissionChoice {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export interface ToolExecution {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  /** ACP tool kind, e.g. "read", "edit", "execute". */
  kind?: string;
  /** The tool's own name in its agent (e.g. Claude's "Task"), when the adapter reports one. */
  providerToolName?: string;
  /** When the agent announced the tool, in ms. */
  startedAt?: number;
  /** What the tool produced: diffs of files it changed and text output. */
  details?: ToolDetail[];
  /** Files it touched, as "path" or "path:line". */
  locations?: string[];
  /** The command it runs, when the agent gives one in its input. */
  command?: string;
}

export type DiffRowKind = 'added' | 'removed' | 'context' | 'skipped';

export interface DiffRow {
  kind: DiffRowKind;
  /** The line, or for `skipped` how many unchanged lines were folded. */
  text: string;
}

export type ToolDetail =
  | { kind: 'text'; text: string }
  /**
   * The rows a diff shows (changed lines, 3 lines of context, folded runs), worked out once when the
   * agent sends it. ACP sends the whole file before and after every edit, so keeping those made a long
   * session's transcript tens of megabytes, and the page froze each time it was saved.
   */
  | { kind: 'diff'; path: string; isNewFile: boolean; rows: DiffRow[] }
  /** A diff too large to keep: the file stays named. */
  | { kind: 'changed'; path: string };

/** One stretch of a reply, kept in the order the agent produced it. */
export type ChatMessagePart =
  | { kind: 'text'; text: string }
  /** Consecutive tool calls share one part. */
  | { kind: 'tools'; toolIds: string[] };

/** One step of an agent's plan, as reported over ACP. */
export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  /** False for a message replayed from the agent's history, which gives no per-message time. */
  hasKnownTime?: boolean;
  tools?: ToolExecution[];
  /** The reply's text and tool calls in the order the agent produced them; absent in older transcripts. */
  parts?: ChatMessagePart[];
  actionCard?: ActionCard;
  /** The agent's visible reasoning for this reply, when it streams any. */
  thinking?: string;
  plan?: PlanEntry[];
  /** Set when the agent's turn ended; the next reply starts a new message. */
  isComplete?: boolean;
  /** When the turn ended, for a reply whose time is known; `timestamp` is when the reply began. */
  completedAt?: number;
  /** Files the user sent with the message (ACP agents). */
  attachments?: string[];
  /** The agent's `messageId` for a user message replayed by `session/load`; its chunks share it. */
  replayId?: string;
  /** A report from a delegated session in A's transcript; the chat labels it From <agent>. */
  delegationReport?: { agentName: string; agentId?: string };
  /** On the user message that carries a task into a delegate: the agent of the session that gave it. */
  delegationTask?: { agentName: string; agentId?: string };
  /** A question the agent asked the user (ACP elicitation); never holds the answer. */
  elicitation?: ElicitationCard;
}

export interface ElicitationChoice {
  value: string;
  title: string;
  description?: string;
}

export type ElicitationFieldKind =
  | { type: 'text'; format?: string; minLength?: number; maxLength?: number }
  | { type: 'number'; integer: boolean; minimum?: number; maximum?: number }
  | { type: 'boolean' }
  | { type: 'select'; options: ElicitationChoice[] }
  | { type: 'multiSelect'; options: ElicitationChoice[]; minItems?: number; maxItems?: number }
  | { type: 'unsupported'; rawType: string };

export interface ElicitationField {
  name: string;
  title?: string;
  description?: string;
  required: boolean;
  kind: ElicitationFieldKind;
  default?: unknown;
}

export type ElicitationStatus =
  | 'pending'
  | 'submitted'
  | 'declined'
  | 'dismissed'
  | 'opened'
  | 'completed'
  | 'unanswered';

/** What the user answered; sent to the agent and never stored in the transcript. */
export type ElicitationAnswer =
  | { action: 'accept'; content?: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' };

/** An agent's question in the transcript. Once answered it keeps no fields, url or typed values. */
export interface ElicitationCard {
  key: string;
  sessionId: string;
  mode: 'form' | 'url';
  message: string;
  status: ElicitationStatus;
  timestamp: number;
  fields?: ElicitationField[];
  url?: string;
  host?: string;
  warnings?: ('punycode' | 'ip-address' | 'user-info')[];
  blocked?: string;
  /** Field errors from the last refused submit, by field name. */
  errors?: Record<string, string>;
}
