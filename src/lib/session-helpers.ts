import type { ActionCard, ChatMessage, PersistedState, Session, Workspace } from '../types';
import { createId } from './ids';
import type { CompareRun } from './compare-run';

/** Id of the most recently created session, or "" when there is none. */
export function mostRecentSessionId(sessions: readonly Session[]): string {
  return sessions.reduce<Session | null>(
    (latest, s) => (latest === null || s.createdAt > latest.createdAt ? s : latest),
    null,
  )?.id ?? '';
}

const SESSION_NUMBER = /^Session #(\d+)/;

/** "Session #N" with N above every number in use, so a name never repeats after a delete. */
export function nextSessionName(sessions: readonly Pick<Session, 'name'>[]): string {
  const highest = sessions.reduce((max, s) => Math.max(max, Number(SESSION_NUMBER.exec(s.name)?.[1] ?? 0)), 0);
  return `Session #${highest + 1}`;
}

const MAX_TITLE_LENGTH = 60;
const AUTO_NAME = /^Session #\d+$/;

/** True for a numbered placeholder name, which the first message replaces. */
export function isAutoName(name: string): boolean {
  return AUTO_NAME.test(name);
}

/** The rest of a link after the part a title keeps, without the punctuation that ends a sentence. */
const LINK_REST = String.raw`(?:[^\s"'<>]*[^\s"'<>.,;:!?)])?`;
/**
 * `github.com/<owner>/<repo>`, with or without a scheme, but not inside another host (`api.github.com`);
 * a repository's dots sit between word characters.
 */
const GITHUB_LINK = new RegExp(
  String.raw`(?<![\w.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([\w-]+(?:\.[\w-]+)*)\/([\w-]+(?:\.[\w-]+)*)` + LINK_REST,
  'gi',
);
/** Any other web link: its host, without a user name, `www.` or a port. */
const WEB_LINK = new RegExp(
  String.raw`\bhttps?:\/\/(?:[^\s\/?#@"'<>]*@)?(?:www\.)?([^\s\/?#:@"'<>]+)(?::\d+)?` + LINK_REST,
  'gi',
);
/** A markdown link to the web: its own text says what it is. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((?:https?:\/\/|(?:www\.)?github\.com\/)[^)\s]*\)/gi;
/**
 * A Mac path in quotes or backticks, which may hold spaces ("Application Support"). The closing mark must
 * end a word, so an apostrophe inside a later word ("isn't") never closes it.
 */
