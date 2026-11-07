import type { Config } from "../config";
import { creditsFromNano, spendLimitNano } from "../credits";
import { encrypt } from "../crypto";
import type { NearAiClient } from "../nearai";
import type { TopupStatus } from "./status";

/**
 * The Ledger's alarm (spec 7.5, 7.6): the operator token, the stock snapshot, the PingPay poll,
 * the expiry sweep, the FIFO promotion, the credit queue and the operator alerts. The Ledger owns
 * the state; these functions reach it through a `FulfilmentContext`.
 */

export type AlertKind = "refresh_failed" | "low_stock" | "stuck_queue" | "attempts_exhausted" | "payment_mismatch";
/** What a PingPay session comes to; `retry` and `mismatch` change nothing and are tried again later. */
export type SessionOutcome = "paid" | "expired" | "nothing" | "retry" | "mismatch";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const ALARM_INTERVAL_MS = MINUTE_MS;
/** A snapshot older than this is refreshed by the alarm and before a reservation. */
export const SNAPSHOT_MAX_AGE_MS = 2 * MINUTE_MS;
/** A `created` top-up is polled once its webhook is this late. */
const POLL_CREATED_AFTER_MS = 2 * MINUTE_MS;
/** An `expired` top-up is polled for a late payment for this long. */
const POLL_EXPIRED_FOR_MS = 7 * 24 * HOUR_MS;
const BACKOFF_FIRST_MS = 30 * 1000;
const BACKOFF_MAX_MS = 30 * MINUTE_MS;
/** The failure that raises `attempts_exhausted`; the item stays and keeps retrying. */
const MAX_ATTEMPTS = 10;
export const PENDING_KEY_TTL_MS = 24 * HOUR_MS;
const STUCK_AFTER_MS = HOUR_MS;
/** Stock below $3 of NEAR AI cost raises `low_stock` (spec 7.6). */
const LOW_STOCK_NANO = 3_000_000_000n;

export interface FulfilmentContext {
  readonly sql: SqlStorage;
  transaction(body: () => void): void;
  config(): Config;
  nearAi(): NearAiClient;
  accessToken(now: number): Promise<string>;
  withAccessToken<T>(now: number, call: (access: string) => Promise<T>): Promise<T>;
  keyEncryptionKey(): string;
  snapshotTakenAt(): number;
  refreshSnapshot(now: number): Promise<void>;
  availableCredits(now: number, ignoreWaiting?: boolean): number;
  onSessionEvent(sessionId: string, eventId: null, now: number): Promise<SessionOutcome>;
  move(topupId: string, to: TopupStatus, now: number): boolean;
  /** Moves a top-up to `paid`, holds its stock until it is credited and queues one `credit`. */
  holdForCredit(topupId: string, now: number): boolean;
  releaseReservation(topupId: string): void;
  alert(kind: AlertKind, detail: string): Promise<void>;
  /** `alert`, at most once an hour for each `kind` and `subject`. */
  alertOnce(kind: AlertKind, subject: string, detail: string, now: number): Promise<void>;
}

/** An error as `Name: message`. The clients' messages name the request and status, never a token or key. */
export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The wait before attempt `attempts + 1`: 30 s × 2^(attempts − 1), at most 30 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, attempts - 1));
}

