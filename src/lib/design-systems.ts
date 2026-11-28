import { codeSpan } from './artifact-comments';
import { escapeVisible } from './visible-text';
import guide from './design-system-guide.md?raw';
import type { DesignSystemRead } from './design-system-read';

/**
 * A project's design systems, as `design_systems_list` finds them in a session's folder, and
 * the line every design guide ends with. Design:
 * `docs/superpowers/specs/2026-11-26-design-system-design.md`.
 */

/** A token `tokens.json` holds that Zorvo could not read, and why. */
export interface DroppedToken {
  family: string;
  name: string;
  reason: string;
}

export interface FoundSystem {
  key: string;
  /** The folder relative to the session's folder; `.` for the session's folder itself. */
  relative: string;
  title: string;
  isDefault: boolean;
  dropped: DroppedToken[];
}

/** Why several systems have no default. */
export type DefaultProblem = { kind: 'severalMarked' | 'noneMarked'; relatives: string[] };

export interface SystemList {
  systems: FoundSystem[];
  defaultProblem: DefaultProblem | null;
}

export const SEARCH_SCOPE = 'Zorvo looks only in this folder and below it, never above it.';

/** A system's key: derived from its folder by the backend. */
export const DS_KEY = /^d-[0-9a-f]{16}$/;

/** How many dropped tokens a line names before it only counts the rest. */
const MAX_DROPPED_NAMED = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseDropped(value: unknown): DroppedToken | null {
  if (!isRecord(value)) return null;
  const { family, name, reason } = value;
  if (typeof family !== 'string' || typeof name !== 'string' || typeof reason !== 'string') return null;
  return { family, name, reason };
}

function parseFound(value: unknown): FoundSystem | null {
  if (!isRecord(value)) return null;
  const { key, relative, title, isDefault, dropped } = value;
  if (typeof key !== 'string' || !DS_KEY.test(key)) return null;
  if (typeof relative !== 'string' || typeof title !== 'string' || typeof isDefault !== 'boolean') return null;
  if (!Array.isArray(dropped)) return null;
  const tokens = dropped.map(parseDropped);
  if (tokens.some((token) => token === null)) return null;
  return { key, relative, title, isDefault, dropped: tokens as DroppedToken[] };
}

function parseProblem(value: unknown): DefaultProblem | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { kind, relatives } = value;
  if ((kind !== 'severalMarked' && kind !== 'noneMarked') || !isStringList(relatives)) return undefined;
  return { kind, relatives };
}

/** What `design_systems_list` answered; `null` for any other shape. */
export function parseSystemList(value: unknown): SystemList | null {
  if (!isRecord(value) || !Array.isArray(value.systems)) return null;
  const systems = value.systems.map(parseFound);
  if (systems.some((system) => system === null)) return null;
  const defaultProblem = parseProblem(value.defaultProblem);
  if (defaultProblem === undefined) return null;
  return { systems: systems as FoundSystem[], defaultProblem };
}

/** Text an agent reads as one code span, with what hides or reshapes text made visible. */
/** How a name is set in a line: a code span in text for an agent, as it is for a line on screen. */
type Quote = (text: string) => string;

function quoted(text: string): string {
  return codeSpan(escapeVisible(text));
}

/** A name in a line Zorvo shows the user, where a code span would read as stray backticks. */
export const shownName: Quote = (text) => escapeVisible(text);

function joinedNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "2 tokens could not be read: `brand` (var()), `x` (named colour)."; `null` for none. */
export function droppedLine(dropped: readonly DroppedToken[], quote: Quote = quoted): string | null {
  if (dropped.length === 0) return null;
  const named = dropped
    .slice(0, MAX_DROPPED_NAMED)
    .map((token) => `${quote(token.name || token.family)} (${escapeVisible(token.reason)})`);
  const rest = dropped.length - named.length;
  const list = rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ');
  const count = dropped.length === 1 ? '1 token' : `${dropped.length} tokens`;
  return `${count} could not be read: ${list}.`;
}

function problemLine(problem: DefaultProblem | null): string | null {
  if (!problem) return null;
  if (problem.kind === 'noneMarked') return 'None of them is marked default: ask the user which to use.';
  const names = joinedNames(problem.relatives.map(quoted));
  const amount = problem.relatives.length === 2 ? 'both' : 'all';
  return `${names} are ${amount} marked default, so none is: ask the user which to use.`;
}

