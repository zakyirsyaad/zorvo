/** What `app_update_check` reports about a newer Zorvo. */
export interface AppUpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

/** The payload of an `app-update-progress` event. */
export type AppUpdateProgress =
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' };

/** Wait this long after startup before the first check, so launching stays quick. */
export const FIRST_CHECK_DELAY_MS = 8_000;
/** Zorvo may stay open for days; ask again about once a day. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Whole percent of the download, or null when the size is unknown or the download is over. */
export function downloadPercent(progress: AppUpdateProgress | null): number | null {
  if (progress?.phase !== 'downloading' || !progress.total) return null;
  return Math.min(100, Math.floor((progress.downloaded / progress.total) * 100));
}
