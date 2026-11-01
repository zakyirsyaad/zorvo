import { invoke } from '@tauri-apps/api/core';
import type { DiffTargetId } from './diff-stats';
import { createLimiter } from './limiter';

/** Diffs read at once: each is a git process, and "Expand all" may open hundreds. */
const MAX_DIFF_READS = 4;
const limited = createLimiter(MAX_DIFF_READS);

/**
 * One changed file's diff in `rootPath` against `target`, waiting its turn among
 * the other reads; aborting `signal` gives up the turn. The start of the worktree
 * is not a target of its own for the backend: it is HEAD's diff widened to the
 * commit the worktree began at (`since`).
 */
export function readFileDiff(
  rootPath: string,
  file: string,
  target: DiffTargetId,
  startCommit: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (target === 'start' && !startCommit) return Promise.reject(new Error('This session has no start commit to compare with.'));
  const args =
    target === 'start'
      ? { path: rootPath, file, target: 'head', since: startCommit }
      : { path: rootPath, file, target };
  return limited(() => invoke<string>('session_file_diff', args), signal);
}
