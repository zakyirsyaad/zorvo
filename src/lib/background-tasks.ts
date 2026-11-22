import { runningTurnReplyIndexes } from './acp-events';
import type { ChatMessage, Session, ToolExecution } from '../types';

/** What a background row stands for. */
export type BackgroundTaskKind = 'agent' | 'shell' | 'subagent';

/** A shell process an agent started, as the backend reports it. */
export interface BackgroundProcess {
  pid: number;
  sessionId: string;
  command: string;
  elapsedSecs: number;
  ports: number[];
}

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  name: string;
  detail?: string;
  status: 'Working' | 'Needs approval' | 'Running';
  startedAt: number;
  sessionId: string;
  /** The OS process a shell task can be stopped through. */
  pid?: number;
}

export interface BackgroundTasksInput {
  sessions: readonly Session[];
  isBusy: (sessionId: string) => boolean;
  busySince: (sessionId: string) => number | undefined;
  needsApproval: (sessionId: string) => boolean;
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>;
  processes: readonly BackgroundProcess[];
  /** When `processes` was read; process start times are anchored to it. */
  processesReadAt: number;
}

/** Tool names an agent uses for a subagent run: Claude's Task/Agent, Qwen's agent. */
const SUBAGENT_TOOLS = new Set(['task', 'agent']);

/**
 * Whether a running tool is a subagent. Kind alone cannot say: Claude and Codex
 * report plain reasoning as `think` too, so the adapter's own tool name decides,
 * with a title that names the subagent as the fallback for older adapters.
 */
function isSubagent(tool: ToolExecution): boolean {
  const provider = tool.providerToolName?.toLowerCase();
  if (provider && SUBAGENT_TOOLS.has(provider)) return true;
  return /^(task|agent|subagent)\b/i.test(tool.name);
}

function toolKind(tool: ToolExecution): 'shell' | 'subagent' | undefined {
  if (isSubagent(tool)) return 'subagent';
  return tool.kind === 'execute' ? 'shell' : undefined;
}

/**
 * The running tool calls in each session's running turn. Every reply of the turn counts: an
 * answered permission request closes its reply, and a subagent it holds keeps working there. A
 * finished turn keeps a running tool in the transcript (`closeTurn` leaves it alone), so older
 * turns are not scanned. A command that outlives its turn shows through its process instead.
 */
export function runningToolTasks(
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>,
  sessions: readonly Session[],
): BackgroundTask[] {
  return sessions.flatMap((session) => {
    const messages = transcripts[session.id] ?? [];
    return runningTurnReplyIndexes(messages).reverse().flatMap((index) => toolTasksOf(session, messages[index]));
  });
}

