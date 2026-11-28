import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { FolderPullRequests } from '../lib/pull-request-look';
import { MAX_FAILED_READS, type PullRequestStatus } from './usePullRequest';

/** A focus reads a folder again once its last read is this old. */
export const FOCUS_REFRESH_MS = 15_000;
/** A turn end reads a folder again once its last read is this old: an agent may have pushed or opened one. */
export const TURN_REFRESH_MS = 5_000;
/** The folder of the session on screen is read this often while the window is in front: its checks may be running. */
export const LIVE_REFRESH_MS = 30_000;

interface Answer {
  branch: string | null;
  pullRequests: PullRequestStatus[];
}

const NONE: ReadonlyMap<string, FolderPullRequests> = new Map();

/** How many busy sessions each folder holds. */
function countsOf(folders: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const folder of folders) counts.set(folder, (counts.get(folder) ?? 0) + 1);
  return counts;
}

/**
 * The pull requests of each session folder, one `gh pr list` per folder, kept in memory: read when a
 * folder first appears, on window focus at most every 2 minutes, when a session there ends its turn
 * (it leaves `busyFolders`, the folder of every session at work) at most once a minute, and every minute
 * for `liveFolder` (the session on screen) while the window is in front. Nothing is read while `isEnabled` is false (gh missing or signed out),
 * and the backend runs nothing for a folder without a github.com remote. Reads go one at a time.
 *
 * A failed read is quiet and keeps what was shown; after `MAX_FAILED_READS` failures in a row the
 * folder's pull requests are dropped, so old checks never stay on screen as if current.
 */
export function useWorkspacePullRequests(
  paths: readonly string[],
  isEnabled: boolean,
  busyFolders: readonly string[],
  { liveFolder, liveSessionId, liveRefreshKey }: { liveFolder?: string; liveSessionId?: string; liveRefreshKey?: string } = {},
): ReadonlyMap<string, FolderPullRequests> {
  const [folders, setFolders] = useState<ReadonlyMap<string, FolderPullRequests>>(NONE);
  const readAt = useRef(new Map<string, number>());
  const failures = useRef(new Map<string, number>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const isMounted = useRef(true);
  const pathsKey = [...new Set(paths)].sort().join('\n');

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const setFolder = useCallback((path: string, folder: FolderPullRequests | null) => {
    setFolders((current) => {
      if (folder === null && !current.has(path)) return current;
      const next = new Map(current);
      if (folder) next.set(path, folder);
      else next.delete(path);
      return next;
    });
  }, []);

  const read = useCallback(
    (path: string) => {
      readAt.current.set(path, Date.now());
      queue.current = queue.current.then(async () => {
        try {
          const answer = await invoke<Answer | null>('workspace_pull_requests', { path });
          if (!isMounted.current) return;
          failures.current.delete(path);
          setFolder(path, answer ? { branch: answer.branch, pullRequests: answer.pullRequests } : null);
        } catch {
          if (!isMounted.current) return;
          const failed = (failures.current.get(path) ?? 0) + 1;
          failures.current.set(path, failed);
          if (failed >= MAX_FAILED_READS) setFolder(path, null);
        }
      });
    },
    [setFolder],
  );

  /** Reads each of `folders` whose last read is older than `age`, or that was never read. */
  const readIfOlder = useCallback(
    (folders: Iterable<string>, age: number) => {
      const now = Date.now();
      for (const path of folders) {
        const last = readAt.current.get(path);
        if (last === undefined || now - last >= age) read(path);
      }
    },
    [read],
  );
  const readOlderThan = useCallback(
    (age: number) => readIfOlder(pathsKey ? pathsKey.split('\n') : [], age),
    [pathsKey, readIfOlder],
  );

  // A folder that appears is read at once; one already read waits for its next refresh. After gh was
  // signed out (or missing) every folder is read again, since what was kept may have changed meanwhile.
  const wasEnabled = useRef(isEnabled);
  useEffect(() => {
    if (isEnabled && !wasEnabled.current) readAt.current.clear();
    wasEnabled.current = isEnabled;
    if (isEnabled) readOlderThan(Number.POSITIVE_INFINITY);
  }, [isEnabled, readOlderThan]);

  // The session on screen keeps its checks current, every minute while the window is in front.
  useEffect(() => {
    if (!isEnabled || !liveFolder) return;
    const timer = setInterval(() => {
      if (document.hasFocus()) readIfOlder([liveFolder], LIVE_REFRESH_MS);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isEnabled, liveFolder, readIfOlder]);

  useEffect(() => {
    if (!isEnabled) return;
    const onFocus = () => readOlderThan(FOCUS_REFRESH_MS);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isEnabled, readOlderThan]);

  // A folder that holds fewer busy sessions than before had a turn end there.
  const busyKey = [...busyFolders].sort().join('\n');
  const seenBusy = useRef(countsOf(busyFolders));
  useEffect(() => {
    const now = countsOf(busyKey ? busyKey.split('\n') : []);
    const ended = [...seenBusy.current].filter(([folder, count]) => (now.get(folder) ?? 0) < count).map(([folder]) => folder);
    seenBusy.current = now;
    if (isEnabled && ended.length > 0) readIfOlder(ended, TURN_REFRESH_MS);
  }, [busyKey, isEnabled, readIfOlder]);

  // A new PR URL or branch recorded by the active agent triggers an immediate read, bypassing cooldowns.
  // Switching to a different session in the same folder updates the baseline without triggering an extra poll.
  const seenLive = useRef({ sessionId: liveSessionId, key: liveRefreshKey });
  useEffect(() => {
    const prev = seenLive.current;
    seenLive.current = { sessionId: liveSessionId, key: liveRefreshKey };
    if (
      isEnabled &&
      liveFolder &&
      liveRefreshKey &&
      prev.sessionId === liveSessionId &&
      prev.key !== undefined &&
      liveRefreshKey !== prev.key
    ) {
      read(liveFolder);
    }
  }, [isEnabled, liveFolder, liveSessionId, liveRefreshKey, read]);

  return isEnabled ? folders : NONE;
}
