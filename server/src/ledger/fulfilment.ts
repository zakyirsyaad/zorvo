import type { Config } from "../config";
import { creditsFromNano, creditsLeft, spendLimitNano } from "../credits";
import { encrypt } from "../crypto";
import { NearAiError, type ListedKey, type NearAiClient } from "../nearai";
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "../time";
import { clampNano, SINGLE_ROW_ID } from "./amounts";
import { RESERVATION_GRACE_MS, RESERVATION_MS } from "./checkout";
import type { SessionOutcome, TopupStatus } from "./status";

/**
 * The Ledger's alarm (spec 7.5, 7.6): the operator token, the stock snapshot, the PingPay poll,
 * the expiry sweep, the FIFO promotion, the queue (credits, key rotations, revokes) and the operator alerts. The Ledger owns
 * the state; these functions reach it through a `FulfilmentContext`.
 */

export type AlertKind = "refresh_failed" | "low_stock" | "stuck_queue" | "attempts_exhausted" | "payment_mismatch" | "credit_absorbed";

export const ALARM_INTERVAL_MS = MINUTE_MS;
/** A snapshot older than this is refreshed by the alarm and before a reservation. */
export const SNAPSHOT_MAX_AGE_MS = 2 * MINUTE_MS;
/** A `created` top-up is polled once its webhook is this late. */
const POLL_CREATED_AFTER_MS = 2 * MINUTE_MS;
/** A top-up is polled for a (late) payment for this long after it was created. */
const POLL_FOR_MS = 7 * 24 * HOUR_MS;
/**
 * What one queue item may spend after it starts, counted from a worst-case `rotate_key`: two key
 * listings (2), the freeze PATCH (1), a create (1), revoking the replaced key (1), an orphan revoke
 * (1), a mid-item token refresh and its 401 retry (2), one more key-list page on a workspace over
 * 100 keys (1), and the `stuck queue check` alert that follows the queue (1). Reserving 10 keeps a
 * started item and that alert inside the Free plan's 50 subrequests.
 */
const ITEM_RESERVE = 10;
/** A session poll reads the session and, when it is completed, its payment: two fetches. */
const POLL_RESERVE = 2;
/** A checkout that can still be paid is asked about this often; one that cannot backs off from here. */
const POLL_INTERVAL_MS = MINUTE_MS;
const POLL_MAX_INTERVAL_MS = HOUR_MS;
const BACKOFF_FIRST_MS = 30 * SECOND_MS;
const BACKOFF_MAX_MS = 30 * MINUTE_MS;
/** The failure that raises `attempts_exhausted`; the item stays and keeps retrying. */
const MAX_ATTEMPTS = 10;
export const PENDING_KEY_TTL_MS = 24 * HOUR_MS;
const STUCK_AFTER_MS = HOUR_MS;
/** A `stuck_queue` summary names at most this many items. */
const STUCK_LISTED = 5;
/** A `created` top-up whose hold ended this long ago is `expired` (it is no longer polled either). */
const ABANDONED_AFTER_MS = 7 * DAY_MS;
/** Rate-limit rows older than this are purged; every limiter's window is an hour or less. */
const RATELIMIT_KEEP_MS = DAY_MS;
/** Webhook event ids are kept this long for redelivery checks. */
const EVENTS_KEEP_MS = 30 * DAY_MS;
/** Stock below $3 of NEAR AI cost raises `low_stock` (spec 7.6). */
const LOW_STOCK_NANO = 3_000_000_000n;