function toolTasksOf(session: Session, message: ChatMessage): BackgroundTask[] {
  return (message.tools ?? []).flatMap((tool): BackgroundTask[] => {
    const kind = toolKind(tool);
    if (tool.status !== 'running' || !kind) return [];
    return [
      {
        id: `tool:${session.id}:${tool.id}`,
        kind,
        name: tool.name,
        detail: session.name,
        status: 'Running',
        startedAt: tool.startedAt ?? message.timestamp,
        sessionId: session.id,
      },
    ];
  });
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A tool's title and a process's command describe the same work when one contains the other. */
function namesSameWork(tool: BackgroundTask, process: BackgroundTask): boolean {
  const title = normalized(tool.name);
  const command = normalized(process.name);
  return title.includes(command) || command.includes(title);
}

/**
 * Drops the shell tool row for each process already listed, preferring the
 * process: it carries the ports and can be stopped. A process matches by
 * command first; a process with no command match claims a tool only when
 * exactly one unclaimed tool of its session started before it, so a second
 * running command is never hidden behind the first one. Subagent rows stand on
 * their own and are never claimed by a process.
 */
function dedupeToolTasks(
  tools: readonly BackgroundTask[],
  processes: readonly BackgroundTask[],
): BackgroundTask[] {
  const shells = tools.filter((tool) => tool.kind === 'shell');
  const newestFirst = [...shells].sort((a, b) => b.startedAt - a.startedAt);
  const claimed = new Set<string>();

  const unmatched: BackgroundTask[] = [];
  for (const process of processes) {
    const match = newestFirst.find(
      (tool) => !claimed.has(tool.id) && tool.sessionId === process.sessionId && namesSameWork(tool, process),
    );
    if (match) claimed.add(match.id);
    else unmatched.push(process);
  }

  for (const process of unmatched) {
    const candidates = shells.filter(
      (tool) => !claimed.has(tool.id) && tool.sessionId === process.sessionId && process.startedAt >= tool.startedAt,
    );
    if (candidates.length === 1) claimed.add(candidates[0].id);
  }

  return tools.filter((tool) => tool.kind !== 'shell' || !claimed.has(tool.id));
}

/** Everything running in the background, oldest first. */
export function backgroundTasksOf(input: BackgroundTasksInput): BackgroundTask[] {
  const { sessions, isBusy, busySince, needsApproval, transcripts, processes, processesReadAt } = input;
  const names = new Map(sessions.map((s) => [s.id, s.name]));

  const sessionTasks = sessions
    .filter((session) => isBusy(session.id))
    .map(
      (session): BackgroundTask => ({
        id: `agent:${session.id}`,
        kind: 'agent',
        name: session.name,
        status: needsApproval(session.id) ? 'Needs approval' : 'Working',
        startedAt: busySince(session.id) ?? session.createdAt,
        sessionId: session.id,
      }),
    );

  const processTasks = processes.map((process): BackgroundTask => {
    const sessionName = names.get(process.sessionId);
    const ports = process.ports.map((port) => `localhost:${port}`);
    const detail = [sessionName, ...ports].filter((part): part is string => Boolean(part)).join(' · ');
    return {
      id: `process:${process.pid}`,
      kind: 'shell',
      name: process.command,
      ...(detail ? { detail } : {}),
      status: 'Running',
      startedAt: processesReadAt - process.elapsedSecs * 1000,
      sessionId: process.sessionId,
      pid: process.pid,
    };
  });

  const toolTasks = dedupeToolTasks(runningToolTasks(transcripts, sessions), processTasks);

  return [...sessionTasks, ...processTasks, ...toolTasks].sort((a, b) => a.startedAt - b.startedAt);
}

const TOOL_TASK_PREFIX = 'tool:';

/** The tool call a tool row stands for, from its id (`tool:<session>:<tool>`). */
function toolIdOf(task: BackgroundTask): string | undefined {
  const prefix = `${TOOL_TASK_PREFIX}${task.sessionId}:`;
  return task.id.startsWith(prefix) ? task.id.slice(prefix.length) : undefined;
}

/** The scan cuts a long command and ends it with this, and so does a tool's recorded command. */
const CUT_MARK = '…';

/** True for `-c` and for combined flags that include it, like `-lc`. */
function runsScript(flag: string): boolean {
  return flag.startsWith('-') && !flag.startsWith('--') && flag.includes('c');
}

/** `text` without one pair of matching quotes around it. */
function unquoted(text: string): string {
  const quote = text[0];
  return text.length >= 2 && (quote === '"' || quote === "'") && text.endsWith(quote) ? text.slice(1, -1) : text;
}

/**
 * The script of an invocation with `-c` (`bash -lc "pnpm dev"` runs `pnpm dev`), exactly as the
 * process scan shows it (`display_command` in `background_processes.rs`): it takes the text after
 * the first flag that holds `c` whatever the program, so `python3 -c "…"` shows as its script too.
 * A command with no such flag stays as it is.
 */
function scriptOf(command: string): string {
  const words = command.split(' ');
  let index = 1;
  while (index < words.length && !runsScript(words[index])) index++;
  index++;
  while (index < words.length && (words[index] === '-l' || words[index] === '-i')) index++;
  const script = unquoted(words.slice(index).join(' ').trim());
  return script === '' ? command : script;
}

/** Whether two commands are one, either of them perhaps cut short with `…`. */
function sameCommand(a: string, b: string): boolean {
  const kept = (text: string) => text.slice(0, -CUT_MARK.length).trimEnd();
  if (a.endsWith(CUT_MARK)) return kept(a) !== '' && b.startsWith(kept(a));
  if (b.endsWith(CUT_MARK)) return kept(b) !== '' && a.startsWith(kept(b));
  return a === b;
}

/** The most words an interpreter may put before a program that replaced its shell (`/usr/bin/env python3`). */
const MAX_INTERPRETER_WORDS = 2;

/**
 * Whether a process's word is the program a launch named. A program named by an absolute path must
 * be that path, one named by a relative path must end with it, and a bare name matches the file
 * name, so two scripts of one name in different folders stay apart.
 */
function isSameProgram(word: string, program: string): boolean {
  if (program.startsWith('/')) return word === program;
  const path = program.replace(/^\.\//, '');
  if (path.includes('/')) return word === path || word.endsWith(`/${path}`);
  return (word.split('/').pop() ?? word) === path;
}

/**
 * Whether `command` is `launched` after its program replaced the shell under an interpreter:
 * `pnpm test:unit` shows as `node /app/pnpm test:unit`, `./serve.py` as `python3 /work/serve.py`.
 * The program must be the same file (`isSameProgram`) and every argument the same.
 */
function isExecOf(command: string, launched: string): boolean {
  const [program, ...args] = launched.split(' ');
  const words = command.split(' ');
  for (let index = 1; index <= MAX_INTERPRETER_WORDS && index < words.length; index++) {
    if (!isSameProgram(words[index], program)) continue;
    if (words.slice(index + 1).join(' ') === args.join(' ')) return true;
  }
  return false;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The command's words as the shell splits them: a space inside quotes or after a backslash does
 * not end a word. Each word keeps its quotes, so joining them gives the text back.
 */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: string | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      word += char + (command[index + 1] ?? '');
      index++;
    } else if (quote) {
      if (char === quote) quote = null;
      word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      word += char;
    } else if (/\s/.test(char)) {
      if (word !== '') words.push(word);
      word = '';
    } else {
      word += char;
    }
  }
  if (word !== '') words.push(word);
  return words;
}

