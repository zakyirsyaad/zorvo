import type { AgentWork, ChatMessage, ToolExecution } from '../types';
import { shellWords, splitList } from './background-tasks';

/** How many branches and pull request addresses a session keeps, the newest ones. */
export const MAX_AGENT_WORK_ITEMS = 10;

/** A branch name git would take; `HEAD` and option-like words are not branches. */
const BRANCH = /^(?!-)(?!HEAD$)[A-Za-z0-9._/-]{1,200}$/;

/** A pull request's address on github.com, as `gh pr create` prints it. */
const PULL_REQUEST_URL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g;

const EMPTY: AgentWork = { branches: [], pullRequestUrls: [] };

/** The word without the quotes around it, as the shell reads it. */
function unquoted(word: string): string {
  return word.replace(/^(['"])(.*)\1$/, '$2');
}

/** A redirection word (`2>&1`, `>out.log`, `<in`); one with no target takes the next word. */
const REDIRECTION = /^(?:\d*>>?|&>>?|\d*<)(&\d+|.+)?$/;

/** The words of one command as the program sees them: up to a pipe, with no redirections or quotes. */
function commandWords(part: string): string[] {
  const words = shellWords(part);
  const pipe = words.findIndex((word) => word === '|' || word === '|&');
  const command = pipe < 0 ? words : words.slice(0, pipe);
  const kept: string[] = [];
  for (let index = 0; index < command.length; index++) {
    const redirection = REDIRECTION.exec(command[index]);
    if (!redirection) kept.push(unquoted(command[index]));
    else if (redirection[1] === undefined) index++;
  }
  return kept;
}

/** The words after `git` and its own options (`-C <dir>`, `-c <key=value>`), or null for another program. */
function gitArgs(words: readonly string[]): string[] | null {
  if (words[0] !== 'git' && !words[0]?.endsWith('/git')) return null;
  let index = 1;
  while (words[index] === '-C' || words[index] === '-c') index += 2;
  return words.slice(index);
}

/** The value of the first of `flags` in `args`: the next word, or the text after `=` for a long flag. */
function flagValue(args: readonly string[], flags: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (flags.includes(arg)) return args[index + 1];
    const long = flags.find((flag) => flag.startsWith('--') && arg.startsWith(`${flag}=`));
    if (long) return arg.slice(long.length + 1);
  }
  return undefined;
}

/** The branch a `git push -u` set up: its last refspec, the part after `:` when it names two. */
function pushedBranch(args: readonly string[]): string | undefined {
  if (!args.some((arg) => arg === '-u' || arg === '--set-upstream')) return undefined;
  const positional = args.slice(1).filter((arg) => !arg.startsWith('-'));
  const refspec = positional.length > 1 ? positional[positional.length - 1] : undefined;
  return refspec?.split(':').pop()?.replace(/^\+/, '').replace(/^refs\/heads\//, '');
}

/** The branch one command made or published: a new worktree's or checkout's branch, a push's, a pull request's head. */
function branchOf(words: readonly string[]): string | undefined {
  if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create') return flagValue(words, ['--head', '-H']);
  const args = gitArgs(words);
  if (!args) return undefined;
  if (args[0] === 'worktree' && args[1] === 'add') return flagValue(args, ['-b', '-B']);
  if (args[0] === 'checkout') return flagValue(args, ['-b', '-B']);
  if (args[0] === 'switch') return flagValue(args, ['-c', '-C', '--create', '--force-create']);
  if (args[0] === 'push') return pushedBranch(args);
  return undefined;
}

/** The text a tool printed. */
function outputOf(tool: ToolExecution): string {
  return (tool.details ?? [])
    .flatMap((detail) => (detail.kind === 'text' ? [detail.text] : []))
    .join('\n');
}

/** Shells whose `-c` script holds the commands an agent wrapped (`bash -lc "gh pr create …"`). */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

/** How deep shell scripts inside shell scripts are opened. */
const MAX_SCRIPT_DEPTH = 3;

/** The words of every command in `text`, a shell's `-c` script opened into its own commands. */
function commandsIn(text: string, depth = 0): string[][] {
  return splitList(text).flatMap((part) => {
    const words = commandWords(part);
    const isShell = SHELLS.has(words[0]?.split('/').pop() ?? '');
    const flag = isShell ? words.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word)) : -1;
    const script = flag > 0 ? words[flag + 1] : undefined;
    return script && depth < MAX_SCRIPT_DEPTH ? commandsIn(script, depth + 1) : [words];
  });
}

/** What one finished shell command made: the branches it named and, for `gh pr create`, the address it printed. */
function workOfTool(tool: ToolExecution): AgentWork {
  if (tool.status !== 'completed' || tool.kind !== 'execute') return EMPTY;
  // Antigravity sends no input and puts the command in the tool's title.
  const command = tool.command ?? tool.name;
  if (!command) return EMPTY;
  const commands = commandsIn(command);
  const branches = commands.flatMap((words) => {
    const branch = branchOf(words);
    return branch && BRANCH.test(branch) ? [branch] : [];
  });
  const createsPullRequest = commands.some((words) => words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create');
  const pullRequestUrls = createsPullRequest ? [...outputOf(tool).matchAll(PULL_REQUEST_URL)].map((match) => match[0]) : [];
  return { branches, pullRequestUrls };
}

/** The values in order, each kept at its last place, the newest `MAX_AGENT_WORK_ITEMS` of them. */
function newestUnique(values: readonly string[]): string[] {
  const kept = values.filter((value, index) => values.lastIndexOf(value) === index);
  return kept.slice(-MAX_AGENT_WORK_ITEMS);
}

const byMessage = new WeakMap<ChatMessage, AgentWork>();

/** One message's work, worked out once: a streamed reply makes a new message object, so old ones stay cached. */
function workOfMessage(message: ChatMessage): AgentWork {
  const cached = byMessage.get(message);
  if (cached) return cached;
  const parts = (message.tools ?? []).map(workOfTool);
  const work = {
    branches: parts.flatMap((part) => part.branches),
    pullRequestUrls: parts.flatMap((part) => part.pullRequestUrls),
  };
  byMessage.set(message, work);
  return work;
}

/**
 * The branches and pull requests an agent made in a session, oldest first, read from the shell
 * commands it reported finishing. Agents often work in a worktree of their own inside the session's
 * folder, a branch Zorvo did not make and cannot see from the folder's checkout.
 */
export function agentWorkOf(messages: readonly ChatMessage[]): AgentWork {
  const parts = messages.map(workOfMessage);
  return {
    branches: newestUnique(parts.flatMap((part) => part.branches)),
    pullRequestUrls: newestUnique(parts.flatMap((part) => part.pullRequestUrls)),
  };
}

/**
 * The saved record with what the transcript holds now added after it. Nothing is taken away: a
 * rewind removes the messages, not the branch or the pull request the agent made.
 */
export function mergedAgentWork(saved: AgentWork | undefined, found: AgentWork): AgentWork | undefined {
  // A value already saved keeps its place: after a rewind the transcript holds only older work,
  // which must not move ahead of, or push out, what was made after it.
  const added = (kept: readonly string[], seen: readonly string[]) =>
    [...kept, ...seen.filter((value) => !kept.includes(value))].slice(-MAX_AGENT_WORK_ITEMS);
  const branches = added(saved?.branches ?? [], found.branches);
  const pullRequestUrls = added(saved?.pullRequestUrls ?? [], found.pullRequestUrls);
  return branches.length > 0 || pullRequestUrls.length > 0 ? { branches, pullRequestUrls } : undefined;
}

/** Whether two records hold the same values in the same order. */
export function isSameAgentWork(a: AgentWork | undefined, b: AgentWork | undefined): boolean {
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((value, index) => value === y[index]);
  return same(a?.branches ?? [], b?.branches ?? []) && same(a?.pullRequestUrls ?? [], b?.pullRequestUrls ?? []);
}

/** A saved record with only valid values, or undefined when nothing valid is left. */
export function validAgentWork(value: unknown): AgentWork | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const strings = (list: unknown, valid: (text: string) => boolean) =>
    Array.isArray(list) ? newestUnique(list.filter((item): item is string => typeof item === 'string' && valid(item))) : [];
  const branches = strings(record.branches, (text) => BRANCH.test(text));
  const pullRequestUrls = strings(record.pullRequestUrls, (text) => new RegExp(`^${PULL_REQUEST_URL.source}$`).test(text));
  return branches.length > 0 || pullRequestUrls.length > 0 ? { branches, pullRequestUrls } : undefined;
}