/** The line every design guide but a visual's ends with. */
export function systemsLine(list: SystemList): string {
  if (list.systems.length === 0) return `No design system in this folder. ${SEARCH_SCOPE}`;
  const named = list.systems
    .map((system) => `${quoted(system.relative)} (${quoted(system.title)}${system.isDefault ? ', default' : ''})`)
    .join(', ');
  const read =
    list.systems.length === 1
      ? 'Read its README.md and tokens.json before you design.'
      : 'Read the README.md and tokens.json of the one you use before you design.';
  const dropped = list.systems.flatMap((system) => {
    const line = droppedLine(system.dropped);
    return line ? [`In ${quoted(system.relative)}, ${line}`] : [];
  });
  const problem = problemLine(list.defaultProblem);
  return [`Design systems in this folder: ${named}.`, read, ...(problem ? [problem] : []), ...dropped, SEARCH_SCOPE].join(' ');
}

export * from './design-system-read';
export { dsFileUrl, dsShellState, dsShellUrl, MAX_SHELL_STATE_BYTES } from './ds-shell-state';

/** What `artifact_guide` answers for `kind: "design-system"`, before the systems line. */
export const DESIGN_SYSTEM_GUIDE: string = guide;

/**
 * The sentences the backend refuses a design system with (`design_system.rs`, `ds_store.rs`).
 * They are written for the agent and repeat nothing it sent, so they are passed on as they are.
 */
export const DESIGN_SYSTEM_REFUSALS: ReadonlySet<string> = new Set([
  'The design system must be a folder with a design-system.json inside this folder.',
  'design-system.json could not be read: it must be a JSON object with a title.',
  'A design system needs a README.md beside its design-system.json.',
  'A file of this design system is over its limit.',
  'This session already has 50 design systems. The user can remove one in Zorvo.',
]);

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What `show_artifact` answers the agent once a design system is shown. */
export function designSystemResultText(read: DesignSystemRead): string {
  const shown = `Shown: ${quoted(read.entry.title)} (key ${read.entry.key}), ${counted(read.entry.tokens, 'token', 'tokens')}, ${counted(read.entry.components, 'component', 'components')}.`;
  const dropped = droppedLine(read.content?.tokens?.dropped ?? []);
  return dropped ? `${shown} ${dropped}` : shown;
}

/** The viewer's line when several systems leave the folder without a default. */
export function defaultProblemLine(problem: DefaultProblem, quote: Quote = quoted): string {
  const names = joinedNames(problem.relatives.map(quote));
  if (problem.kind === 'severalMarked') {
    const amount = problem.relatives.length === 2 ? 'both' : 'all';
    return `No default design system: ${names} are ${amount} marked default.`;
  }
  return `No default design system: none of ${names} is marked default.`;
}

/** What `ds_source_state` answers. */
export type SourceState =
  | { state: 'none' }
  | { state: 'unreadable' }
  | { state: 'current'; commit: string }
  | { state: 'changed'; commit: string; paths: string[]; commits: number; uncommitted: boolean }
  | { state: 'unknownCommit'; commit: string };

const COMMIT = /^[0-9a-f]{7,40}$/;

export function parseSourceState(value: unknown): SourceState | null {
  if (typeof value !== 'object' || value === null) return null;
  const answer = value as Record<string, unknown>;
  switch (answer.state) {
    case 'none':
    case 'unreadable':
      return { state: answer.state };
    case 'current':
    case 'unknownCommit':
      return typeof answer.commit === 'string' && COMMIT.test(answer.commit) ? { state: answer.state, commit: answer.commit } : null;
    case 'changed': {
      const { commit, paths, commits, uncommitted } = answer;
      if (typeof commit !== 'string' || !COMMIT.test(commit) || typeof uncommitted !== 'boolean') return null;
      if (typeof commits !== 'number' || !Number.isInteger(commits) || commits < 0) return null;
      if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) return null;
      return { state: 'changed', commit, paths, commits, uncommitted };
    }
    default:
      return null;
  }
}

function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

function pathList(paths: readonly string[], quote: Quote = quoted): string {
  return joinedNames(paths.map(quote));
}

/** The header's line about the system's source, names as plain text; `null` when there is nothing to say. */
export function sourceLine(state: SourceState): string | null {
  switch (state.state) {
    case 'changed': {
      const since = `Source changed since ${shortCommit(state.commit)}: ${pathList(state.paths, shownName)}`;
      if (state.commits === 0) return `${since} has uncommitted changes.`;
      return `${since}, ${state.commits === 1 ? '1 commit' : `${state.commits} commits`}.`;
    }
    case 'unknownCommit':
      return `Source commit ${shortCommit(state.commit)} is not in this repository.`;
    case 'unreadable':
      return 'Source paths could not be read.';
    default:
      return null;
  }
}

/** What Sync again puts in the composer; the user presses Send. */
export function syncMessage(relative: string, state: Extract<SourceState, { state: 'changed' }>): string {
  return `Update the design system ${quoted(relative)} from its source. ${pathList(state.paths)} changed since ${shortCommit(state.commit)}. Change only the tokens that changed, keep their usage notes, and record the new commit in \`meta.source\`.`;
}
