import { useState } from "react";
import { Check } from "lucide-react";
import {
  formatCredits,
  packageReason,
  turnsFor,
  type ModelPrice,
  type Stock,
  type StockPackage,
} from "../../lib/private-credits";
import { Button } from "../ui/Button";

export interface TopupPickerProps {
  /** null until the stock answers. */
  stock: Stock | null;
  models: ModelPrice[] | null;
  modelsError?: string;
  stockError?: string;
  /** Another action holds the top-up (a promo code is being redeemed). */
  isDisabled: boolean;
  onBuy: (usd: number) => void;
  onRetry: () => void;
}

/** Below this much stock, the packages may run out: say so before the user picks one. */
export const LOW_STOCK_CREDITS = 2_500;
const NOT_AVAILABLE = "Not available right now";

function reasonOf(pkg: StockPackage): string | null {
  if (pkg.available) return null;
  return packageReason(pkg.reason) ?? NOT_AVAILABLE;
}

interface PackageOptionProps {
  pkg: StockPackage;
  turns: number;
  isChecked: boolean;
  isDisabled: boolean;
  onSelect: () => void;
}

function PackageOption({ pkg, turns, isChecked, isDisabled, onSelect }: PackageOptionProps) {
  const reason = reasonOf(pkg);
  const label = `$${pkg.usd}, ${formatCredits(pkg.credits)}${
    reason ? `, ${reason}` : turns > 0 ? `, about ${turns.toLocaleString("en-US")} turns` : ""
  }`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isChecked}
      aria-label={label}
      disabled={isDisabled}
      onClick={onSelect}
      className={`focus-ring relative flex flex-1 flex-col gap-0.5 rounded-xl border bg-surface-2 p-4 text-left disabled:cursor-default disabled:bg-surface-1 ${
        isChecked ? "border-2 border-fg" : "border-border"
      } ${isDisabled ? "cursor-default" : "cursor-pointer"}`}
    >
      {isChecked && (
        <Check size={14} strokeWidth={1.75} aria-hidden="true" className="absolute right-3 top-3 text-fg" />
      )}
      <span className={`text-lg leading-6 font-semibold ${isDisabled ? "text-fg-muted" : "text-fg"}`}>
        {`$${pkg.usd}`}
      </span>
      <span className={`text-ui-sm ${isDisabled ? "text-fg-muted" : "text-fg-secondary"}`}>
        {formatCredits(pkg.credits)}
      </span>
      {reason ? (
        <span className="text-ui-sm text-fg-subtle">{reason}</span>
      ) : (
        turns > 0 && <span className="text-ui-sm text-fg-subtle">{`≈ ${turns.toLocaleString("en-US")} turns`}</span>
      )}
    </button>
  );
}

/**
 * The packages to buy, as a radio group. Picking one only shows what it costs: nothing is
 * created or opened until Pay.
 */
export function TopupPicker({ stock, models, modelsError, stockError, isDisabled, onBuy, onRetry }: TopupPickerProps) {
  const [selectedUsd, setSelectedUsd] = useState<number | null>(null);
  const packages = stock?.packages ?? [];
  const selected = packages.find((pkg) => pkg.usd === selectedUsd && pkg.available) ?? null;
  const model = models?.[0];
  // One message and one retry: the stock is what the user needs first.
  const loadError = stockError ?? modelsError;

  return (
    <div className="flex flex-col gap-3">
      {stock === null && stockError === undefined && <p className="text-ui-sm text-fg-subtle">Loading packages…</p>}
      <div role="radiogroup" aria-label="Package" className="flex flex-wrap gap-3">
        {packages.map((pkg) => (
          <PackageOption
            key={pkg.usd}
            pkg={pkg}
            turns={model ? turnsFor(pkg.credits, model) : 0}
            isChecked={selected?.usd === pkg.usd}
            isDisabled={isDisabled || !pkg.available}
            onSelect={() => setSelectedUsd(pkg.usd)}
          />
        ))}
      </div>
      {loadError && (
        <p className="text-ui-sm text-fg-muted">
          {loadError}{" "}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm text-fg-secondary underline underline-offset-2 focus-ring"
          >
            Try again
          </button>
        </p>
      )}
      {selected && (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-ui font-medium text-fg">{`${formatCredits(selected.credits)} for $${selected.usd}`}</span>
            <span className="text-ui-sm text-fg-subtle">
              Checkout opens in your browser through PingPay. Pay with USDC from any chain, a wallet or a card. The
              credits are held for you for 25 minutes.
            </span>
          </div>
          <Button variant="primary" size="lg" disabled={isDisabled} onClick={() => onBuy(selected.usd)}>
            {`Pay $${selected.usd}`}
          </Button>
        </div>
      )}
      <p className="text-ui-sm text-fg-subtle">Credits can't be refunded or withdrawn.</p>
    </div>
  );
}
