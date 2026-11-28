import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { parseDesignSystemRead, parseSystemList, type DesignSystemRead, type SystemList } from '../lib/design-systems';

/** Emitted by the backend with `{ sessionId }` after a session's artifacts changed. */
const ARTIFACTS_CHANGED = 'artifacts-changed';

/** The last good read of each system, kept for this run, so Expand and Shrink start with it at once. */
const lastGoodReads = new Map<string, DesignSystemRead>();

/** The system as last read well, for a comment picked on it. */
export function designSystemReadNow(sessionId: string, key: string): DesignSystemRead | null {
  return lastGoodReads.get(`${sessionId}/${key}`) ?? null;
}

export interface DesignSystemState {
  read: DesignSystemRead | null;
  /** The last read that held the system's content; kept while a later read has an error. */
  lastGood: DesignSystemRead | null;
  /** What the session's folder holds, for the default's line. */
  list: SystemList | null;
  refresh: () => void;
}

/**
 * Reads a shown design system with `ds_read` when it mounts, when the backend says the session's
 * artifacts changed (a `show_artifact` of it), at each turn end and on window focus, as `useCanvas`
 * does. A read whose folder no longer reads keeps the last good one.
 */
export function useDesignSystem(sessionId: string, cwd: string | undefined, key: string | null, turnsEnded?: number): DesignSystemState {
  const memoryKey = key === null ? null : `${sessionId}/${key}`;
  const [read, setRead] = useState<DesignSystemRead | null>(() => (memoryKey ? (lastGoodReads.get(memoryKey) ?? null) : null));
  const [lastGood, setLastGood] = useState<DesignSystemRead | null>(() => (memoryKey ? (lastGoodReads.get(memoryKey) ?? null) : null));
  const [list, setList] = useState<SystemList | null>(null);
  const request = useRef(0);

  const refresh = useCallback(() => {
    if (key === null) return;
    const current = ++request.current;
    invoke('ds_read', { sessionId, key })
      .then((answer) => {
        if (current !== request.current) return;
        const parsed = parseDesignSystemRead(answer);
        if (parsed === null) return;
        setRead(parsed);
        if (parsed.content !== null) {
          setLastGood(parsed);
          lastGoodReads.set(`${sessionId}/${key}`, parsed);
        }
      })
      .catch(() => undefined);
    if (cwd) {
      invoke('design_systems_list', { sessionId, cwd })
        .then((answer) => {
          if (current === request.current) setList(parseSystemList(answer));
        })
        .catch(() => undefined);
    }
  }, [sessionId, cwd, key]);

  useEffect(() => {
    refresh();
  }, [refresh, turnsEnded]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const unlisten = listen<unknown>(ARTIFACTS_CHANGED, (event) => {
      const changed = (event.payload as { sessionId?: unknown } | null)?.sessionId;
      if (changed === sessionId) refresh();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      void unlisten.then((stop) => stop());
    };
  }, [refresh, sessionId]);

  return { read, lastGood, list, refresh };
}
