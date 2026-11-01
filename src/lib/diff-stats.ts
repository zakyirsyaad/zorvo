import type { ReviewTarget } from '../types';
import type { FileChange } from './git-changes';

/**
 * What a diff is measured against: the last commit, the branch this one forked
 * from, or the commit the session's worktree was made from.
 */
export type DiffTargetId = ReviewTarget;

export interface DiffTargets {
  /** The branch to compare against, when the session's branch has one. */
  base: { name: string } | null;
  /** The repository's root, canonical. Paths in a diff are relative to it. */
  root: string;
  /** The folder asked about, relative to `root`, with a trailing `/`; empty at the root. */
  prefix: string;
}

/** An uncommitted change with its line counts. */
export interface FileStat extends FileChange {
  added: number;
  removed: number;
  isBinary: boolean;
  /** Changes whenever the file's diff may have; equal means a diff already read still holds. */
  fingerprint: string;
}

/** The sign shown before removed-line counts (U+2212, not a hyphen). */
export const MINUS = '−';

/** Added and removed lines summed over all files. */
export function totalsOf(stats: readonly FileStat[]): { added: number; removed: number } {
  return stats.reduce(
    (total, stat) => ({ added: total.added + stat.added, removed: total.removed + stat.removed }),
    { added: 0, removed: 0 },
  );
}

/** A line count with thousands separators, e.g. "2,847". */
export function formatLineCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** The comparison a diff shows, e.g. "main → working tree". */
export function targetLabel(target: DiffTargetId, targets: DiffTargets): string {
  if (target === 'start') return 'Start of this worktree → working tree';
  const from = target === 'base' && targets.base ? targets.base.name : 'HEAD';
  return `${from} → working tree`;
}

/** The targets a diff can be measured against, in the order the picker lists them. */
export function targetOptions(targets: DiffTargets, startCommit: string | undefined): DiffTargetId[] {
  return [...(startCommit ? (['start'] as const) : []), ...(targets.base ? (['base'] as const) : []), 'head'];
}

/**
 * Where a diff opens: the start when preferred and offered, else the base,
 * else HEAD. Only a session in a compare run prefers the start, so every other
 * session keeps what it showed before.
 */
export function defaultTarget(options: readonly DiffTargetId[], prefersStart: boolean): DiffTargetId {
  if (prefersStart && options.includes('start')) return 'start';
  return options.includes('base') ? 'base' : 'head';
}
