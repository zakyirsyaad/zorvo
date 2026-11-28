import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stats } from "../../site/components/sections/Stats";
import { RELEASE_STATS_FALLBACK, cumulativeByDay, releaseStats, totalsOf } from "../../site/lib/release-stats";

const fallbackTotals = totalsOf(RELEASE_STATS_FALLBACK.releases);
const read = (releases: unknown, readOn = "2026-12-01") => releaseStats(JSON.stringify(releases), readOn);
/** The fallback's releases with one more on top, so a read is never lower than the snapshot. */
const withNewer = (extra: object) => [...RELEASE_STATS_FALLBACK.releases, { tag: "v0.30.0", publishedOn: "2026-12-01", installers: 5, updates: 4, ...extra }];

describe("release stats", () => {
  it("uses the dated snapshot when the build read nothing", () => {
    const stats = releaseStats(undefined, undefined);
    expect(stats.isFallback).toBe(true);
    expect(stats.readOn).toBe(RELEASE_STATS_FALLBACK.readOn);
    expect(fallbackTotals).toEqual({ installers: 93, updates: 65, releases: 27, firstOn: "2026-10-17" });
  });

  it("reads a build's counts, joins a release kept in both repositories and orders them by date", () => {
    const stats = read([...withNewer({}), { tag: "v0.30.0", publishedOn: "2026-11-30", installers: 2, updates: 1 }]);
    expect(stats.isFallback).toBe(false);
    expect(stats.readOn).toBe("2026-12-01");
    const newest = stats.releases.at(-1);
    expect(newest).toEqual({ tag: "v0.30.0", publishedOn: "2026-11-30", installers: 7, updates: 5 });
    const days = stats.releases.map((release) => release.publishedOn);
    expect(days).toEqual([...days].sort());
  });

  it.each([
    ["not a list", { tag: "v1.0.0" }],
    ["a bad tag", withNewer({ tag: "latest" })],
    ["a bad date", withNewer({ publishedOn: "yesterday" })],
    ["a negative count", withNewer({ installers: -1 })],
    ["a fraction", withNewer({ updates: 1.5 })],
    ["fewer downloads than the snapshot", [{ tag: "v1.0.0", publishedOn: "2026-12-01", installers: 1, updates: 1 }]],
  ])("falls back to the snapshot on %s", (_, releases) => {
    expect(read(releases).isFallback).toBe(true);
  });

  it("falls back when the read is not JSON or the day it was read is not a date", () => {
    expect(releaseStats("{", "2026-12-01").isFallback).toBe(true);
    expect(releaseStats(JSON.stringify(withNewer({})), "soon").isFallback).toBe(true);
  });

  it("adds the downloads up day by day, ending at the total", () => {
    const points = cumulativeByDay(RELEASE_STATS_FALLBACK.releases);
    expect(points[0]).toEqual({ day: "2026-10-17", total: 1 });
    expect(points.at(-1)).toEqual({ day: "2026-11-26", total: 93 });
    expect(new Set(points.map((point) => point.day)).size).toBe(points.length);
    for (let index = 1; index < points.length; index += 1) expect(points[index].total).toBeGreaterThan(points[index - 1].total);
  });
});

describe("stats section", () => {
  const render = (stats = releaseStats(undefined, undefined)) =>
    new DOMParser().parseFromString(renderToStaticMarkup(<Stats stats={stats} />), "text/html");

  it("shows the totals and a chart that says what it draws", () => {
    const section = render();
    expect(section.querySelector("section#stats h2")?.textContent).toBe("Everything we know about who uses Zorvo.");
    const tiles = [...section.querySelectorAll("dl > div")].map((tile) => tile.textContent);
    expect(tiles).toEqual(["Installer downloads93", "Self-updates65", "Releases since 17 Oct 202627"]);
    expect(section.querySelector("svg[role=img]")?.getAttribute("aria-label")).toContain("93");
    expect(section.querySelector("table, details")).toBeNull();
  });

  it("says when the counts were read, and that they are a snapshot when GitHub could not be reached", () => {
    expect(render().body.textContent).toContain("GitHub's counts could not be read when this page was built");
    const live = render(read(withNewer({})));
    expect(live.body.textContent).not.toContain("could not be read");
    expect(live.body.textContent).toContain("1 Dec 2026");
  });
});
