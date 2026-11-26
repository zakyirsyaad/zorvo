import { formatCount } from "../../lib/downloads";
import { formatDay, releaseStats, totalsOf, type ReleaseStats } from "../../lib/release-stats";
import { DownloadsChart } from "../stats/DownloadsChart";

/**
 * Every number Zorvo has about its use, which is GitHub's download counts and nothing else: the totals and a
 * chart of installer downloads.
 */
export function Stats({ stats = releaseStats() }: { stats?: ReleaseStats }) {
  const totals = totalsOf(stats.releases);
  const tiles = [
    { label: "Installer downloads", value: totals.installers },
    { label: "Self-updates", value: totals.updates },
    { label: `Releases since ${formatDay(totals.firstOn)}`, value: totals.releases },
  ];
  return (
    <section className="lp-sec" id="stats" aria-labelledby="stats-title">
      <div className="lp-wrap flex flex-col gap-12" data-reveal="">
        <header className="flex max-w-170 flex-col gap-4">
          <p className="lp-eyebrow" data-r="">Numbers</p>
          <h2 className="lp-h2" id="stats-title" data-r="">Everything we know about who uses Zorvo.</h2>
          <p className="lp-lead" data-r="">
            Zorvo sends no telemetry. These counts come from GitHub&apos;s release downloads. They count downloads, not
            people, and the maintainer&apos;s own copy is in them.
          </p>
          {stats.isFallback && (
            <p className="rounded-xl border border-attention-border bg-attention-surface px-4 py-3 text-[14px] leading-5.5 text-fg-secondary">
              GitHub&apos;s counts could not be read when this page was built. These are the counts read on {formatDay(stats.readOn)}.
            </p>
          )}
        </header>

        <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border min-[640px]:grid-cols-3" data-r="">
          {tiles.map((tile) => (
            <div key={tile.label} className="flex flex-col gap-1 bg-bg p-5">
              <dt className="text-[13px] leading-5 text-fg-subtle">{tile.label}</dt>
              <dd className="font-mono text-[34px] leading-10 font-medium tracking-[-0.02em] text-fg tabular-nums">{formatCount(tile.value)}</dd>
            </div>
          ))}
        </dl>

        <figure className="flex flex-col gap-4" data-r="">
          <DownloadsChart releases={stats.releases} />
          <figcaption className="max-w-170 text-[13px] leading-5 text-fg-subtle">
            Installer downloads so far, added up on the day each release came out. GitHub keeps one total per file, not
            a count per day. Read on {formatDay(stats.readOn)}.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