/**
 * Programs that run the command after them and replace themselves with it, with the options of
 * each whose value is the next word: no process shows them or what they set.
 */
const WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['command', new Set<string>()],
  ['env', new Set(['-u', '-C', '-P', '-S', '--unset', '--chdir', '--split-string'])],
  ['exec', new Set(['-a'])],
  ['nohup', new Set<string>()],
  ['nice', new Set(['-n', '--adjustment'])],
  ['setsid', new Set<string>()],
]);

/**
 * The command without the variables it sets first (`PORT=3001 pnpm dev`) and without the wrappers
 * that run it (`nohup`, `nice -n 10`, `env -u TAG`, `exec`, `command -p`), however they are stacked.
 */
function withoutAssignments(command: string): string {
  const words = shellWords(command);
  let index = 0;
  const isLast = () => index >= words.length - 1;
  while (!isLast()) {
    if (ASSIGNMENT.test(words[index])) {
      index++;
      continue;
    }
    const valued = WRAPPERS.get(words[index].split('/').pop() ?? '');
    if (!valued) break;
    index++;
    while (!isLast()) {
      const word = words[index];
      if (valued.has(word)) index += 2;
      else if (ASSIGNMENT.test(word) || (word.startsWith('-') && word !== '-')) index++;
      else break;
    }
  }
  return words.slice(index).join(' ');
}

/** A redirection word: `>`, `2>&1`, `>>out.log`, `&>`, `<`; one with no target takes the next word. */
const REDIRECTION = /^(?:\d*>>?|&>>?|\d*<)(&\d+|.*)?$/;

