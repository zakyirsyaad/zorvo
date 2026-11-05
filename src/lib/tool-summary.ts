import type { ToolExecution } from '../types';

/** How a kind of work reads in a summary row. */
interface KindPhrase {
  one: string;
  many: (count: number) => string;
}

const COMMAND: KindPhrase = { one: 'Ran a command', many: (n) => `Ran ${n} commands` };
const FILE: (verb: string) => KindPhrase = (verb) => ({
  one: `${verb} a file`,
  many: (n) => `${verb} ${n} files`,
});

const PHRASES: Readonly<Record<string, KindPhrase>> = {
  execute: COMMAND,
  read: FILE('Read'),
  edit: FILE('Edited'),
  delete: FILE('Deleted'),
  move: FILE('Moved'),
  search: { one: 'Searched the code', many: () => 'Searched the code' },
  fetch: { one: 'Fetched a page', many: (n) => `Fetched ${n} pages` },
};

const OTHER: KindPhrase = { one: 'Used a tool', many: (n) => `Used ${n} tools` };

/** The summary's key for a tool kind; null kinds, inherited names and the rest share one phrase. */
function phraseOf(tool: ToolExecution): KindPhrase {
  return tool.kind && Object.prototype.hasOwnProperty.call(PHRASES, tool.kind) ? PHRASES[tool.kind] : OTHER;
}

/** "Ran 2 commands · 1 failed" for a part of a reply, in the order the kinds first appear. */
export function summarizeTools(tools: readonly ToolExecution[]): string {
  const counts = new Map<KindPhrase, number>();
  for (const tool of tools) {
    const phrase = phraseOf(tool);
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([phrase, count], index) => {
    const text = count === 1 ? phrase.one : phrase.many(count);
    return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
  });
  const failed = tools.filter((tool) => tool.status === 'failed').length;
  const label = parts.join(', ');
  return failed > 0 ? `${label} · ${failed} failed` : label;
}

/** The past-tense verb of a file kind, which names its first file. */
const FILE_VERBS: Readonly<Record<string, string>> = {
  read: 'Read',
  edit: 'Edited',
  delete: 'Deleted',
  move: 'Moved',
  search: 'Searched',
  fetch: 'Fetched',
};

/**
 * One tool's row: what it did, and on what. A command names itself, a file
 * kind its first file; without either, the agent's own title is the whole row.
 */
export function toolRow(tool: ToolExecution): { verb: string; target?: string } {
  if (tool.kind === 'execute' && tool.command) return { verb: 'Ran', target: tool.command };
  const verb = tool.kind && Object.prototype.hasOwnProperty.call(FILE_VERBS, tool.kind) ? FILE_VERBS[tool.kind] : undefined;
  const target = tool.locations?.[0];
  return verb && target ? { verb, target } : { verb: tool.name };
}

/**
 * The word a tool's row claims. A result is claimed only once the agent said
 * so; a tool still running when its turn ended did not finish, and one still
 * running in the turn on screen claims nothing (it shows a spinner).
 */
export function toolStatusWord(tool: ToolExecution, isTurnOver: boolean): 'Done' | 'Failed' | 'Did not finish' | null {
  if (tool.status === 'completed') return 'Done';
  if (tool.status === 'failed') return 'Failed';
  return isTurnOver ? 'Did not finish' : null;
}

/** How many tools still run, which is none once their turn is over. */
export function stillRunning(tools: readonly ToolExecution[], isTurnOver: boolean): number {
  return isTurnOver ? 0 : tools.filter((tool) => tool.status === 'running').length;
}

/**
 * The file a group of tools touched last, as its last two path segments, with how many other
 * files they touched: "sidebar/SessionList.tsx +1". Null when no tool names a file.
 */
export function lastTouchedLabel(tools: readonly ToolExecution[]): string | null {
  // A location may carry a line ("path:12"); the file is the same either way.
  const paths = tools.flatMap((tool) => tool.locations ?? []).map((path) => path.replace(/:\d+$/, ''));
  const last = paths.at(-1);
  if (!last) return null;
  const others = new Set(paths.filter((path) => path !== last)).size;
  const shortName = last.split('/').filter(Boolean).slice(-2).join('/');
  return others > 0 ? `${shortName} +${others}` : shortName;
}
