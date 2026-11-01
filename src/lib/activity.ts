import type { ActionCard, ChatMessage, ToolExecution } from '../types';
import type { DiffTargets, FileStat } from './diff-stats';

interface EntryBase {
  messageId: string;
  /** Null for a replayed history, which gives no per-message time. */
  time: number | null;
}

export type ActivityEntry = EntryBase &
  (
    | { kind: 'file'; path: string; action: 'read' | 'changed' | 'touched'; status: ToolExecution['status'] }
    | { kind: 'command'; command: string; status: ToolExecution['status'] }
    | {
        kind: 'permission';
        prompt: string;
        command?: string;
        answer: 'waiting' | 'allowed' | 'rejected' | 'unanswered';
        choice?: string;
      }
  );

export interface ActivityList {
  entries: ActivityEntry[];
  /** Tools that named no file and ran no command: the list says they exist. */
  otherTools: number;
}

const CHANGING_KINDS = new Set(['edit', 'delete', 'move']);
const READING_KINDS = new Set(['read', 'search']);

/** What the tool was for, not what happened: the row's status says that. */
function actionOf(tool: ToolExecution): 'read' | 'changed' | 'touched' {
  if (CHANGING_KINDS.has(tool.kind ?? '')) return 'changed';
  if (tool.details?.some((detail) => detail.kind === 'diff' || detail.kind === 'changed')) return 'changed';
  return READING_KINDS.has(tool.kind ?? '') ? 'read' : 'touched';
}

const withoutLine = (location: string) => location.replace(/:\d+$/, '');

function pathsOf(tool: ToolExecution): string[] {
  const named = tool.details?.flatMap((detail) => (detail.kind === 'text' ? [] : [detail.path])) ?? [];
  return [...new Set([...(tool.locations ?? []).map(withoutLine), ...named])];
}

function entriesOfTool(tool: ToolExecution, message: ChatMessage): ActivityEntry[] {
  const base = {
    messageId: message.id,
    time: message.hasKnownTime === false ? null : (tool.startedAt ?? message.timestamp),
  };
  const isCommand = tool.kind === 'execute';
  const command: ActivityEntry[] = isCommand
    ? [{ ...base, kind: 'command', command: typeof tool.command === 'string' ? tool.command : tool.name, status: tool.status }]
    : [];
  const action = actionOf(tool);
  const paths = pathsOf(tool);
  // A change that names no file is still a change: it must not vanish from the list.
  const named = paths.length === 0 && CHANGING_KINDS.has(tool.kind ?? '') ? [tool.name] : paths;
  const files = named.map((path): ActivityEntry => ({ ...base, kind: 'file', path, action, status: tool.status }));
  return [...command, ...files];
}

function answerOf(card: ActionCard): Extract<ActivityEntry, { kind: 'permission' }>['answer'] {
  if (card.status === 'pending') return 'waiting';
  if (card.status === 'approved') return 'allowed';
  // A card closed at a turn's end is rejected with no option chosen.
  return card.chosenOptionId === undefined ? 'unanswered' : 'rejected';
}

function entryOfCard(card: ActionCard, message: ChatMessage): ActivityEntry {
  return {
    messageId: message.id,
    time: message.hasKnownTime === false ? null : card.timestamp,
    kind: 'permission',
    prompt: card.prompt,
    command: card.commandSnippet,
    answer: answerOf(card),
    choice: card.options?.find((option) => option.optionId === card.chosenOptionId)?.name,
  };
}

// An agent's updates arrive per frame, and an unchanged message keeps its identity.
const perMessage = new WeakMap<ChatMessage, ActivityList>();

function activityOfMessage(message: ChatMessage): ActivityList {
  const known = perMessage.get(message);
  if (known) return known;
  const fromTools = (message.tools ?? []).map((tool) => entriesOfTool(tool, message));
  const list: ActivityList = {
    entries: [...fromTools.flat(), ...(message.actionCard ? [entryOfCard(message.actionCard, message)] : [])],
    otherTools: fromTools.filter((entries) => entries.length === 0).length,
  };
  perMessage.set(message, list);
  return list;
}

/** What the transcript says the agent did, in message order. It is the agent's own report. */
export function activityOf(messages: readonly ChatMessage[]): ActivityList {
  const lists = messages.map(activityOfMessage);
  return {
    entries: lists.flatMap((list) => list.entries),
    otherTools: lists.reduce((total, list) => total + list.otherTools, 0),
  };
}

const under = (path: string, folder: string) => {
  const base = folder.replace(/\/+$/, '');
  return base !== '' && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
};

/** A reported path from the repository's root, or null outside it. `root` is canonical and `cwd` may not be. */
export function reportedPath(path: string, cwd: string, targets: Pick<DiffTargets, 'root' | 'prefix'>): string | null {
  if (!path.startsWith('/')) {
    const relative = path.replace(/^(\.\/)+/, '');
    return relative.split('/').includes('..') ? null : `${targets.prefix}${relative}`;
  }
  const inCwd = under(path, cwd);
  return inCwd !== null ? `${targets.prefix}${inCwd}` : under(path, targets.root);
}

/** Files git shows as changed that the agent did not report changing. Reading a file does not report changing it. */
export function unreportedFiles(
  entries: readonly ActivityEntry[],
  stats: readonly FileStat[],
  targets: Pick<DiffTargets, 'root' | 'prefix'>,
  cwd: string,
): string[] {
  const reported = new Set(
    entries.flatMap((entry) => {
      if (entry.kind !== 'file' || entry.status !== 'completed' || entry.action === 'read') return [];
      const path = reportedPath(entry.path, cwd, targets);
      return path === null ? [] : [path];
    }),
  );
  return stats
    .filter((stat) => !reported.has(stat.path) && !(stat.oldPath !== null && reported.has(stat.oldPath)))
    .map((stat) => stat.path);
}

const ANSWER_WORDS = { waiting: 'Waiting for you', allowed: 'Allowed', rejected: 'Rejected', unanswered: 'Not answered' };
const ACTION_WORDS = { read: 'Read', changed: 'Changed', touched: 'Touched' };

/** What a row may claim: an action only for a tool that finished. A kept `running` tool may have ended unseen. */
export function statusWord(entry: ActivityEntry, isBusy: boolean): string {
  if (entry.kind === 'permission') return ANSWER_WORDS[entry.answer];
  if (entry.status === 'failed') return 'Failed';
  if (entry.status === 'running') return isBusy ? 'Running' : 'Did not finish';
  return entry.kind === 'file' ? ACTION_WORDS[entry.action] : 'Done';
}
