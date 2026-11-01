import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DiffTargetId, DiffTargets, FileStat } from '../lib/diff-stats';
import { useLatest } from './useLatest';

const NO_TARGETS: DiffTargets = { base: null };

export interface DiffTargetsRead {
  targets: DiffTargets;
  /** True once the read has answered or failed; until then `targets` has no base yet. */
  isLoaded: boolean;
}

/**
 * What the diff can be measured against in `path`'s repository. A failed read
 * counts as loaded without a base (HEAD still works) and is reported once per folder.
 */
export function useDiffTargets(
  path: string | undefined,
  isEnabled: boolean,
  version: number,
  onError: (message: string) => void,
): DiffTargetsRead {
  const [state, setState] = useState<{ path: string; targets: DiffTargets } | null>(null);
  const onErrorRef = useLatest(onError);
  const reportedPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!path || !isEnabled) return;
    let isCancelled = false;
    invoke<DiffTargets>('session_diff_targets', { path })
      .then((targets) => {
        if (!isCancelled && targets) setState({ path, targets });
      })
      .catch((error) => {
        if (isCancelled) return;
        setState({ path, targets: NO_TARGETS });
        if (reportedPath.current === path) return;
        reportedPath.current = path;
        onErrorRef.current(`Could not read the diff targets in ${path}: ${String(error)}`);
      });
    return () => {
      isCancelled = true;
    };
  }, [path, isEnabled, version, onErrorRef]);

  const isCurrent = isEnabled && state !== null && state.path === path;
  return { targets: isCurrent ? state.targets : NO_TARGETS, isLoaded: isCurrent };
}

export interface DiffStats {
  /** The files with line counts, or null before the first answer for this folder and target. */
  stats: FileStat[] | null;
  reload: () => void;
}

/** The command a stats read runs, or null for no read. */
interface StatsRequest {
  command: 'session_diff_stats' | 'session_diff_stats_since';
  args: Record<string, unknown>;
}

/**
 * The body both stats hooks share: runs `request` for `path` and keeps the
 * answer for `key` (what the read is for) only. Read again when `version` or
 * `key` changes, and on `reload`. A failure is reported once per folder.
 */
function useStatsRead(
  path: string | undefined,
  request: StatsRequest | null,
  key: string,
  version: number,
  onError: (message: string) => void,
): DiffStats {
  const [state, setState] = useState<{ key: string; stats: FileStat[] } | null>(null);
  const [reloads, setReloads] = useState(0);
  const onErrorRef = useLatest(onError);
  const requestRef = useLatest(request);
  const reportedPath = useRef<string | undefined>(undefined);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const isEnabled = request !== null;

  useEffect(() => {
    const current = requestRef.current;
    if (!path || !current) return;
    let isCancelled = false;
    invoke<FileStat[]>(current.command, current.args)
      .then((stats) => {
        if (isCancelled || !Array.isArray(stats)) return;
        setState({ key, stats });
      })
      .catch((error) => {
        if (isCancelled || reportedPath.current === path) return;
        reportedPath.current = path;
        onErrorRef.current(`Could not read the diff in ${path}: ${String(error)}`);
      });
    return () => {
      isCancelled = true;
    };
  }, [path, isEnabled, key, version, reloads, onErrorRef, requestRef]);

  // Never show another folder's or target's files while this one loads.
  const isCurrent = isEnabled && state !== null && state.key === key;
  return { stats: isCurrent ? state.stats : null, reload };
}

/**
 * Per-file line counts of the changes in `path`'s repository against `target`.
 * Read again when `version` (the change list) or `target` changes, and on `reload`.
 * Nothing is read while `isEnabled` is false (outside a repository, or until the
 * diff targets are known). A failure is reported once per folder.
 */
export function useDiffStats(
  path: string | undefined,
  isEnabled: boolean,
  target: DiffTargetId,
  version: number,
  onError: (message: string) => void,
): DiffStats {
  const request = isEnabled ? { command: 'session_diff_stats' as const, args: { path, target } } : null;
  return useStatsRead(path, request, `${path}\0${target}`, version, onError);
}

/**
 * Per-file line counts of the changes in `path`'s repository since `commit`,
 * committed or not. Nothing is read without a commit. Read again when
 * `version` changes. A failure is reported once per folder.
 */
export function useDiffStatsSince(
  path: string | undefined,
  commit: string | undefined,
  version: number,
  onError: (message: string) => void,
): DiffStats {
  const request = commit ? { command: 'session_diff_stats_since' as const, args: { path, commit } } : null;
  return useStatsRead(path, request, `${path}\0since\0${commit}`, version, onError);
}
