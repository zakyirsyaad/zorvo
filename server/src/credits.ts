import type { Config } from "./config";

const NANO_PER_USD = 1_000_000_000n;
const USDC_DECIMALS = 6;

/** Credits a user gets for paying `usd` dollars. */
export function creditsForPackage(usd: number, cfg: Config): number {
  return Math.round(usd * cfg.creditsPerUsdPaid);
}

/** The NEAR AI spend limit for credits bought, in nano-USD. Rounds down, so a user never gets more than they paid for. */
export function spendLimitNano(creditsBought: number, cfg: Config): bigint {
  return (BigInt(creditsBought) * NANO_PER_USD) / BigInt(cfg.burnPerUsdCost);
}

/** Whole credits that `nano` nano-USD of NEAR AI cost corresponds to, rounded down. */
export function creditsFromNano(nano: bigint, cfg: Config): number {
  return Number((nano * BigInt(cfg.burnPerUsdCost)) / NANO_PER_USD);
}

/**
 * Whole credits left of `creditsBought` after `usageNano` of NEAR AI cost. The used part rounds up,
 * so the result is never more than the user really has left (0.99 of a credit used costs a credit).
 */
export function creditsLeft(creditsBought: number, usageNano: bigint, cfg: Config): number {
  const used = (usageNano * BigInt(cfg.burnPerUsdCost) + NANO_PER_USD - 1n) / NANO_PER_USD;
  const left = BigInt(creditsBought) - used;
  return left > 0n ? Number(left) : 0;
}

/** Credits left under a spend limit; never negative. */
export function balanceCredits(limitNano: bigint, usageNano: bigint, cfg: Config): number {
  const left = limitNano - usageNano;
  return creditsFromNano(left > 0n ? left : 0n, cfg);
}

/** A non-negative decimal with at most `USDC_DECIMALS` places, as JavaScript writes the number. */
const USD_DECIMAL = new RegExp(`^([0-9]+)(?:\\.([0-9]{1,${USDC_DECIMALS}}))?$`);

/**
 * A dollar amount in USDC base units (6 decimals), as the string PingPay takes. Worked out on the
 * number's decimal digits, never by a float multiplication; an amount finer than one base unit is
 * refused, not rounded.
 */
export function usdcAmount(usd: number): string {
  const digits = Number.isFinite(usd) && usd >= 0 ? USD_DECIMAL.exec(String(usd)) : null;
  if (!digits) throw new RangeError("usd must be a non-negative amount with at most 6 decimals");
  const fraction = (digits[2] ?? "").padEnd(USDC_DECIMALS, "0");
  return (BigInt(digits[1]!) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction)).toString();
}