/** Runs every step in order. A step that fails is logged and the next one still runs. */
export async function runAlarm(ctx: FulfilmentContext, now: number): Promise<void> {
  const steps: [string, () => Promise<void> | void][] = [
    ["token refresh", () => refreshToken(ctx, now)],
    ["snapshot refresh", () => refreshStock(ctx, now)],
    ["session poll", () => pollSessions(ctx, now)],
    ["expiry sweep", () => sweepExpired(ctx, now)],
    ["promotion", () => promoteWaiting(ctx, now)],
    ["credit queue", () => runCreditQueue(ctx, now)],
    ["stuck queue check", () => alertStuckItems(ctx, now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.error(`Alarm step ${name} failed: ${describeError(error)}`);
    }
  }
}

/** The cached token is kept while it is fresh; `accessToken` renews it on the 30-minute cadence. */
async function refreshToken(ctx: FulfilmentContext, now: number): Promise<void> {
  try {
    await ctx.accessToken(now);
  } catch (error) {
    await ctx.alertOnce("refresh_failed", "token", `operator token refresh failed: ${describeError(error)}`, now);
  }
}

async function refreshStock(ctx: FulfilmentContext, now: number): Promise<void> {
  if (now - ctx.snapshotTakenAt() <= SNAPSHOT_MAX_AGE_MS) return;
  try {
    await ctx.refreshSnapshot(now);
  } catch (error) {
    await ctx.alertOnce("refresh_failed", "snapshot", `stock snapshot refresh failed: ${describeError(error)}`, now);
    return;
  }
  const available = ctx.availableCredits(now);
  if (available < creditsFromNano(LOW_STOCK_NANO, ctx.config())) {
    await ctx.alertOnce("low_stock", "stock", `${available} credits left to sell`, now);
  }
}

/**
 * Asks PingPay about checkouts whose webhook may never come: `created` top-ups older than 2 minutes,
 * and `expired` ones younger than 7 days, whose payment may still arrive late. An unsettled session
 * is simply asked again on the next tick.
 */
async function pollSessions(ctx: FulfilmentContext, now: number): Promise<void> {
  const open = ctx.sql
    .exec<{ id: string; ping_session_id: string }>(
      `SELECT id, ping_session_id FROM topups
       WHERE ping_session_id IS NOT NULL
         AND ((status = 'created' AND created_at < ?) OR (status = 'expired' AND created_at > ?))
       ORDER BY created_at, id`,
      now - POLL_CREATED_AFTER_MS,
      now - POLL_EXPIRED_FOR_MS,
    )
    .toArray();
  for (const topup of open) {
    try {
      const outcome = await ctx.onSessionEvent(topup.ping_session_id, null, now);
      if (outcome === "mismatch") {
        const detail = `top-up ${topup.id} was paid with another amount or asset than its package; it is not credited`;
        await ctx.alertOnce("payment_mismatch", topup.id, detail, now);
      }
    } catch (error) {
      console.error(`Polling PingPay for top-up ${topup.id} failed: ${describeError(error)}`);
    }
  }
}

/**
 * Releases reservations past their time and deletes key secrets never collected. A paid top-up's
 * hold never expires (it is released by its credit), and the status check keeps it so regardless.
 */
function sweepExpired(ctx: FulfilmentContext, now: number): void {
  ctx.sql.exec(
    "DELETE FROM reservations WHERE expires_at <= ? AND topup_id NOT IN (SELECT id FROM topups WHERE status = 'paid')",
    now,
  );
  ctx.sql.exec("DELETE FROM pending_keys WHERE expires_at <= ?", now);
}

/**
 * Serves top-ups waiting for stock oldest first, stopping at the first that does not fit. The ones
 * waiting behind it do not count against it; a new reservation still counts all of them.
 */
function promoteWaiting(ctx: FulfilmentContext, now: number): void {
  const waiting = ctx.sql
    .exec<{ id: string; credits: number }>(
      "SELECT id, credits FROM topups WHERE status = 'paid_waiting_stock' ORDER BY updated_at, created_at, id",
    )
    .toArray();
  for (const topup of waiting) {
    if (topup.credits > ctx.availableCredits(now, true)) return;
    ctx.holdForCredit(topup.id, now);
  }
}

async function runCreditQueue(ctx: FulfilmentContext, now: number): Promise<void> {
  // Only kinds with a handler are taken; another kind is left as it is, attempts and all.
  const due = ctx.sql
    .exec<{ id: string }>("SELECT id FROM queue WHERE kind = 'credit' AND next_at <= ? ORDER BY next_at, id", now)
    .toArray();
  for (const { id } of due) await creditItem(ctx, id, now);
}

async function alertStuckItems(ctx: FulfilmentContext, now: number): Promise<void> {
  const stuck = ctx.sql
    .exec<{ id: string; kind: string; ref: string; attempts: number }>(
      "SELECT id, kind, ref, attempts FROM queue WHERE created_at IS NOT NULL AND created_at < ? ORDER BY created_at, id",
      now - STUCK_AFTER_MS,
    )
    .toArray();
  for (const item of stuck) {
    const detail = `queue item ${item.kind} for ${item.ref} has waited over an hour (${item.attempts} attempts)`;
    await ctx.alertOnce("stuck_queue", item.id, detail, now);
  }
}

type Claim = {
  itemId: string;
  topupId: string;
  deviceId: string;
  attempts: number;
  /** The device's key when the item was claimed. */
  keyId: string | null;
  /** The device's `credits_bought` the limit is set from. */
  creditsBought: number;
};

type Upstream = { created: boolean; keyId: string; ciphertext?: string; limitNano: bigint };

/**
 * One `credit` item (spec 7.5, races 5 and 7): claim it, call NEAR AI, then write the result from
 * rows read again after the call. Any failure leaves the item for its `next_at`.
 */
async function creditItem(ctx: FulfilmentContext, itemId: string, now: number): Promise<void> {
  const claim = claimCredit(ctx, itemId, now);
  if (!claim) return;
  try {
    const upstream = await setLimitUpstream(ctx, claim, now);
    await recordCredit(ctx, claim, upstream, now);
  } catch (error) {
    console.error(`Credit for top-up ${claim.topupId} failed on attempt ${claim.attempts}: ${describeError(error)}`);
    if (claim.attempts === MAX_ATTEMPTS) {
      const detail = `credit for top-up ${claim.topupId} failed ${MAX_ATTEMPTS} times; it keeps retrying every 30 minutes`;
      await ctx.alert("attempts_exhausted", detail);
    }
  }
}

/**
 * Marks the item before anything is called (race 8): one more attempt, the next try pushed out,
 * and on the first attempt only, the credits added to the device. One synchronous block.
 */
function claimCredit(ctx: FulfilmentContext, itemId: string, now: number): Claim | null {
  const item = ctx.sql
    .exec<{ ref: string; attempts: number; next_at: number; counted: number }>(
      "SELECT ref, attempts, next_at, counted FROM queue WHERE id = ? AND kind = 'credit'",
      itemId,
    )
    .toArray()[0];
  if (!item || item.next_at > now) return null;
  const topup = ctx.sql
    .exec<{ device_id: string; credits: number; status: TopupStatus }>("SELECT device_id, credits, status FROM topups WHERE id = ?", item.ref)
    .toArray()[0];
  if (topup?.status === "credited") {
    ctx.sql.exec("DELETE FROM queue WHERE id = ?", itemId);
    return null;
  }
  if (topup?.status !== "paid") return null;
  const deviceKnown = ctx.sql.exec("SELECT 1 FROM devices WHERE id = ?", topup.device_id).toArray().length > 0;
  if (!deviceKnown) return null;

  const attempts = item.attempts + 1;
  ctx.transaction(() => {
    ctx.sql.exec("UPDATE queue SET attempts = ?, next_at = ?, counted = 1 WHERE id = ?", attempts, now + backoffMs(attempts), itemId);
    if (item.counted === 0) {
      // While this item is in flight its credits count twice: here in credits_bought and in the
      // top-up's reservation, held until the credit succeeds. That is the safe side: the stock and
      // the device's room read less than they are, so nothing is sold twice.
      ctx.sql.exec("UPDATE devices SET credits_bought = credits_bought + ? WHERE id = ?", topup.credits, topup.device_id);
    }
  });
  const device = ctx.sql
    .exec<{ nearai_key_id: string | null; credits_bought: number }>("SELECT nearai_key_id, credits_bought FROM devices WHERE id = ?", topup.device_id)
    .one();
  return {
    itemId,
    topupId: item.ref,
    deviceId: topup.device_id,
    attempts,
    keyId: device.nearai_key_id,
    creditsBought: device.credits_bought,
  };
}

/**
 * Sets the device's limit to the absolute total (race 5): a new key for a device without one, else
 * a PATCH, which is safe to repeat. `createKey` is not retried on a refused token, since a second
 * create is not obviously safe; the key secret is encrypted before anything is written.
 */
async function setLimitUpstream(ctx: FulfilmentContext, claim: Claim, now: number): Promise<Upstream> {
  const cfg = ctx.config();
  const client = ctx.nearAi();
  const limitNano = spendLimitNano(claim.creditsBought, cfg);
  if (claim.keyId !== null) {
    const keyId = claim.keyId;
    await ctx.withAccessToken(now, (access) => client.setSpendLimit(access, cfg.workspaceId, keyId, limitNano));
    return { created: false, keyId, limitNano };
  }
  // The encryption key is tried first, so a bad one fails before a key exists upstream.
  const keyB64 = ctx.keyEncryptionKey();
  await encrypt(keyB64, "");
  const access = await ctx.accessToken(now);
  const created = await client.createKey(access, cfg.workspaceId, `zorvo-${claim.deviceId}`, limitNano);
  return { created: true, keyId: created.id, ciphertext: await encrypt(keyB64, created.key), limitNano };
}

/**
 * Writes the result from the rows as they are now (race 7). A created key and its pending secret
 * are stored together; the credit completes only when the device's total is still the one sent,
 * else the item stays and its retry sends the new total.
 */
async function recordCredit(ctx: FulfilmentContext, claim: Claim, upstream: Upstream, now: number): Promise<void> {
  const device = ctx.sql
    .exec<{ nearai_key_id: string | null; credits_bought: number }>("SELECT nearai_key_id, credits_bought FROM devices WHERE id = ?", claim.deviceId)
    .toArray()[0];
  if (!device) return;
  if (upstream.created && device.nearai_key_id !== null) {
    // The device got a key meanwhile: that one stays, the new one goes, and the retry PATCHes the kept one.
    await revokeQuietly(ctx, upstream.keyId, now);
    return;
  }
  if (!upstream.created && device.nearai_key_id !== upstream.keyId) return;

  ctx.transaction(() => {
    if (upstream.created && upstream.ciphertext !== undefined) {
      ctx.sql.exec("UPDATE devices SET nearai_key_id = ? WHERE id = ?", upstream.keyId, claim.deviceId);
      ctx.sql.exec(
        "INSERT OR REPLACE INTO pending_keys (device_id, key_ciphertext, expires_at) VALUES (?, ?, ?)",
        claim.deviceId,
        upstream.ciphertext,
        now + PENDING_KEY_TTL_MS,
      );
    }
    recordKeyLimit(ctx.sql, upstream.keyId, upstream.limitNano);
    if (device.credits_bought !== claim.creditsBought) return;
    ctx.sql.exec("DELETE FROM queue WHERE id = ?", claim.itemId);
    if (ctx.move(claim.topupId, "credited", now)) ctx.releaseReservation(claim.topupId);
  });
}

/**
 * Counts a key's new limit in the snapshot's outstanding amount at once. Without it, the released
 * reservation would show its stock as free until the next snapshot refresh.
 */
function recordKeyLimit(sql: SqlStorage, keyId: string, limitNano: bigint): void {
  const row = sql
    .exec<{ limit_nano: number | null; usage_nano: number | null }>("SELECT limit_nano, usage_nano FROM key_usage WHERE key_id = ?", keyId)
    .toArray()[0];
  const usage = BigInt(row?.usage_nano ?? 0);
  const left = (limit: bigint) => (limit > usage ? limit - usage : 0n);
  const before = row?.limit_nano == null ? 0n : left(BigInt(row.limit_nano));
  sql.exec(
    `INSERT INTO key_usage (key_id, limit_nano, usage_nano) VALUES (?, ?, ?)
     ON CONFLICT (key_id) DO UPDATE SET limit_nano = excluded.limit_nano`,
    keyId,
    Number(limitNano),
    Number(usage),
  );
  sql.exec("UPDATE snapshot SET outstanding_usd = MAX(0, outstanding_usd + ?) WHERE id = 1", Number(left(limitNano) - before));
}

async function revokeQuietly(ctx: FulfilmentContext, keyId: string, now: number): Promise<void> {
  try {
    const cfg = ctx.config();
    await ctx.nearAi().revokeKey(await ctx.accessToken(now), cfg.workspaceId, keyId);
  } catch (error) {
    console.error(`Revoking the extra NEAR AI key ${keyId} failed: ${describeError(error)}`);
  }
}
