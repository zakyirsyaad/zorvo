import type { Config } from "../config";
import { creditsFromNano, spendLimitNano } from "../credits";

/** Credits are sold in steps of this size, so the stock shown is always a multiple of it. */
const STOCK_STEP_CREDITS = 100;

export type StockInput = {
  /** What the NEAR AI organization has left to spend, nano-USD. */
  orgRemainingNano: bigint;
  /** What the active keys may still spend, nano-USD. */
  outstandingNano: bigint;
  /** Credits held by reservations that have not expired. */
  reservedCredits: number;
  /** Credits of paid top-ups waiting for stock. */
  waitingCredits: number;
  /** Stock kept back from sale, nano-USD. */
  bufferNano: bigint;
};

export type PackageStock = {
  usd: number;
  credits: number;
  available: boolean;
  reason?: "stock" | "device_cap";
};

export type StockView = {
  availableCredits: number;
  yourRoomCredits: number;
  packages: PackageStock[];
  /** When the snapshot behind the stock was taken, ISO-8601. */
  updatedAt: string;
};

/**
 * Credits that can still be sold (spec 7.3): what the organization has left, minus what is already
 * promised (keys, reservations, paid top-ups waiting), minus the buffer, rounded down to a whole
 * hundred credits. Never negative.
 */
export function computeStock(input: StockInput, cfg: Config): { availableCredits: number } {
  const promised = spendLimitNano(input.reservedCredits + input.waitingCredits, cfg);
  const availableNano = input.orgRemainingNano - input.outstandingNano - promised - input.bufferNano;
  if (availableNano <= 0n) return { availableCredits: 0 };
  const credits = creditsFromNano(availableNano, cfg);
  return { availableCredits: Math.floor(credits / STOCK_STEP_CREDITS) * STOCK_STEP_CREDITS };
}