/** The command without its redirections and a trailing `&`, which no process shows in its arguments. */
function withoutRedirections(command: string): string {
  // A redirection may touch the word before it (`/dev/null>/dev/null`): it ends that word all the same.
  const words = shellWords(command.replace(/(?<=[^\s\d&<>"'])(?=>|<)/g, ' '));
  const kept: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const match = REDIRECTION.exec(words[index]);
    if (!match) kept.push(words[index]);
    else if (!match[1]) index++;
  }
  if (kept[kept.length - 1] === '&') kept.pop();
  return kept.join(' ');
}

/** Words that open or close a compound command and run nothing themselves. */
const CONTROL_WORDS = /^(?:if|then|else|elif|fi|while|until|do|done|\{|\}|\(|\)|!)$/;

/**
 * Each command of a list (`cd /tmp && sleep 300`, `a || b`, `;`, one line after another), with the
 * words of a compound command around it gone (`if true; then exec sleep 300; fi`, `{ …; }`,
 * `( … )`): a shell may replace itself with any of them. An `exec` in front goes with the wrappers.
 */
const HEREDOC = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

/**
 * The command without the bodies of its heredocs (`cat <<EOF` … `EOF`): their text is data, so a
 * quote in it must not hide the commands after it. The line that opens one stays.
 */
function withoutHeredocBodies(command: string): string {
  const kept: string[] = [];
  const ends: { word: string; tabs: boolean }[] = [];
  for (const line of command.split('\n')) {
    if (ends.length > 0) {
      const end = ends[0];
      if ((end.tabs ? line.replace(/^\t+/, '') : line) === end.word) ends.shift();
      continue;
    }
    kept.push(line);
    for (const match of line.matchAll(HEREDOC)) ends.push({ word: match[3], tabs: match[1] === '-' });
  }
  return kept.join('\n');
}

/** The commands of a list, split on `&&`, `||`, `;` and line breaks that are not quoted or escaped. */
export function splitList(given: string): string[] {
  const command = withoutHeredocBodies(given);
  const parts: string[] = [];
  let part = '';
  let quote: string | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    const pair = command.slice(index, index + 2);
    if (char === '\\' && quote !== "'") {
      part += char + (command[index + 1] ?? '');
      index++;
    } else if (quote) {
      if (char === quote) quote = null;
      part += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      part += char;
    } else if (pair === '&&' || pair === '||') {
      parts.push(part);
      part = '';
      index++;
    } else if (char === ';' || char === '\n') {
      parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  parts.push(part);
  return parts.map((one) => one.trim());
}

function listCommands(command: string): string[] {
  return splitList(command)
    .map((part) => {
      const words = part.replace(/^\(+/, '').replace(/\)+$/, '').trim().split(' ');
      let index = 0;
      while (index < words.length && CONTROL_WORDS.test(words[index])) index++;
      return words.slice(index).join(' ');
    })
    .filter((part) => part !== '' && !CONTROL_WORDS.test(part));
}

/**
 * The texts a process the launch started may show as: the command as given (an agent's own wrapper
 * keeps it whole), each command of it when it is a list, any of them without its redirections, the
 * variables it sets first and the wrappers that run it, and the script of each when it runs one
 * with `-c`.
 */
function launchForms(command: string): string[] {
  const each = (forms: readonly string[], change: (form: string) => string) => [...forms, ...forms.map(change)];
  // The script first, so a list inside `bash -lc "cd x && pnpm dev"` yields its commands too.
  const scripts = each([command], scriptOf);
  const commands = [...scripts, ...scripts.flatMap(listCommands)];
  const forms = each(each(commands, withoutRedirections), withoutAssignments);
  return [...new Set(each(forms, scriptOf).map(normalized).filter((form) => form !== ''))];
}

/**
 * The command without its comments: an unquoted word that starts with `#`, to the end of its line.
 * A `#` inside quotes, escaped, or inside a word stays.
 */
function withoutComments(command: string): string {
  let out = '';
  let quote: string | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      out += char + (command[index + 1] ?? '');
      index++;
    } else if (quote) {
      if (char === quote) quote = null;
      out += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      out += char;
    } else if (char === '#' && (index === 0 || /\s/.test(command[index - 1]))) {
      const end = command.indexOf('\n', index);
      if (end < 0) break;
      index = end - 1;
    } else {
      out += char;
    }
  }
  return out;
}

/** Whether a launch ran `command`, the scan's text for a process. */
function launchedCommand(tool: ToolExecution, command: string): boolean {
  if (tool.kind !== 'execute') return false;
  // Lines stay apart until the forms are made: a line break separates commands as `;` does.
  // A launch whose input names no command is matched by its title, as a whole command.
  const given = (tool.command ?? tool.name).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  // An agent's own wrapper keeps the comments, a process that replaced its shell has none.
  const forms = new Set([...launchForms(given), ...launchForms(withoutComments(given).trim())]);
  return [...forms].some(
    (launched) => sameCommand(launched, command) || isExecOf(command, launched),
  );
}

/** The launch that started last, the one with no start time counting as earliest. */
function latest(tools: readonly ToolExecution[]): ToolExecution | undefined {
  return tools.reduce<ToolExecution | undefined>(
    (best, tool) => (best === undefined || (tool.startedAt ?? 0) >= (best.startedAt ?? 0) ? tool : best),
    undefined,
  );
}

/**
 * The tool call a shell task's output comes from: a tool row's own, or for a process the launch of
 * the same command that started last before it did. The scan's start for a process is never early
 * (it counts the process's age in whole seconds back from when the answer arrived), so a launch is
 * never announced after it; a launch that failed is taken only when no other is left, so a retry
 * that failed because the first still holds its port never takes the running process's output.
 * When no form matches whole, the one launch whose words hold the process's (or the other way
 * round) is taken; two such launches, or none, give no match.
 */
export function shellToolFor(task: BackgroundTask, messages: readonly ChatMessage[]): ToolExecution | undefined {
  const tools = messages.flatMap((message) => message.tools ?? []);
  const ownId = toolIdOf(task);
  if (ownId !== undefined) return tools.find((tool) => tool.id === ownId);
  const command = normalized(task.name);
  if (command === '') return undefined;
  const before = tools.filter((tool) => tool.kind === 'execute' && (tool.startedAt ?? 0) <= task.startedAt);
  const launches = before.filter((tool) => launchedCommand(tool, command));
  const found = latest(launches.filter((tool) => tool.status !== 'failed')) ?? latest(launches);
  if (found) return found;
  // No form matched whole: a shape the forms do not know. The one launch whose words hold the
  // process's (or the other way round) is taken; with two, nothing can tell them apart.
  const holders = before.filter((tool) => holdsWords(normalized(tool.command ?? tool.name), command));
  return holders.length === 1 ? holders[0] : undefined;
}

/** Whether either command's words hold the other's as a run of whole words. */
function holdsWords(a: string, b: string): boolean {
  const run = (outer: string[], inner: string[]) =>
    inner.length > 0 &&
    outer.some((_, start) => inner.every((word, offset) => outer[start + offset] === word));
  const wordsA = a.split(' ').filter((word) => word !== '');
  const wordsB = b.split(' ').filter((word) => word !== '');
  return run(wordsA, wordsB) || run(wordsB, wordsA);
}

/**
 * The shell task a tab was opened for. A command first shows as its running tool call and then as
 * its process, under another id, so a tab opened on the tool row follows it to the process.
 */
export function findShellTask(
  tasks: readonly BackgroundTask[],
  taskId: string,
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>,
): BackgroundTask | undefined {
  const shells = tasks.filter((task) => task.kind === 'shell');
  const exact = shells.find((task) => task.id === taskId);
  if (exact || !taskId.startsWith(TOOL_TASK_PREFIX)) return exact;
  return shells.find((task) => {
    const tool = task.pid === undefined ? undefined : shellToolFor(task, transcripts[task.sessionId] ?? []);
    return tool !== undefined && `${TOOL_TASK_PREFIX}${task.sessionId}:${tool.id}` === taskId;
  });
}

/**
 * The folders in front of a file name, at the start of the command or of an argument. `ps` does not
 * quote a path, so a space inside a folder name ("Application Support") cannot be told from the
 * space before the next argument: it is read as part of the name only before a capital letter or a
 * digit, which is how such folders are written and how an argument rarely starts.
 */
const LEADING_FOLDERS = /(^|\s)~?\/(?:(?:[^/\s]| (?=[A-Z0-9]))+\/)*(?=[^/\s])/g;

/**
 * A command as a row's title: each long path cut down to its file name, so the program and its
 * arguments show before the row runs out of room. The whole command stays in the task's tab.
 */
export function shortCommand(command: string): string {
  return command.replace(LEADING_FOLDERS, '$1');
}

const PORT_PART = /^localhost:\d+$/;

/** The `localhost:PORT` parts of a shell task's detail, which `backgroundTasksOf` writes. */
export function portsOf(task: BackgroundTask): string[] {
  return (task.detail ?? '').split(' · ').filter((part) => PORT_PART.test(part));
}

/** "45s", "2m 13s" or "1h 04m". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
