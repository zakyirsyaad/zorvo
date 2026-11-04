import { useRef, useState } from 'react';
import type { WorkspaceTerminals } from './useWorkspaceTerminals';

export interface TerminalDrawerState {
  /** The folder whose shell is starting right now, when it is the one the top bar names. */
  startingFor: string | null;
  /**
   * Starts a shell in a folder unless one is already starting there. Resolves to
   * the new tab's id, or null when none was started (a start is in flight, or
   * opening failed and the user was told).
   */
  startShell: (folderPath: string) => Promise<string | null>;
  /** Starts the folder's first shell when it has none; for the moment the Terminal tab shows. */
  ensureShell: (folderPath: string) => void;
}

/**
 * The shells behind the inspector's Terminal tab. Showing the tab on a folder
 * without a shell starts one. That happens in the click handler and not in an
 * effect, because StrictMode runs effects twice; a folder whose shell is still
 * starting gets no second one, however the start was asked for.
 */
export function useTerminalDrawer(
  folderPath: string | undefined,
  terminals: Pick<WorkspaceTerminals, 'tabsFor' | 'open'>,
): TerminalDrawerState {
  const [starting, setStarting] = useState<readonly string[]>([]);
  // The state lags a click; the ref is what the next click sees.
  const inFlight = useRef<Set<string>>(new Set());

  const startShell = async (folder: string): Promise<string | null> => {
    if (inFlight.current.has(folder)) return null;
    inFlight.current.add(folder);
    setStarting((current) => [...current, folder]);
    try {
      return await terminals.open(folder);
    } finally {
      inFlight.current.delete(folder);
      setStarting((current) => current.filter((candidate) => candidate !== folder));
    }
  };

  const ensureShell = (folder: string) => {
    if (terminals.tabsFor(folder).length === 0) void startShell(folder);
  };

  return {
    startingFor: folderPath && starting.includes(folderPath) ? folderPath : null,
    startShell,
    ensureShell,
  };
}
