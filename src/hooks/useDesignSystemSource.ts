import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseSourceState, type SourceState } from '../lib/design-systems';

/**
 * Whether the code a shown design system was made from changed: `ds_source_state`, read when the
 * system shows, on window focus and at each turn end.
 */
export function useDesignSystemSource(sessionId: string, key: string | null, turnsEnded?: number): SourceState | null {
  const [state, setState] = useState<SourceState | null>(null);
  const request = useRef(0);
  const refresh = useCallback(() => {
    if (key === null) return;
    const current = ++request.current;
    invoke('ds_source_state', { sessionId, key })
      .then((answer) => {
        if (current === request.current) setState(parseSourceState(answer));
      })
      .catch(() => undefined);
  }, [sessionId, key]);

  useEffect(() => {
    refresh();
  }, [refresh, turnsEnded]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return state;
}
