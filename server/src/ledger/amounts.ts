/**
 * How the Ledger stores money and its one-row tables. SQLite hands an INTEGER back as a JS number,
 * so every nano-USD column holds at most 2^53 − 1 (about $9 million): each write goes through
 * `clampNano` (upstream amounts) or `storable` (amounts that must be exact), so every read is exact.
 */

/** The id of the one row of `snapshot`, `operator` and `limits_version`. */
export const SINGLE_ROW_ID = 1;
export const MAX_STORABLE_NANO = BigInt(Number.MAX_SAFE_INTEGER);

/** Brings an upstream amount into the range SQLite reads back exactly, so one odd value cannot stop updates. */
export function clampNano(nano: bigint): bigint {
  if (nano < 0n) return 0n;
  return nano > MAX_STORABLE_NANO ? MAX_STORABLE_NANO : nano;
}

/** An amount that must be stored exactly, as the number SQLite takes; anything else throws. */
export function storable(nano: bigint): number {
  const value = Number(nano);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("amount must be a whole, non-negative number below 2^53");
  return value;
}
