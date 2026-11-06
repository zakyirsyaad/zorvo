/** What `app_update_check` reports about a newer Zorvo. */
export interface AppUpdateInfo {
  version: string;
}

/** The payload of an `app-update-progress` event. */
export type AppUpdateProgress =
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' };

/** Wait this long after startup before the first check, so launching stays quick. */
export const FIRST_CHECK_DELAY_MS = 8_000;
/** Zorvo may stay open for days; ask again about once a day. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After a check that could not be made (Wi-Fi not up yet at login), ask again sooner than a day. */
export const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

/** What a restart ends, counted ("Restarting stops 2 agents mid-turn and 1 shell."); empty when nothing would be lost. */
export function restartWarning(workingAgents: number, openTerminals: number): string {
  const agents = `${workingAgents} ${workingAgents === 1 ? 'agent' : 'agents'} mid-turn`;
  const shells = `${openTerminals} ${openTerminals === 1 ? 'shell' : 'shells'}`;
  if (workingAgents > 0 && openTerminals > 0) return `Restarting stops ${agents} and ${shells}.`;
  if (workingAgents > 0) return `Restarting stops ${agents}.`;
  if (openTerminals > 0) return `Restarting stops ${shells}.`;
  return '';
}

/** Whole percent of the download, or null when the size is unknown or the download is over. */
export function downloadPercent(progress: AppUpdateProgress | null): number | null {
  if (progress?.phase !== 'downloading' || !progress.total) return null;
  // Multiply first: `(57 / 100) * 100` is 56.99999999999999, which floors to 56.
  return Math.min(100, Math.floor((progress.downloaded * 100) / progress.total));
}