const QUOTED_PATH = /(["'`])((?:~\/|\/)[^"'`\n]+)\1(?!\w)/g;
/** A Mac path as one word, from the start of the line or after a space or an opening bracket. */
const BARE_PATH = /(^|[\s([])((?:~\/|\/)[^\s"'`]+?)(?=[.,;:!?)\]]*(?:\s|$))/g;

/** A path's last two parts when it has more than two, else the path as written. */
function lastTwoParts(path: string): string {
  const parts = path.split('/').filter((part) => part !== '' && part !== '~');
  return parts.length > 2 ? parts.slice(-2).join('/') : path;
}

/** Links and long paths shortened to the part a reader knows them by. */
function tidied(line: string): string {
  return line
    .replace(MARKDOWN_LINK, (_, text: string) => text)
    .replace(GITHUB_LINK, (_, owner: string, repo: string) => `${owner}/${repo.replace(/\.git$/i, '')}`)
    .replace(WEB_LINK, (_, host: string) => host)
    .replace(QUOTED_PATH, (whole, _quote: string, path: string) => {
      const short = lastTwoParts(path);
      return short === path ? whole : short;
    })
    .replace(BARE_PATH, (_, before: string, path: string) => `${before}${lastTwoParts(path)}`);
}

/**
 * The first `count` characters of `text`, counted as code points: a cut by UTF-16 units can split an emoji
 * into a lone surrogate, which serde_json refuses, and the whole state would then fail to save.
 */
export function firstChars(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

/** A message's first line with its white space collapsed: what a title is made from. */
function firstLineOf(text: string): string {
  return text.trim().split('\n')[0].replace(/\s+/g, ' ').trim();
}

/** True when a message is only a slash command (`/init`, `/review src`), which says nothing a title could use. */
export function isCommandOnly(text: string): boolean {
  return /^\/[\w:-]+(?:[ \t][^\n]*)?$/.test(text.trim());
}

/**
 * A session title from the user's prompt: its first line, with a GitHub link as `owner/repo`, any other
 * link as its site and a long path as its last two parts, cut at a word boundary.
 */
export function titleFromPrompt(prompt: string): string {
  const firstLine = tidied(firstLineOf(prompt));
  if (!firstLine) return 'New session';
  if (Array.from(firstLine).length <= MAX_TITLE_LENGTH) return firstLine;
  const cut = firstChars(firstLine, MAX_TITLE_LENGTH + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : firstChars(firstLine, MAX_TITLE_LENGTH)).trimEnd()}…`;
}

/** A title's whole line can be long; the hover keeps this much of it. */
const MAX_TITLE_SOURCE = 500;

/** The whole first line a title was made from, for its hover, when the title shortened it. */
export function titleSourceFor(text: string, title: string): string | undefined {
  const line = firstChars(firstLineOf(text), MAX_TITLE_SOURCE);
  return line !== '' && line !== title ? line : undefined;
}

export function patchSessionIn(
  state: PersistedState,
  sessionId: string,
  patch: Partial<Session>,
): PersistedState {
  return {
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
  };
}

export function removeSessionFrom(state: PersistedState, sessionId: string): PersistedState {
  return { ...state, sessions: state.sessions.filter((s) => s.id !== sessionId) };
}

/**
 * A session with the sessions it began (a fork or a delegated task), newest first. A compare
 * run is one node with `run` set: its `children` are the run's sessions (oldest first, each
 * with its own forks), and `session` is the newest of them, which places the group in the list.
 */
export interface SessionNode {
  session: Session;
  children: SessionNode[];
  run?: CompareRun;
}

export interface SessionGroup {
  path: string;
  name: string;
  sessions: SessionNode[];
}

/** Last path segment, e.g. "/Users/a/project/" -> "project". */
export function folderNameOf(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

const newestFirst = (a: Session, b: Session) => b.createdAt - a.createdAt;

/** Archived: hidden from the list, shown only in its Archived section. */
export function isArchived(session: Session): boolean {
  return Boolean(session.archivedAt);
}

/** Shown in the session list (pinned or in its workspace): not archived. */
export function isListed(session: Session): boolean {
  return !isArchived(session);
}

/** Shown in the Pinned section: pinned and not archived. An archived session keeps its pin for later. */
export function isShownPinned(session: Session): boolean {
  return Boolean(session.pinned) && !isArchived(session);
}

/** The workspace a session belongs to: the one its worktree was made from, or its folder. */
export function workspacePathOf(session: Session): string {
  return session.worktree?.repoPath ?? session.cwd;
}

/**
 * One folder's sessions as a tree: a fork or a delegated session sits under its source when that
 * is in the same folder, and each run (its sessions in this folder) is one group node placed by
 * its newest session.
 */
function forkTree(sessions: readonly Session[], runs: readonly CompareRun[] = []): SessionNode[] {
  const ids = new Set(sessions.map((s) => s.id));
  const runOfMember = new Map<string, CompareRun>();
  for (const run of runs) {
    const members = run.sessions.filter((s) => ids.has(s.id));
    if (members.length < 2) continue;
    const inFolder = { ...run, sessions: members };
    for (const member of members) runOfMember.set(member.id, inFolder);
  }
  const childrenOf = new Map<string, Session[]>();
  const roots: Array<Session | CompareRun> = [];
  const placedRuns = new Set<string>();
  for (const session of [...sessions].sort(newestFirst)) {
    const run = runOfMember.get(session.id);
    if (run) {
      // A run's sessions are never nested under a fork source: they sit in their group.
      if (!placedRuns.has(run.id)) roots.push(run);
      placedRuns.add(run.id);
      continue;
    }
    // A delegated session sits under its source the way a fork does.
    const parent = session.forkedFrom ?? session.delegatedFrom?.sessionId;
    if (parent && parent !== session.id && ids.has(parent)) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), session]);
    } else {
      roots.push(session);
    }
  }
  const seen = new Set<string>();
  const toNode = (session: Session): SessionNode => {
    seen.add(session.id);
    const children = (childrenOf.get(session.id) ?? []).filter((c) => !seen.has(c.id));
    return { session, children: children.map(toNode) };
  };
  const toGroup = (run: CompareRun): SessionNode => ({
    session: run.sessions[run.sessions.length - 1],
    children: run.sessions.map(toNode),
    run,
  });
  const tree = roots.map((root) => ('sessions' in root ? toGroup(root) : toNode(root)));
  // Sessions forked from each other in a loop (only a hand-edited file has
  // that) are reached from no root; each loop is listed from its newest one.
  for (const session of [...sessions].sort(newestFirst)) {
    if (!seen.has(session.id) && !runOfMember.has(session.id)) tree.push(toNode(session));
  }
  return tree;
}

/**
 * The sidebar's tree: every workspace in the given order, each with its
 * sessions newest first and forks nested under their source. Folders that
 * only sessions still point at (a folder removed from the recents) follow,
 * the one with the newest session first. Each of `runs` with two or more
 * sessions in a folder is one group there.
 */
export function groupSessionsByWorkspace(
  workspaces: readonly Workspace[],
  sessions: readonly Session[],
  runs: readonly CompareRun[] = [],
): SessionGroup[] {
  const byPath = new Map<string, Session[]>();
  const newestIn = new Map<string, number>();
  for (const session of sessions) {
    const path = workspacePathOf(session);
    const list = byPath.get(path);
    if (list) list.push(session);
    else byPath.set(path, [session]);
    newestIn.set(path, Math.max(newestIn.get(path) ?? -Infinity, session.createdAt));
  }
  const known = new Set(workspaces.map((ws) => ws.path));
  const others = [...byPath.keys()]
    .filter((path) => !known.has(path))
    .sort((a, b) => (newestIn.get(b) ?? 0) - (newestIn.get(a) ?? 0))
    .map((path) => ({ name: folderNameOf(path), path }));
  return [...workspaces, ...others].map(({ name, path }) => ({
    path,
    name,
    sessions: forkTree(byPath.get(path) ?? [], runs),
  }));
}

/** A chat message the user typed, with the files they attached. */
export function userMessage(content: string, attachments: readonly string[] = []): ChatMessage {
  const message: ChatMessage = { id: createId('msg'), role: 'user', content, timestamp: Date.now() };
  return attachments.length > 0 ? { ...message, attachments: [...attachments] } : message;
}

/** Drops one message by id, e.g. a user message whose send failed. */
export function withoutMessage(messages: readonly ChatMessage[], messageId: string): ChatMessage[] {
  return messages.filter((m) => m.id !== messageId);
}

export function findCard(messages: readonly ChatMessage[] | undefined, cardId: string): ActionCard | undefined {
  return messages?.find((m) => m.actionCard?.id === cardId)?.actionCard;
}
