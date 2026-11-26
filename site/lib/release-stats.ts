/**
 * How often each release was downloaded, for the home page's Numbers section. Zorvo sends no telemetry, so GitHub's download
 * counts are the only numbers there are. next.config.ts reads them when the site is built and passes them as
 * ZORVO_RELEASE_STATS (JSON) and the day it read them as ZORVO_STATS_READ_ON.
 */
export interface ReleaseStat {
  /** The release's tag, such as "v0.21.1". */
  tag: string;
  /** The day it was published, as an ISO date. */
  publishedOn: string;
  /** Downloads of its .dmg: someone downloaded the installer. */
  installers: number;
  /** Downloads of its .app.tar.gz: an installed Zorvo updated itself to it. */
  updates: number;
}

export interface ReleaseStats {
  /** Oldest first. */
  releases: readonly ReleaseStat[];
  /** The day the counts were read, as an ISO date. */
  readOn: string;
  /** True when the build could not read GitHub and the page shows the snapshot below. */
  isFallback: boolean;
}

export interface Totals {
  installers: number;
  updates: number;
  releases: number;
  firstOn: string;
}

const TAG = /^v\d+\.\d+\.\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The counts read on 26 November 2026. Tests use them, and so does a build that could not reach GitHub. */
export const RELEASE_STATS_FALLBACK: { readOn: string; releases: readonly ReleaseStat[] } = {
  readOn: "2026-11-26",
  releases: [
    { tag: "v0.1.0", publishedOn: "2026-10-17", installers: 1, updates: 1 },
    { tag: "v0.5.1", publishedOn: "2026-10-25", installers: 7, updates: 3 },
    { tag: "v0.6.0", publishedOn: "2026-10-26", installers: 4, updates: 6 },
    { tag: "v0.6.1", publishedOn: "2026-10-27", installers: 2, updates: 5 },
    { tag: "v0.7.0", publishedOn: "2026-10-29", installers: 4, updates: 3 },
    { tag: "v0.8.0", publishedOn: "2026-11-04", installers: 5, updates: 2 },
    { tag: "v0.8.1", publishedOn: "2026-11-04", installers: 2, updates: 1 },
    { tag: "v0.9.0", publishedOn: "2026-11-07", installers: 1, updates: 1 },
    { tag: "v0.9.1", publishedOn: "2026-11-07", installers: 9, updates: 1 },
    { tag: "v0.9.2", publishedOn: "2026-11-09", installers: 15, updates: 1 },
    { tag: "v0.10.0", publishedOn: "2026-11-11", installers: 1, updates: 2 },
    { tag: "v0.10.1", publishedOn: "2026-11-11", installers: 5, updates: 3 },
    { tag: "v0.11.0", publishedOn: "2026-11-13", installers: 1, updates: 2 },
    { tag: "v0.12.0", publishedOn: "2026-11-14", installers: 8, updates: 2 },
    { tag: "v0.13.0", publishedOn: "2026-11-19", installers: 1, updates: 2 },
    { tag: "v0.13.1", publishedOn: "2026-11-19", installers: 1, updates: 5 },
    { tag: "v0.14.0", publishedOn: "2026-11-20", installers: 1, updates: 3 },
    { tag: "v0.14.1", publishedOn: "2026-11-20", installers: 4, updates: 2 },
    { tag: "v0.15.0", publishedOn: "2026-11-21", installers: 3, updates: 2 },
    { tag: "v0.16.0", publishedOn: "2026-11-22", installers: 2, updates: 2 },
    { tag: "v0.17.0", publishedOn: "2026-11-22", installers: 4, updates: 2 },
    { tag: "v0.18.0", publishedOn: "2026-11-24", installers: 3, updates: 2 },
    { tag: "v0.19.0", publishedOn: "2026-11-25", installers: 1, updates: 2 },
    { tag: "v0.20.0", publishedOn: "2026-11-25", installers: 1, updates: 2 },
    { tag: "v0.20.1", publishedOn: "2026-11-25", installers: 3, updates: 3 },
    { tag: "v0.21.0", publishedOn: "2026-11-26", installers: 1, updates: 2 },
    { tag: "v0.21.1", publishedOn: "2026-11-26", installers: 3, updates: 3 },
  ],
};

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function isReleaseStat(value: unknown): value is ReleaseStat {
  if (typeof value !== "object" || value === null) return false;
  const { tag, publishedOn, installers, updates } = value as Record<string, unknown>;
  return typeof tag === "string" && TAG.test(tag) && typeof publishedOn === "string" && DAY.test(publishedOn) && isCount(installers) && isCount(updates);
}

/** Orders by day, then by version within a day. */
function compareReleases(a: ReleaseStat, b: ReleaseStat): number {
  if (a.publishedOn !== b.publishedOn) return a.publishedOn < b.publishedOn ? -1 : 1;
  return a.tag.localeCompare(b.tag, "en", { numeric: true });
}

/** One entry per tag: a release kept in both repositories adds its counts, on the day it first came out. */
function joinByTag(releases: readonly ReleaseStat[]): ReleaseStat[] {
  const byTag = new Map<string, ReleaseStat>();
  for (const release of releases) {
    const seen = byTag.get(release.tag);
    byTag.set(
      release.tag,
      seen
        ? {
            tag: release.tag,
            publishedOn: seen.publishedOn < release.publishedOn ? seen.publishedOn : release.publishedOn,
            installers: seen.installers + release.installers,
            updates: seen.updates + release.updates,
          }
        : release,
    );
  }
  return [...byTag.values()].sort(compareReleases);
}

export function totalsOf(releases: readonly ReleaseStat[]): Totals {
  return {
    installers: releases.reduce((sum, release) => sum + release.installers, 0),
    updates: releases.reduce((sum, release) => sum + release.updates, 0),
    releases: releases.length,
    firstOn: releases[0]?.publishedOn ?? "",
  };
}

const FALLBACK_TOTALS = totalsOf(RELEASE_STATS_FALLBACK.releases);
const FALLBACK: ReleaseStats = { ...RELEASE_STATS_FALLBACK, isFallback: true };

/**
 * The counts the build read, or the snapshot when there were none, they were malformed, or they add up to less
 * than the snapshot: GitHub's counts only grow, so a lower total means a page of releases went unread.
 */
export function releaseStats(
  raw: string | undefined = process.env.ZORVO_RELEASE_STATS,
  readOn: string | undefined = process.env.ZORVO_STATS_READ_ON,
): ReleaseStats {
  if (raw === undefined || readOn === undefined || !DAY.test(readOn)) return FALLBACK;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }
  if (!Array.isArray(parsed) || !parsed.every(isReleaseStat)) return FALLBACK;
  const releases = joinByTag(parsed);
  const totals = totalsOf(releases);
  if (totals.installers < FALLBACK_TOTALS.installers || totals.updates < FALLBACK_TOTALS.updates) return FALLBACK;
  return { releases, readOn, isFallback: false };
}

/** The installer downloads added up release day by release day, for the chart. */
export function cumulativeByDay(releases: readonly ReleaseStat[]): Array<{ day: string; total: number }> {
  const points: Array<{ day: string; total: number }> = [];
  let total = 0;
  for (const release of releases) {
    total += release.installers;
    const last = points.at(-1);
    if (last?.day === release.publishedOn) points[points.length - 1] = { day: last.day, total };
    else points.push({ day: release.publishedOn, total });
  }
  return points;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "26 Nov 2026" for "2026-11-26". */
export const formatDay = (day: string): string => DATE.format(new Date(`${day}T00:00:00Z`));
