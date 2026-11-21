import { APP_VERSION } from "./site";

/**
 * How often the Mac app was downloaded. next.config.ts reads the number from GitHub Releases when the
 * site is built and passes it here as ZORVO_DOWNLOADS. The fallback is the count read on 21 November
 * 2026: tests use it, and so does a build that could not reach GitHub.
 */
export const DOWNLOADS_FALLBACK = 71;

/** A build that read only some of the releases would give a lower number, so nothing under the fallback is shown. */
export function downloadCount(raw: string | undefined = process.env.ZORVO_DOWNLOADS): number {
  const count = Number(raw);
  return Number.isInteger(count) && count >= DOWNLOADS_FALLBACK ? count : DOWNLOADS_FALLBACK;
}

export const formatCount = (count: number): string => count.toLocaleString("en-US");

/**
 * The version the Download button fetches: the newest published release, which next.config.ts passes as
 * ZORVO_VERSION. The app's own package version stands in when that was not read. The two differ between a
 * release commit and its published release, when the package already names a version nobody can download.
 */
export function latestVersion(raw: string | undefined = process.env.ZORVO_VERSION): string {
  return raw !== undefined && /^\d+\.\d+\.\d+$/.test(raw) ? raw : APP_VERSION;
}