export interface FulfilmentContext {
  readonly sql: SqlStorage;
  transaction(body: () => void): void;
  config(): Config;
  /** Outbound fetches this tick has made so far. */
  fetches(): number;
  /** The most outbound fetches a tick may spend before it stops starting new items. */
  subrequestBudget(): number;
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

/**
 * Runs every step in order. A step that fails is logged and the next one still runs. Every step uses
 * the tick's `now`: a slow tick (each call is capped at 15 s) only makes a later step see its expiries
 * and backoffs a little early or late, never a hold released while it is still due.
 */
export async function runAlarm(ctx: FulfilmentContext, now: number): Promise<void> {
  const steps: [string, () => Promise<void> | void][] = [
    ["token refresh", () => refreshToken(ctx, now)],
    ["snapshot refresh", () => refreshStock(ctx, now)],
    ["session poll", () => pollSessions(ctx, now)],
    ["expiry sweep", () => sweepExpired(ctx, now)],
    ["promotion", () => promoteWaiting(ctx, now)],
    ["queue", () => runQueue(ctx, now)],
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

/** Whether a tick that has made `ctx.fetches()` requests can start an item that may spend `reserve`. */
function hasRoomFor(ctx: FulfilmentContext, reserve: number): boolean {
  return ctx.fetches() + reserve <= ctx.subrequestBudget();
}

/**
 * Asks PingPay about checkouts whose webhook may never come: `created` top-ups older than 2 minutes
 * and `expired` ones, whose payment may still arrive late, for 7 days after they were created. At
 * most `POLLS_PER_TICK` sessions a tick (3 by default), the ones due longest first; each is then not
 * asked again until its `next_poll_at` (`nextPoll`). Stops starting sessions once the next poll's
 * two fetches would pass the tick's budget, leaving the rest due for the next tick.
 */
async function pollSessions(ctx: FulfilmentContext, now: number): Promise<void> {
  const due = ctx.sql
    .exec<{ id: string; ping_session_id: string }>(
      `SELECT id, ping_session_id FROM topups
       WHERE ping_session_id IS NOT NULL
         AND status IN ('created', 'expired')
         AND created_at > ?
         AND (status = 'expired' OR created_at < ?)
         AND COALESCE(next_poll_at, 0) <= ?
       ORDER BY COALESCE(next_poll_at, 0), id
       LIMIT ?`,
      now - POLL_FOR_MS,
      now - POLL_CREATED_AFTER_MS,
      now,
      ctx.config().pollsPerTick,
    )
    .toArray();
  for (const topup of due) {
    if (!hasRoomFor(ctx, POLL_RESERVE)) break;
    let outcome: SessionOutcome | "failed" = "failed";
    try {
      outcome = await ctx.onSessionEvent(topup.ping_session_id, null, now);
      if (outcome === "mismatch") {
        const detail = `top-up ${topup.id} was paid with another amount or asset than its package; it is not credited`;
        await ctx.alertOnce("payment_mismatch", topup.id, detail, now);
      }
    } catch (error) {
      console.error(`Polling PingPay for top-up ${topup.id} failed: ${describeError(error)}`);
    }
    nextPoll(ctx.sql, topup.id, outcome, now);
  }
}

/**
 * When to ask about a top-up's session again: in a minute while it is `created` and inside its
 * checkout window plus grace (`reserved_until`); in an hour after a mismatch, which needs the
 * operator anyway; otherwise after 1 minute × 2^polls, at most an hour.
 */
function nextPoll(sql: SqlStorage, topupId: string, outcome: SessionOutcome | "failed", now: number): void {
  const row = sql
    .exec<{ status: TopupStatus; reserved_until: number | null; polls: number }>(
      "SELECT status, reserved_until, polls FROM topups WHERE id = ?",
      topupId,
    )
    .toArray()[0];
  if (!row) return;
  const payable = row.status === "created" && row.reserved_until !== null && now < row.reserved_until;
  let delay = POLL_INTERVAL_MS;
  let polls = row.polls;
  if (outcome === "mismatch") delay = POLL_MAX_INTERVAL_MS;
  else if (!payable) {
    delay = Math.min(POLL_MAX_INTERVAL_MS, POLL_INTERVAL_MS * 2 ** row.polls);
    polls += 1;
  }
  sql.exec("UPDATE topups SET next_poll_at = ?, polls = ? WHERE id = ?", now + delay, polls, topupId);
}

/** A `created` top-up still without a checkout session this long after it was made never got one. */
const NO_CHECKOUT_AFTER_MS = RESERVATION_MS + RESERVATION_GRACE_MS;

/**
 * Releases reservations past their time and deletes key secrets never collected. A paid top-up's
 * hold never expires (it is released by its credit), and the status check keeps it so regardless.
 * A `created` top-up whose hold ended over 7 days ago becomes `expired`; one that never got a
 * checkout session (its request died while PingPay was asked) is `failed` once its hold has passed,
 * since no payment can ever be matched to it. Rate-limit windows older than a day (every limiter's
 * window is at most an hour) and event ids older than 30 days go.
 */
function sweepExpired(ctx: FulfilmentContext, now: number): void {
  ctx.sql.exec(
    "DELETE FROM reservations WHERE expires_at <= ? AND topup_id NOT IN (SELECT id FROM topups WHERE status = 'paid')",
    now,
  );
  // Only an open checkout (`created`) or a paid top-up waiting for its credit holds stock; a hold
  // left behind by anything else (a finished or missing top-up) would keep its stock forever.
  ctx.sql.exec("DELETE FROM reservations WHERE topup_id NOT IN (SELECT id FROM topups WHERE status IN ('created', 'paid'))");
  ctx.sql.exec("DELETE FROM pending_keys WHERE expires_at <= ?", now);
  const abandoned = ctx.sql
    .exec<{ id: string }>(
      "SELECT id FROM topups WHERE status = 'created' AND ping_session_id IS NOT NULL AND COALESCE(reserved_until, created_at) < ?",
      now - ABANDONED_AFTER_MS,
    )
    .toArray();
  for (const { id } of abandoned) {
    if (ctx.move(id, "expired", now)) ctx.releaseReservation(id);
  }
  const neverOpened = ctx.sql
    .exec<{ id: string }>("SELECT id FROM topups WHERE status = 'created' AND ping_session_id IS NULL AND created_at < ?", now - NO_CHECKOUT_AFTER_MS)
    .toArray();
  for (const { id } of neverOpened) {
    if (ctx.move(id, "failed", now)) ctx.releaseReservation(id);
  }
  ctx.sql.exec("DELETE FROM ratelimits WHERE window_start < ?", now - RATELIMIT_KEEP_MS);
  ctx.sql.exec("DELETE FROM events WHERE received_at < ?", now - EVENTS_KEEP_MS);
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

/** Queue kinds that have a handler; an item of any other kind is left as it is, attempts and all. */
const QUEUE_KINDS = ["credit", "rotate_key", "revoke_key"];

/**
 * Runs the due items one at a time, so a `credit` and a `rotate_key` of one device never overlap. A
 * credit of a device with a rotation queued is not selected at all (it waits for the rotation), so
 * such credits cannot fill the tick's `CREDITS_PER_TICK` and hold back other devices' credits.
 * Stops starting items once the next item's worst case (`ITEM_RESERVE`) would pass the tick's
 * budget, leaving the rest due for the next tick.
 */
async function runQueue(ctx: FulfilmentContext, now: number): Promise<void> {
  const placeholders = QUEUE_KINDS.map(() => "?").join(", ");
  const due = ctx.sql
    .exec<{ id: string; kind: string }>(
      `SELECT id, kind FROM queue WHERE kind IN (${placeholders}) AND next_at <= ?
         AND NOT (kind = 'credit' AND EXISTS (
           SELECT 1 FROM topups t JOIN queue r ON r.kind = 'rotate_key' AND r.ref = t.device_id WHERE t.id = queue.ref))
       ORDER BY next_at, id LIMIT ?`,
      ...QUEUE_KINDS,
      now,
      ctx.config().creditsPerTick,
    )
    .toArray();
  for (const { id, kind } of due) {
    if (!hasRoomFor(ctx, ITEM_RESERVE)) break;
    if (kind === "credit") await creditItem(ctx, id, now);
    else if (kind === "rotate_key") await rotateItem(ctx, id, now);
    else await revokeItem(ctx, id, now);
  }
}

/** One `stuck_queue` alert an hour for every item older than an hour, naming the oldest five. */
async function alertStuckItems(ctx: FulfilmentContext, now: number): Promise<void> {
  const stuck = ctx.sql
    .exec<{ kind: string; ref: string; attempts: number }>(
      "SELECT kind, ref, attempts FROM queue WHERE created_at IS NOT NULL AND created_at < ? ORDER BY created_at, id",
      now - STUCK_AFTER_MS,
    )
    .toArray();
  if (stuck.length === 0) return;
  const listed = stuck.slice(0, STUCK_LISTED).map((item) => `${item.kind} for ${item.ref} (${item.attempts} attempts)`);
  const more = stuck.length > STUCK_LISTED ? `, and ${stuck.length - STUCK_LISTED} more` : "";
  const noun = stuck.length === 1 ? "queue item has" : "queue items have";
  await ctx.alertOnce("stuck_queue", "queue", `${stuck.length} ${noun} waited over an hour: ${listed.join(", ")}${more}`, now);
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
  if (claim && "absorbed" in claim) {
    const detail = `the credit for top-up ${claim.absorbed} was used up by the replaced key's overshoot; the device has no key and nothing was added`;
    await ctx.alert("credit_absorbed", detail);
    return;
  }
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
function claimCredit(ctx: FulfilmentContext, itemId: string, now: number): Claim | { absorbed: string } | null {
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
  // A credit would lift the spend limit of a key a rotation has frozen: it waits, untouched, for
  // the rotation and then lands on the new key.
  const rotating = ctx.sql.exec("SELECT 1 FROM queue WHERE kind = 'rotate_key' AND ref = ?", topup.device_id).toArray().length > 0;
  if (rotating) return null;

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
  if (device.credits_bought === 0) {
    absorbedCredit(ctx, itemId, item.ref, now);
    return { absorbed: item.ref };
  }
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
 * A counted credit that finds `credits_bought` at 0: a rotation that ran after it was counted found
 * nothing left, because the old key's overshoot used these credits too. There is no key to raise and
 * a limit of 0 must never be sent, so the item ends here and the top-up is `credited`; the caller
 * raises `credit_absorbed` so the operator can check the case (see the README).
 */
function absorbedCredit(ctx: FulfilmentContext, itemId: string, topupId: string, now: number): void {
  ctx.transaction(() => {
    ctx.sql.exec("DELETE FROM queue WHERE id = ?", itemId);
    ctx.move(topupId, "credited", now);
    ctx.releaseReservation(topupId);
  });
}

/**
 * Sets the device's limit to the absolute total (race 5): a new key for a device without one, else
 * a PATCH, which is safe to repeat. Both go through `withAccessToken`: a create refused with 401 made
 * no key, so retrying it once with a refreshed token cannot make two. The key secret is encrypted
 * before anything is written.
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
  await revokeOrphans(ctx, claim.deviceId, null, now);
  const created = await ctx.withAccessToken(now, (access) => client.createKey(access, cfg.workspaceId, `zorvo-${claim.deviceId}`, limitNano));
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
    // The credits are counted and the item is gone, so the hold goes whatever `move` says: a hold
    // kept for a top-up that is not `paid` would keep its stock forever.
    ctx.move(claim.topupId, "credited", now);
    ctx.releaseReservation(claim.topupId);
  });
}

/** Bumped by every `recordKeyLimit`; a snapshot refresh compares it before and after its calls. */
export function keyLimitsVersion(sql: SqlStorage): number {
  return sql.exec<{ version: number }>("SELECT version FROM limits_version WHERE id = ?", SINGLE_ROW_ID).toArray()[0]?.version ?? 0;
}

/**
 * Counts a key's new limit in the snapshot's outstanding amount at once. Without it, the released
 * reservation would show its stock as free until the next snapshot refresh. A refresh already in
 * flight sees the version change and does not overwrite it with an older key list.
 */
function recordKeyLimit(sql: SqlStorage, keyId: string, requestedNano: bigint): void {
  const limitNano = clampNano(requestedNano);
  sql.exec("INSERT INTO limits_version (id, version) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET version = version + 1", SINGLE_ROW_ID);
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
  sql.exec(
    "UPDATE snapshot SET outstanding_usd = MIN(?, MAX(0, outstanding_usd + ?)) WHERE id = ?",
    Number.MAX_SAFE_INTEGER,
    Number(left(limitNano) - before),
    SINGLE_ROW_ID,
  );
}

/** Revokes `keyId` (retried once on a refused token); a failure is logged, never thrown. */
async function revokeQuietly(ctx: FulfilmentContext, keyId: string, now: number): Promise<void> {
  try {
    await revokeUpstream(ctx, keyId, now);
  } catch (error) {
    console.error(`Revoking the unheld NEAR AI key ${keyId} failed: ${describeError(error)}`);
  }
}

/**
 * Revokes the device's orphan keys before a new one is made: keys named `zorvo-<deviceId>` that are
 * not `keep` (the key a rotation replaces, revoked by its own item) and are no device's key. They
 * come from a create whose answer was lost, or from an eviction between a create and its record, so
 * no one holds their secret; revoking them keeps the workspace from filling with them. `listed` is a
 * key list the caller has just read (a rotation's read after the freeze), else the list is read
 * here. A listing that fails throws, so no key is created without the check and the item retries;
 * a revoke that fails is logged and does not stop the creation: the next one tries again.
 */
async function revokeOrphans(
  ctx: FulfilmentContext,
  deviceId: string,
  keep: string | null,
  now: number,
  listed?: readonly ListedKey[],
): Promise<void> {
  const workspaceId = ctx.config().workspaceId;
  const keys = listed ?? (await ctx.withAccessToken(now, (access) => ctx.nearAi().listKeys(access, workspaceId)));
  const name = `zorvo-${deviceId}`;
  for (const key of keys) {
    if (key.name !== name || key.id === keep) continue;
    const held = ctx.sql.exec("SELECT 1 FROM devices WHERE nearai_key_id = ?", key.id).toArray().length > 0;
    if (!held) await revokeQuietly(ctx, key.id, now);
  }
}

/** DELETE on a key, with the access-token retry of `withAccessToken`; a revoke is safe to repeat. */
function revokeUpstream(ctx: FulfilmentContext, keyId: string, now: number): Promise<void> {
  const workspaceId = ctx.config().workspaceId;
  return ctx.withAccessToken(now, (access) => ctx.nearAi().revokeKey(access, workspaceId, keyId));
}

/** An old key is frozen at its usage, but never at 0, which a key might read as "no limit". */
const MIN_FROZEN_LIMIT_NANO = 1n;

/**
 * One `rotate_key` item (spec 7.5, Recovery): the device's secret is already replaced, so this
 * makes the key the new Mac will fetch and retires the old one. The device is read again here.
 */
async function rotateItem(ctx: FulfilmentContext, itemId: string, now: number): Promise<void> {
  const claim = claimRotate(ctx, itemId, now);
  if (!claim) return;
  let revokeItemId: string | null;
  try {
    revokeItemId = await rotateKey(ctx, claim.deviceId, itemId, now);
  } catch (error) {
    console.error(`Key rotation for device ${claim.deviceId} failed on attempt ${claim.attempts}: ${describeError(error)}`);
    if (claim.attempts === MAX_ATTEMPTS) {
      await ctx.alert("attempts_exhausted", `key rotation for device ${claim.deviceId} failed ${MAX_ATTEMPTS} times; it keeps retrying every 30 minutes`);
    }
    return;
  }
  // The rotation is done; the old key's revoke is its own item and logs its own failures.
  if (revokeItemId !== null) await revokeItem(ctx, revokeItemId, now);
}

/** Marks the item before anything is called. An item with nothing to rotate (no device, revoked, no key) is dropped. */
function claimRotate(ctx: FulfilmentContext, itemId: string, now: number): { deviceId: string; attempts: number } | null {
  const item = ctx.sql
    .exec<{ ref: string; attempts: number; next_at: number }>("SELECT ref, attempts, next_at FROM queue WHERE id = ? AND kind = 'rotate_key'", itemId)
    .toArray()[0];
  if (!item || item.next_at > now) return null;
  const device = ctx.sql
    .exec<{ nearai_key_id: string | null }>("SELECT nearai_key_id FROM devices WHERE id = ? AND revoked_at IS NULL", item.ref)
    .toArray()[0];
  if (!device?.nearai_key_id) {
    ctx.sql.exec("DELETE FROM queue WHERE id = ?", itemId);
    return null;
  }
  const attempts = item.attempts + 1;
  ctx.sql.exec("UPDATE queue SET attempts = ?, next_at = ? WHERE id = ?", attempts, now + backoffMs(attempts), itemId);
  return { deviceId: item.ref, attempts };
}

/**
 * Replaces the device's key (spec 7.5, Recovery). Every attempt starts by freezing the old key, so
 * nothing more can be spent on it, and reads its usage after that; the new key gets what was left
 * (`creditsLeft`, rounded down) and `credits_bought` becomes that remainder, so later absolute
 * totals stay right on the new key. With nothing left no key is made: the device ends without one
 * and its next credit creates one. Returns the `revoke_key` item queued for the old key, or null
 * when the rotation did not happen (the device changed meanwhile; the item stays for its retry).
 */
async function rotateKey(ctx: FulfilmentContext, deviceId: string, itemId: string, now: number): Promise<string | null> {
  const cfg = ctx.config();
  const before = readDevice(ctx.sql, deviceId);
  if (!before?.nearai_key_id) return null;
  const oldKeyId = before.nearai_key_id;

  const { usageNano, listed } = await freezeKey(ctx, oldKeyId, now);
  const remaining = creditsLeft(before.credits_bought, usageNano, cfg);

  let created: { id: string; ciphertext: string } | null = null;
  if (remaining > 0) {
    // The encryption key is tried first, so a bad one fails before a key exists upstream.
    const keyB64 = ctx.keyEncryptionKey();
    await encrypt(keyB64, "");
    await revokeOrphans(ctx, deviceId, oldKeyId, now, listed);
    const limitNano = spendLimitNano(remaining, cfg);
    const key = await ctx.withAccessToken(now, (access) => ctx.nearAi().createKey(access, cfg.workspaceId, `zorvo-${deviceId}`, limitNano));
    created = { id: key.id, ciphertext: await encrypt(keyB64, key.key) };
  }

  const after = readDevice(ctx.sql, deviceId);
  if (!after || after.nearai_key_id !== oldKeyId || after.credits_bought !== before.credits_bought) {
    if (created) await revokeQuietly(ctx, created.id, now);
    return null;
  }
  const revokeItemId = crypto.randomUUID();
  ctx.transaction(() => {
    ctx.sql.exec("UPDATE devices SET nearai_key_id = ?, credits_bought = ? WHERE id = ?", created?.id ?? null, remaining, deviceId);
    forgetKeyLimit(ctx.sql, oldKeyId);
    if (created) {
      ctx.sql.exec("INSERT OR REPLACE INTO pending_keys (device_id, key_ciphertext, expires_at) VALUES (?, ?, ?)", deviceId, created.ciphertext, now + PENDING_KEY_TTL_MS);
      recordKeyLimit(ctx.sql, created.id, spendLimitNano(remaining, cfg));
    } else {
      ctx.sql.exec("DELETE FROM pending_keys WHERE device_id = ?", deviceId);
    }
    ctx.sql.exec("DELETE FROM queue WHERE id = ?", itemId);
    ctx.sql.exec(
      "INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES (?, 'revoke_key', ?, 0, ?, ?)",
      revokeItemId,
      oldKeyId,
      now,
      now,
    );
  });
  return revokeItemId;
}

/**
 * Stops further spend on `keyId` and returns what it has used. The key's usage is read, its limit
 * is set to that (an absolute PATCH, safe to repeat; the key then refuses new requests; capped at
 * 2^53 − 1 nano-USD, which still freezes a key that used more), recorded at once so the outstanding
 * amount is right, and the usage is read again after the freeze. A key NEAR AI no longer knows (404)
 * cannot be spent on: the usage on record is taken. A key NEAR AI still knows (its PATCH worked)
 * but that neither list read showed has an unknown usage: the rotation fails and retries rather
 * than carry over a balance from a usage on record that may be stale.
 */
async function freezeKey(ctx: FulfilmentContext, keyId: string, now: number): Promise<{ usageNano: bigint; listed?: ListedKey[] }> {
  const cfg = ctx.config();
  const client = ctx.nearAi();
  let listed: ListedKey[] | undefined;
  const usageOf = async () => {
    listed = await ctx.withAccessToken(now, (access) => client.listKeys(access, cfg.workspaceId));
    return listed.find((key) => key.id === keyId)?.usageNano ?? null;
  };
  const stored = BigInt(ctx.sql.exec<{ usage_nano: number | null }>("SELECT usage_nano FROM key_usage WHERE key_id = ?", keyId).toArray()[0]?.usage_nano ?? 0);

  const first = await usageOf();
  const seen = clampNano(first ?? stored);
  const frozenAt = seen > MIN_FROZEN_LIMIT_NANO ? seen : MIN_FROZEN_LIMIT_NANO;
  try {
    await ctx.withAccessToken(now, (access) => client.setSpendLimit(access, cfg.workspaceId, keyId, frozenAt));
  } catch (error) {
    if (error instanceof NearAiError && error.status === 404) return { usageNano: first ?? stored };
    throw error;
  }
  ctx.transaction(() => recordKeyLimit(ctx.sql, keyId, frozenAt));
  const second = await usageOf();
  const read = [first, second].filter((usage): usage is bigint => usage !== null);
  if (read.length === 0) throw new Error(`NEAR AI's key list does not show key ${keyId}, so its usage is unknown`);
  // The list read after the freeze is handed on, so the orphan check before the create reads none of its own.
  return { usageNano: read.reduce((most, usage) => (usage > most ? usage : most)), listed };
}

function readDevice(sql: SqlStorage, deviceId: string): { nearai_key_id: string | null; credits_bought: number } | undefined {
  return sql
    .exec<{ nearai_key_id: string | null; credits_bought: number }>(
      "SELECT nearai_key_id, credits_bought FROM devices WHERE id = ? AND revoked_at IS NULL",
      deviceId,
    )
    .toArray()[0];
}

/** Takes a key that is no longer a device's out of the snapshot's outstanding amount and out of `key_usage`. */
function forgetKeyLimit(sql: SqlStorage, keyId: string): void {
  const row = sql.exec<{ limit_nano: number | null; usage_nano: number | null }>("SELECT limit_nano, usage_nano FROM key_usage WHERE key_id = ?", keyId).toArray()[0];
  if (!row) return;
  const left = row.limit_nano !== null && row.limit_nano > (row.usage_nano ?? 0) ? row.limit_nano - (row.usage_nano ?? 0) : 0;
  sql.exec("UPDATE snapshot SET outstanding_usd = MAX(0, outstanding_usd - ?) WHERE id = ?", left, SINGLE_ROW_ID);
  sql.exec("DELETE FROM key_usage WHERE key_id = ?", keyId);
}

/**
 * One `revoke_key` item: the key a rotation replaced. It is its own item so a failed revoke is
 * retried without touching the rotation. A key that is some device's current key is never revoked,
 * and a key NEAR AI no longer knows (404) counts as revoked.
 */
async function revokeItem(ctx: FulfilmentContext, itemId: string, now: number): Promise<void> {
  const item = ctx.sql
    .exec<{ ref: string; attempts: number; next_at: number }>("SELECT ref, attempts, next_at FROM queue WHERE id = ? AND kind = 'revoke_key'", itemId)
    .toArray()[0];
  if (!item || item.next_at > now) return;
  const inUse = ctx.sql.exec("SELECT 1 FROM devices WHERE nearai_key_id = ?", item.ref).toArray().length > 0;
  if (inUse) {
    ctx.sql.exec("DELETE FROM queue WHERE id = ?", itemId);
    return;
  }
  const attempts = item.attempts + 1;
  ctx.sql.exec("UPDATE queue SET attempts = ?, next_at = ? WHERE id = ?", attempts, now + backoffMs(attempts), itemId);
  try {
    await revokeUpstream(ctx, item.ref, now);
  } catch (error) {
    if (!(error instanceof NearAiError && error.status === 404)) {
      console.error(`Revoking the replaced NEAR AI key ${item.ref} failed on attempt ${attempts}: ${describeError(error)}`);
      if (attempts === MAX_ATTEMPTS) {
        await ctx.alert("attempts_exhausted", `revoking the replaced key ${item.ref} failed ${MAX_ATTEMPTS} times; it keeps retrying every 30 minutes`);
      }
      return;
    }
  }
  ctx.sql.exec("DELETE FROM queue WHERE id = ?", itemId);
}
