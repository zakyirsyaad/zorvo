import { useRef, useState } from "react";
import type { ContextUsage } from "../../types";
import { useDismiss } from "../../hooks/useDismiss";

const COMPACT_NUMBER = new Intl.NumberFormat("en-US", { notation: "compact" });
const WARN_AT = 80;
const FULL_AT = 95;

function toneFor(percent: number): string {
  if (percent >= FULL_AT) return "text-danger";
  if (percent >= WARN_AT) return "text-status-attention";
  return "text-fg-subtle";
}

const tokens = (n: number) => `${n.toLocaleString("en-US")} tokens`;

/** An amount in its currency, e.g. "$0.42"; an unknown currency code is written out. */
function money({ amount, currency }: NonNullable<ContextUsage["cost"]>): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** The ring and percentage, or the tokens in use when the window's size is unknown. */
function Gauge({ used, size }: ContextUsage) {
  // Without the window's size there is no percentage: show the tokens in use.
  if (size <= 0) {
    return (
      // A named image, not a live region: each usage update is not announced.
      <span role="img" aria-label={`Context used: ${COMPACT_NUMBER.format(used)} tokens`} title={`Context: ${tokens(used)}`}>
        {COMPACT_NUMBER.format(used)} tokens
      </span>
    );
  }
  const percent = Math.min(100, Math.round((used / size) * 100));
  return (
    <span
      role="meter"
      aria-label="Context used"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      title={`Context: ${used.toLocaleString("en-US")} of ${tokens(size)} (${percent}%)`}
      // Plain words, as the canvas draws it; the colour still warns as the window fills.
      className={`tabular-nums ${toneFor(percent)}`}
    >
      {percent}% of context
    </span>
  );
}

/** How full the agent's context window is; a click shows the numbers behind it. */
export function ContextMeter({ used, size, cost }: ContextUsage) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismiss(containerRef, isOpen, () => setIsOpen(false));
  const hasWindow = size > 0;
  const percent = hasWindow ? Math.min(100, Math.round((used / size) * 100)) : null;
  const rows: [string, string][] = [
    ["Used", tokens(used)],
    ...(hasWindow
      ? ([
          ["Context window", tokens(size)],
          ["Share used", `${percent}%`],
          ["Left", tokens(Math.max(0, size - used))],
        ] as [string, string][])
      : []),
    ...(cost ? ([["Session cost", money(cost)]] as [string, string][]) : []),
  ];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Context details"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="mr-2 rounded px-1 py-0.5 text-caption text-fg-subtle hover:bg-surface-hover focus-ring"
      >
        <Gauge used={used} size={size} />
      </button>
      {isOpen && (
        <div
          role="dialog"
          aria-label="Context usage"
          className="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-lg border border-border bg-surface-3 p-3 text-ui-sm shadow-popover"
        >
          <p className="mb-2 font-medium text-fg-secondary">Context usage</p>
          <dl className="space-y-1">
            {rows.map(([name, value]) => (
              <div key={name} className="flex justify-between gap-3">
                <dt className="text-fg-subtle">{name}</dt>
                <dd className="tabular-nums text-fg-secondary">{value}</dd>
              </div>
            ))}
          </dl>
          {percent !== null && percent >= WARN_AT && (
            <p className="mt-2 text-caption text-status-attention">
              The window is nearly full; the agent may summarize or drop older context.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
