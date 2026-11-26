import { useCallback, useSyncExternalStore } from 'react';

/**
 * The design system theme the user picked, per session and system, kept for this run: the system's
 * viewer and every canvas of the session that names it read the same pick. An id the system no
 * longer lists falls back to its first theme.
 */
const picks = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pickDesignSystemTheme(sessionId: string, systemKey: string, theme: string): void {
  picks.set(`${sessionId}/${systemKey}`, theme);
  for (const listener of listeners) listener();
}

export function useDesignSystemTheme(
  sessionId: string,
  systemKey: string | null,
  themes: readonly string[],
): { theme: string | null; setTheme: (id: string) => void } {
  const picked = useSyncExternalStore(subscribe, () => (systemKey === null ? undefined : picks.get(`${sessionId}/${systemKey}`)));
  const theme = picked !== undefined && themes.includes(picked) ? picked : (themes[0] ?? null);
  const setTheme = useCallback(
    (id: string) => {
      if (systemKey !== null) pickDesignSystemTheme(sessionId, systemKey, id);
    },
    [sessionId, systemKey],
  );
  return { theme, setTheme };
}
