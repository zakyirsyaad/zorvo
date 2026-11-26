import { codeSpan } from './artifact-comments';
import { escapeVisible } from './visible-text';

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
function quoted(text: string): string {
  return codeSpan(escapeVisible(text));
}

function joinedNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "2 tokens could not be read: `brand` (var()), `x` (named colour)."; `null` for none. */
export function droppedLine(dropped: readonly DroppedToken[]): string | null {
  if (dropped.length === 0) return null;
  const named = dropped
    .slice(0, MAX_DROPPED_NAMED)
    .map((token) => `${quoted(token.name || token.family)} (${escapeVisible(token.reason)})`);
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
