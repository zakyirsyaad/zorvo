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

/** Credits left under a spend limit; never negative. */
export function balanceCredits(limitNano: bigint, usageNano: bigint, cfg: Config): number {
  const left = limitNano - usageNano;
  return creditsFromNano(left > 0n ? left : 0n, cfg);
}

/** A dollar amount in USDC base units (6 decimals), as the string PingPay takes. */
export function usdcAmount(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError("usd must be a finite, non-negative number");
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS)).toString();
}
