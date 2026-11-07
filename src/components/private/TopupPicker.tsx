import { useState } from "react";
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
  /** Another action holds the top-up (a promo code is being redeemed). */
  isDisabled: boolean;
  onBuy: (usd: number) => void;
  onRetry: () => void;
}

/** Below this much stock, the packages may run out: say so before the user picks one. */
const LOW_STOCK_CREDITS = 2_500;
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
  const state = isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer";
  return (
    <label
      className={`flex flex-1 items-start gap-2.5 rounded-xl border border-border bg-surface-2 p-3.5 text-left has-[:checked]:border-border-strong has-[:checked]:bg-surface-hover ${state}`}
    >
      <input
        type="radio"
        name="private-package"
        className="focus-ring mt-1 size-3.5 shrink-0"
        checked={isChecked}
        disabled={isDisabled}
        onChange={onSelect}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg">{`$${pkg.usd}`}</span>{" "}
        <span className="text-ui-sm text-fg-secondary">{formatCredits(pkg.credits)}</span>{" "}
        {reason ? (
          <span className="text-ui-sm text-fg-subtle">{reason}</span>
        ) : (
          turns > 0 && <span className="text-ui-sm text-fg-subtle">{`≈ ${turns.toLocaleString("en-US")} turns`}</span>
        )}
      </span>
    </label>
  );
}

/**
 * The packages to buy, as a radio group. Picking one only shows what it costs: nothing is
 * created or opened until Pay.
 */
export function TopupPicker({ stock, models, modelsError, isDisabled, onBuy, onRetry }: TopupPickerProps) {
  const [selectedUsd, setSelectedUsd] = useState<number | null>(null);
  const packages = stock?.packages ?? [];
  const selected = packages.find((pkg) => pkg.usd === selectedUsd && pkg.available) ?? null;
  const model = models?.[0];
  const isLowStock = stock !== null && stock.availableCredits < LOW_STOCK_CREDITS;

  return (
    <div className="flex flex-col gap-3">
      {stock === null && <p className="text-ui-sm text-fg-subtle">Loading packages…</p>}
      {stock !== null && isLowStock && (
        <div className="flex flex-col gap-1">
          <p className="text-ui-sm text-fg-secondary">{`Stock: ${formatCredits(stock.availableCredits)} · more coming soon`}</p>
          <p className="text-ui-sm text-fg-subtle">
            Stock is checked before checkout, so you never pay for credits that aren't there.
          </p>
        </div>
      )}
      <div role="radiogroup" aria-label="Package" className="flex flex-wrap gap-2.5">
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
      {modelsError && (
        <p className="text-ui-sm text-fg-muted">
          {modelsError}{" "}
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
        <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-1 p-3.5">
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
