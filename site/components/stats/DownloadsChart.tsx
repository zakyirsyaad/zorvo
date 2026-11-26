import { cumulativeByDay, formatDay, type ReleaseStat } from "../../lib/release-stats";

const MS_PER_DAY = 86_400_000;
/** Gridline steps to choose from: the smallest that leaves at most four lines. */
const STEPS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
const MAX_LINES = 4;

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY;

/**
 * Installer downloads added up over time, drawn when the page is built. The line steps up on each release day,
 * since that is the only day a count can be placed on. The shapes stretch with the box; the labels and the end
 * dot are HTML, so their size stays the same at any width.
 */
export function DownloadsChart({ releases }: { releases: readonly ReleaseStat[] }) {
  const points = cumulativeByDay(releases);
  if (points.length === 0) return null;
  const first = dayNumber(points[0].day);
  const span = Math.max(dayNumber(points.at(-1)!.day) - first, 1);
  const total = points.at(-1)!.total;
  const step = STEPS.find((candidate) => Math.ceil(total / candidate) <= MAX_LINES) ?? STEPS.at(-1)!;
  const top = Math.max(Math.ceil(total / step), 1) * step;
  const x = (day: string) => ((dayNumber(day) - first) / span) * 100;
  const y = (count: number) => 100 - (count / top) * 100;

  // Flat until the next release day, then up: the count is only known on the day a release came out.
  const line = points
    .map((point, index) => {
      const at = `${x(point.day)},${y(point.total)}`;
      if (index === 0) return `M${at}`;
      return `H${x(point.day)} V${y(point.total)}`;
    })
    .join(" ");
  const area = `${line} V100 H0 Z`;
  const ticks = Array.from({ length: top / step + 1 }, (_, index) => index * step);
  const last = points.at(-1)!;

  return (
    <div className="relative h-64 min-[768px]:h-80 pl-10 pb-7">
      <div className="relative h-full">
        {ticks.map((tick) => (
          <div key={tick} className="absolute inset-x-0 border-t border-border" style={{ top: `${y(tick)}%` }} aria-hidden="true">
            <span className="absolute -left-10 w-8 -translate-y-1/2 text-right font-mono text-[11px] leading-4 text-fg-subtle">{tick}</span>
          </div>
        ))}
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Installer downloads added up by release day: ${points[0].total} on ${formatDay(points[0].day)}, ${total} by ${formatDay(last.day)}.`}
        >
          <path d={area} className="fill-mark/15" />
          <path d={line} className="fill-none stroke-mark" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mark ring-3 ring-bg"
          style={{ left: `${x(last.day)}%`, top: `${y(last.total)}%` }}
          aria-hidden="true"
        />
        {/* Beside the dot, on the side with room, so it never covers the axis labels. */}
        <span
          className={`absolute -translate-y-[calc(100%+10px)] font-mono text-[13px] font-medium text-fg ${x(last.day) > 50 ? "-translate-x-full pr-1" : "pl-1"}`}
          style={{ left: `${x(last.day)}%`, top: `${y(last.total)}%` }}
          aria-hidden="true"
        >
          {total}
        </span>
        <div className="absolute inset-x-0 top-full flex justify-between pt-2 text-[12px] leading-4 text-fg-subtle" aria-hidden="true">
          <span>{formatDay(points[0].day)}</span>
          <span>{formatDay(last.day)}</span>
        </div>
      </div>
    </div>
  );
}
