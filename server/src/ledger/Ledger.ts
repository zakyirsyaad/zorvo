import { DurableObject } from "cloudflare:workers";
import { SECRET_HASH } from "../auth";
import { parseConfig, type Config, type Env } from "../config";
import { creditsForPackage, creditsFromNano, spendLimitNano, usdcAmount } from "../credits";
import { decrypt } from "../crypto";
import { UPSTREAM_TIMEOUT_MS } from "../http";
import { HOUR_MS, MINUTE_MS, SECOND_MS } from "../time";
import { NearAiClient } from "../nearai";
import { PingPayClient } from "../pingpay";
import {
  balanceFor,
  loadModels,
  models,
  storedModels,
  storeModels,
  type BalanceContext,
  type BalanceView,
  type ModelInfo,
  type ModelsContext,
} from "./balance";
import {
  ALARM_INTERVAL_MS,
  describeError,
  keyLimitsVersion,
  pollOpenCheckouts,
  recordKeyLimit,
  runAlarm,
  SNAPSHOT_MAX_AGE_MS,
  type AlertKind,
  type FulfilmentContext,
} from "./fulfilment";
import { checkoutWindow, readSession, RESERVATION_MS } from "./checkout";
import { operatorSession, refreshOperator, withAccessToken, type OperatorContext, type OperatorSession } from "./operator";
import { promoRefusal, recoverDevice, redeemPromo, savePromo, type PromoContext, type PromoResult } from "./promo-recover";
import { clampNano, SINGLE_ROW_ID, storable } from "./amounts";
import { applySchema } from "./schema";
import {
  deviceLimitNano,
  endSessionsForDevice,
  insertSession,
  isSessionCap,
  queueEndSession,
  remainingCredits,
  sessionDebtNano,
  sessionRow,
  sessionRows,
  sessionUsageNano,
  SESSION_CAPS,
  type SessionCap,
  type SessionRow,
} from "./sessions";
import { canMove, type SessionOutcome, type TopupStatus } from "./status";
import { computeStock, type StockView } from "./stock";

/** The `expires_at` of a paid top-up's reservation: it holds the stock until the credit releases it. */
const HELD_UNTIL_CREDITED = Number.MAX_SAFE_INTEGER;

const SNAPSHOT_ID = SINGLE_ROW_ID;
/** A top-up is refused for stock when the snapshot is this old and cannot be refreshed. */
const SNAPSHOT_FAIL_CLOSED_MS = 10 * MINUTE_MS;
/** An alert POST gives up after this long, so a slow hook cannot hold the alarm. */
const ALERT_TIMEOUT_MS = 10 * SECOND_MS;

export type { BalanceView, ModelInfo } from "./balance";

/**
 * The only writer of money state. Every method runs its reads and writes synchronously (SQLite
 * calls are synchronous), so two requests can never interleave a read and a write.
 */
export class Ledger extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private parsedConfig: Config | undefined;
  private refreshing: Promise<OperatorSession> | undefined;
  private snapshotting: Promise<void> | undefined;
  /** The last model list and when it was read; memory in front of the `models_cache` row. */
  private modelsCache: { models: ModelInfo[]; at: number } | undefined;
  private modelsLoading: Promise<ModelInfo[]> | undefined;
  private ticking: Promise<void> | undefined;
  /**
   * One tail per device for every operation that PATCHes the device key. The Durable Object runs
   * one instance, so this serializes a credit, a rotation, a session start, raise or end that would
   * otherwise interleave two absolute PATCHes and leave the higher one last.
   */
  private deviceLocks = new Map<string, Promise<void>>();
  /** The alarm tick in flight: how many outbound fetches it has made, and the most it may spend. */
  private tickFetches: { count: number; budget: number } | undefined;
  /** The `fetch` used for NEAR AI and PingPay calls; tests replace it. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);
  /** How long one NEAR AI or PingPay request may take; tests shorten it. */
  requestTimeoutMs = UPSTREAM_TIMEOUT_MS;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => applySchema(this.sql));
  }

  /** Counts one hit on `key` in a fixed window and says whether it is within `limit`. */
  rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): { allowed: boolean } {
    const row = this.sql
      .exec<{ count: number; window_start: number }>("SELECT count, window_start FROM ratelimits WHERE key = ?", key)
      .toArray()[0];
    const fresh = row === undefined || now - row.window_start >= windowMs;
    const count = fresh ? 1 : row.count + 1;
    const windowStart = fresh ? now : row.window_start;
    this.sql.exec(
      `INSERT INTO ratelimits (key, count, window_start) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
      key,
      count,
      windowStart,
    );
    return { allowed: count <= limit };
  }

  /**
   * Runs `body` after every earlier device-key operation of `deviceId` has finished. The lock is
   * in memory only: the Durable Object is one instance, and an eviction aborts whatever it held,
   * so no two bodies can overlap on the same device.
   */
  async withDeviceLock<T>(deviceId: string, body: () => Promise<T>): Promise<T> {
    const previous = this.deviceLocks.get(deviceId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.deviceLocks.set(deviceId, tail);
    await previous;
    try {
      return await body();
    } finally {
      release();
      if (this.deviceLocks.get(deviceId) === tail) this.deviceLocks.delete(deviceId);
    }
  }

  /** Whether `key` has used up `limit` hits in its current window, without counting one. */
  private limitReached(key: string, limit: number, windowMs: number, now: number): boolean {
    const row = this.sql
      .exec<{ count: number; window_start: number }>("SELECT count, window_start FROM ratelimits WHERE key = ?", key)
      .toArray()[0];
    return row !== undefined && now - row.window_start < windowMs && row.count >= limit;
  }

  /** The check and the insert run before the first await, so one secret hash can never register twice. */
  async registerDevice(secretHash: string): Promise<{ deviceId: string } | { error: "bad_request" }> {
    if (!SECRET_HASH.test(secretHash)) return { error: "bad_request" };
    const taken = this.sql.exec("SELECT 1 FROM devices WHERE secret_hash = ?", secretHash).toArray().length > 0;
    if (taken) return { error: "bad_request" };
    const deviceId = crypto.randomUUID();
    this.sql.exec("INSERT INTO devices (id, secret_hash, created_at) VALUES (?, ?, ?)", deviceId, secretHash, Date.now());
    await this.ensureAlarm();
    return { deviceId };
  }

  /**
   * The device whose secret hashes to `secretHash`, or why not: a miss counts one hit on
   * `failureKey`, and once that passes `limit` in `windowMs` the answer is `rate_limited`. A device
   * that is found is never counted.
   */
  authenticate(
    secretHash: string,
    failureKey: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): { deviceId: string } | { error: "unauthorized" | "rate_limited" } {
    const device = this.deviceBySecretHash(secretHash);
    if (device) return { deviceId: device.id };
    return this.rateLimit(failureKey, limit, windowMs, now).allowed ? { error: "unauthorized" } : { error: "rate_limited" };
  }

  /** The device whose secret hashes to `secretHash`; a revoked device is not found. */
  deviceBySecretHash(secretHash: string): { id: string } | null {
    const row = this.sql
      .exec<{ id: string }>("SELECT id FROM devices WHERE secret_hash = ? AND revoked_at IS NULL", secretHash)
      .toArray()[0];
    return row ? { id: row.id } : null;
  }

  private config(): Config {
    this.parsedConfig ??= parseConfig(this.env);
    return this.parsedConfig;
  }

  private sum(query: string, ...bindings: (string | number)[]): number {
    return this.sql.exec<{ total: number }>(query, ...bindings).one().total;
  }

  /** Records what the NEAR AI organization and its keys looked like at `takenAt` (nano-USD). */
  setSnapshot(orgRemainingNano: bigint, outstandingNano: bigint, takenAt: number): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO snapshot (id, org_remaining_usd, outstanding_usd, taken_at) VALUES (?, ?, ?, ?)",
      SNAPSHOT_ID,
      storable(orgRemainingNano),
      storable(outstandingNano),
      takenAt,
    );
  }

  /** `ignoreWaiting` leaves out paid top-ups waiting for stock, for serving the oldest of them. */
  private availableCredits(now: number, ignoreWaiting = false): { availableCredits: number; takenAt: number } {
    const snapshot = this.sql
      .exec<{ org_remaining_usd: number; outstanding_usd: number; taken_at: number }>(
        "SELECT org_remaining_usd, outstanding_usd, taken_at FROM snapshot WHERE id = ?",
        SNAPSHOT_ID,
      )
      .toArray()[0];
    const { availableCredits } = computeStock(
      {
        orgRemainingNano: BigInt(snapshot?.org_remaining_usd ?? 0),
        outstandingNano: BigInt(snapshot?.outstanding_usd ?? 0),
        reservedCredits: this.sum("SELECT COALESCE(SUM(credits), 0) AS total FROM reservations WHERE expires_at > ?", now),
        waitingCredits: ignoreWaiting
          ? 0
          : this.sum("SELECT COALESCE(SUM(credits), 0) AS total FROM topups WHERE status = 'paid_waiting_stock'"),
        bufferNano: this.config().stockBufferNano,
      },
      this.config(),
    );
    return { availableCredits, takenAt: snapshot?.taken_at ?? 0 };
  }

  /**
   * How many more credits the device may buy or reserve before it reaches the per-device cap (spec:
   * balance plus active reservations at most the cap). The one calculation behind `stockFor` and
   * `reserve`: the credits it still holds (bought, minus what its key has used, never below 0),
   * plus active reservations (a paid top-up's is held until credited), plus the device's paid
   * top-ups waiting for stock, which are in neither of the other two.
   */
  private roomCredits(deviceId: string, now: number): number {
    const device = this.sql
      .exec<{ credits_bought: number; nearai_key_id: string | null }>(
        "SELECT credits_bought, nearai_key_id FROM devices WHERE id = ?",
        deviceId,
      )
      .toArray()[0];
    if (!device) throw new Error("unknown device");
    const used = creditsFromNano(
      sessionUsageNano(this.sql, deviceId, device.nearai_key_id),
      this.config(),
    );
    const held = Math.max(0, device.credits_bought - used);
    const reserved = this.sum(
      "SELECT COALESCE(SUM(credits), 0) AS total FROM reservations WHERE device_id = ? AND expires_at > ?",
      deviceId,
      now,
    );
    const waiting = this.sum(
      "SELECT COALESCE(SUM(credits), 0) AS total FROM topups WHERE device_id = ? AND status = 'paid_waiting_stock'",
      deviceId,
    );
    return Math.max(0, this.config().deviceCapCredits - held - reserved - waiting);
  }

  /** What `deviceId` can buy right now (spec 7.3). The device cap is checked before the stock. */
  stockFor(deviceId: string, now: number = Date.now()): StockView {
    const cfg = this.config();
    const { availableCredits, takenAt } = this.availableCredits(now);
    const yourRoomCredits = this.roomCredits(deviceId, now);
    const packages = cfg.packagesUsd.map((usd) => {
      const credits = creditsForPackage(usd, cfg);
      if (credits > yourRoomCredits) return { usd, credits, available: false, reason: "device_cap" as const };
      if (credits > availableCredits) return { usd, credits, available: false, reason: "stock" as const };
      return { usd, credits, available: true };
    });
    return { availableCredits, yourRoomCredits, packages, updatedAt: new Date(takenAt).toISOString() };
  }

  /** The device's balance; with `fresh` the snapshot is refreshed first, within limits (see `balance.ts`). */
  balanceFor(deviceId: string, fresh = false, now: number = Date.now()): Promise<BalanceView> {
    return balanceFor(this.balanceContext(), deviceId, fresh, now);
  }

  /** The models users may pick, cached 10 minutes (see `balance.ts`). */
  models(now: number = Date.now()): Promise<{ models: ModelInfo[] } | { error: "upstream" }> {
    return models(this.modelsContext(), now);
  }

  private balanceContext(): BalanceContext {
    return {
      sql: this.sql,
      config: () => this.config(),
      rateLimit: (key, limit, windowMs, now) => this.rateLimit(key, limit, windowMs, now),
      snapshotTakenAt: () => this.snapshotTakenAt(),
      refreshSnapshotOnce: (now) => this.refreshSnapshotOnce(now),
    };
  }

  private modelsContext(): ModelsContext {
    const context: ModelsContext = {
      config: () => this.config(),
      nearAi: () => this.nearAi(),
      cachedModels: () => {
        this.modelsCache ??= storedModels(this.sql, this.config().models);
        return this.modelsCache;
      },
      rememberModels: (cache) => {
        this.modelsCache = cache;
        storeModels(this.sql, cache);
      },
      loadModelsOnce: () => {
        this.modelsLoading ??= loadModels(context).finally(() => {
          this.modelsLoading = undefined;
        });
        return this.modelsLoading;
      },
    };
    return context;
  }

  /**
   * Holds `credits` for the device for 30 minutes. The checks and both inserts run in one
   * synchronous block, so two callers can never both take the last stock or the last room.
   * It must stay synchronous: it must never become async or await anything, or that guarantee is gone.
   */
  reserve(deviceId: string, credits: number, packageUsd: number, now: number): { topupId: string } | { error: "stock" | "device_cap" } {
    if (!Number.isSafeInteger(credits) || credits <= 0) throw new RangeError("credits must be a positive whole number");
    if (credits > this.roomCredits(deviceId, now)) return { error: "device_cap" };
    if (credits > this.availableCredits(now).availableCredits) return { error: "stock" };
    const topupId = crypto.randomUUID();
    const reservedUntil = now + RESERVATION_MS;
    this.sql.exec(
      `INSERT INTO topups (id, device_id, package_usd, credits, status, reserved_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'created', ?, ?, ?)`,
      topupId,
      deviceId,
      packageUsd,
      credits,
      reservedUntil,
      now,
      now,
    );
    this.sql.exec(
      "INSERT INTO reservations (topup_id, device_id, credits, expires_at) VALUES (?, ?, ?, ?)",
      topupId,
      deviceId,
      credits,
      reservedUntil,
    );
    return { topupId };
  }

  /** When the stock snapshot was taken; 0 before the first one. */
  private snapshotTakenAt(): number {
    return this.sql.exec<{ taken_at: number }>("SELECT taken_at FROM snapshot WHERE id = ?", SNAPSHOT_ID).toArray()[0]?.taken_at ?? 0;
  }

  /** The previous refresh's result when one is in flight, so the alarm and a top-up do not both call NEAR AI. */
  private refreshSnapshotOnce(now: number): Promise<void> {
    this.snapshotting ??= this.refreshSnapshot(now).finally(() => {
      this.snapshotting = undefined;
    });
    return this.snapshotting;
  }

  /**
   * Makes the snapshot fresh enough to sell from (spec 7.3): one older than 2 minutes is refreshed
   * first. When that fails, a snapshot under 10 minutes old is still used; an older one is not.
   */
  private async stockIsCurrent(now: number): Promise<boolean> {
    const age = now - this.snapshotTakenAt();
    if (age <= SNAPSHOT_MAX_AGE_MS) return true;
    try {
      await this.refreshSnapshotOnce(now);
      return true;
    } catch (error) {
      console.error(`Stock snapshot refresh before a top-up failed: ${describeError(error)}`);
      return age <= SNAPSHOT_FAIL_CLOSED_MS;
    }
  }

  /** Gives a reservation's credits back to the stock and to the device's room. */
  releaseReservation(topupId: string): void {
    this.sql.exec("DELETE FROM reservations WHERE topup_id = ?", topupId);
  }

  private secret(name: "KEY_ENCRYPTION_KEY" | "OPERATOR_REFRESH_TOKEN" | "PINGPAY_API_KEY"): string {
    const value = this.env[name];
    if (value === undefined || value === "") throw new Error(`Missing secret ${name}`);
    return value;
  }

  private pingPay(): PingPayClient {
    return new PingPayClient(this.config().pingPayBase, this.secret("PINGPAY_API_KEY"), (input, init) => this.fetchOut(input, init), this.requestTimeoutMs);
  }

  private nearAi(): NearAiClient {
    return new NearAiClient(this.config().nearAiBase, (input, init) => this.fetchOut(input, init), this.requestTimeoutMs);
  }

  /** Makes an outbound fetch, counting it against the alarm tick in flight when there is one. */
  private fetchOut(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.tickFetches) this.tickFetches.count += 1;
    return this.fetcher(input, init);
  }

  /**
   * A NEAR AI access token for the operator. The cached one is used while it has more than a minute
   * left; otherwise it is refreshed, with at most one refresh in flight, because every refresh
   * spends the refresh token (spec 7.5, race 6). See `operator.ts`.
   */
  async accessToken(now: number): Promise<string> {
    return (await operatorSession(this.operator(), now)).token;
  }

  /** Runs an operator call with the cached access token, retried once after a 401 (see `operator.ts`). */
  private withAccessToken<T>(now: number, call: (access: string) => Promise<T>): Promise<T> {
    return withAccessToken(this.operator(), now, call);
  }

  private operator(): OperatorContext {
    const context: OperatorContext = {
      sql: this.sql,
      env: this.env,
      secret: (name) => this.secret(name),
      nearAi: () => this.nearAi(),
      refreshOnce: (now) => {
        this.refreshing ??= refreshOperator(context, now).finally(() => {
          this.refreshing = undefined;
        });
        return this.refreshing;
      },
    };
    return context;
  }

  /**
   * Reads the organization balance and the device keys from NEAR AI and records them: the stock
   * snapshot, and each device key's limit and usage in `key_usage`. The device list is read after
   * the calls, so a key created meanwhile is not mistaken for a stranger's. The replacement of
   * `key_usage` and the snapshot is one transaction: either both change or neither does.
   *
   * When a credit recorded a key's new limit while the calls were out (race 7), the key list read
   * is older than that limit: only the organization balance is taken, the recorded key amounts are
   * kept, and `taken_at` is left alone so the next tick refreshes again.
   */
  async refreshSnapshot(now: number): Promise<void> {
    const cfg = this.config();
    const client = this.nearAi();
    const limitsBefore = keyLimitsVersion(this.sql);
    const { remaining, keys } = await this.withAccessToken(now, async (access) => ({
      remaining: await client.orgRemainingNano(access, cfg.organizationId),
      keys: await client.listKeys(access, cfg.workspaceId),
    }));

    const deviceKeys = new Set(
      this.sql
        .exec<{ nearai_key_id: string }>("SELECT nearai_key_id FROM devices WHERE nearai_key_id IS NOT NULL")
        .toArray()
        .map((row) => row.nearai_key_id),
    );
    for (const row of this.sql
      .exec<{ nearai_key_id: string }>("SELECT nearai_key_id FROM session_keys WHERE nearai_key_id IS NOT NULL")
      .toArray()) {
      deviceKeys.add(row.nearai_key_id);
    }
    const ours = keys.filter((key) => deviceKeys.has(key.id));
    // Keys the server creates always have a limit; a key without one counts as 0 outstanding.
    const outstanding = ours.reduce((sum, key) => (key.limitNano !== null && key.limitNano > key.usageNano ? sum + key.limitNano - key.usageNano : sum), 0n);

    const hasSnapshot = this.sql.exec("SELECT 1 FROM snapshot WHERE id = ?", SNAPSHOT_ID).toArray().length > 0;
    if (keyLimitsVersion(this.sql) !== limitsBefore && hasSnapshot) {
      this.sql.exec("UPDATE snapshot SET org_remaining_usd = ? WHERE id = ?", Number(clampNano(remaining)), SNAPSHOT_ID);
      return;
    }

    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM key_usage");
      for (const key of ours) {
        this.sql.exec(
          "INSERT INTO key_usage (key_id, limit_nano, usage_nano) VALUES (?, ?, ?)",
          key.id,
          key.limitNano === null ? null : Number(clampNano(key.limitNano)),
          Number(clampNano(key.usageNano)),
        );
      }
      this.setSnapshot(clampNano(remaining), clampNano(outstanding), now);
    });
  }

  private topup(topupId: string): { id: string; device_id: string; credits: number; status: TopupStatus } | undefined {
    return this.sql
      .exec<{ id: string; device_id: string; credits: number; status: TopupStatus }>(
        "SELECT id, device_id, credits, status FROM topups WHERE id = ?",
        topupId,
      )
      .toArray()[0];
  }

  /** Moves a top-up to `to` when `canMove` allows it from its current status; says whether it moved. */
  private move(topupId: string, to: TopupStatus, now: number): boolean {
    const current = this.topup(topupId);
    if (!current || !canMove(current.status, to)) return false;
    this.sql.exec("UPDATE topups SET status = ?, updated_at = ? WHERE id = ?", to, now, topupId);
    return true;
  }

  /**
   * Reserves the package and opens a PingPay checkout for it. A stale snapshot is refreshed first;
   * then the stock and cap check and both inserts happen in the synchronous `reserve`. When PingPay
   * fails the reservation is released and the top-up is `failed`.
   */
  async createTopup(
    deviceId: string,
    packageUsd: number,
    now: number,
  ): Promise<{ topupId: string; sessionUrl: string; expiresAt: string } | { error: "stock" | "device_cap" | "upstream" }> {
    const cfg = this.config();
    if (!cfg.packagesUsd.includes(packageUsd)) throw new RangeError("unknown package");
    const client = this.pingPay();
    await this.ensureAlarm();
    if (!(await this.stockIsCurrent(now))) return { error: "stock" };
    // No await between the check and the inserts: `reserve` is synchronous.
    const reserved = this.reserve(deviceId, creditsForPackage(packageUsd, cfg), packageUsd, now);
    if ("error" in reserved) return reserved;
    const { topupId } = reserved;

    let session: { sessionId: string; sessionUrl: string; expiresAt: string | null };
    try {
      session = await client.createSession({
        amountUsdc: usdcAmount(packageUsd),
        recipient: cfg.operatorAccount,
        customerReference: deviceId,
        topupId,
        successUrl: cfg.checkoutPaidUrl,
        cancelUrl: cfg.checkoutCancelledUrl,
      });
    } catch (error) {
      console.error(`PingPay checkout for top-up ${topupId} failed: ${describeError(error)}`);
      return this.failTopup(topupId, now);
    }
    // No await from here on. A session id another top-up already holds would break the unique index:
    // this top-up fails cleanly instead, and the session stays the other top-up's.
    if (this.sql.exec("SELECT 1 FROM topups WHERE ping_session_id = ?", session.sessionId).toArray().length > 0) {
      console.error(`PingPay session for top-up ${topupId} already belongs to another top-up; not opened`);
      return this.failTopup(topupId, now);
    }

    const { expiresAt, reservedUntil } = checkoutWindow(session.expiresAt, now);
    this.sql.exec(
      "UPDATE topups SET ping_session_id = ?, reserved_until = ?, updated_at = ? WHERE id = ?",
      session.sessionId,
      reservedUntil,
      now,
      topupId,
    );
    this.sql.exec("UPDATE reservations SET expires_at = ? WHERE topup_id = ?", reservedUntil, topupId);
    return { topupId, sessionUrl: session.sessionUrl, expiresAt };
  }

  /** A top-up whose checkout could not be opened: `failed`, its hold released. */
  private failTopup(topupId: string, now: number): { error: "upstream" } {
    if (this.move(topupId, "failed", now)) this.releaseReservation(topupId);
    return { error: "upstream" };
  }

  /** A device's own top-up, or null for an unknown id or another device's. */
  topupFor(deviceId: string, topupId: string): { status: TopupStatus; credits: number } | null {
    const row = this.topup(topupId);
    return row && row.device_id === deviceId ? { status: row.status, credits: row.credits } : null;
  }

  /**
   * Cancel in Zorvo: a `created` top-up becomes `expired` and its hold is released; any other status
   * stays. A payment that still arrives is handled by `onSessionEvent` as a late payment.
   */
  cancelTopup(deviceId: string, topupId: string, now: number): { status: TopupStatus; credits: number } | null {
    const row = this.topupFor(deviceId, topupId);
    if (!row) return null;
    if (row.status === "created" && this.move(topupId, "expired", now)) this.releaseReservation(topupId);
    return this.topupFor(deviceId, topupId);
  }

  private seenEvent(eventId: string): boolean {
    return this.sql.exec("SELECT 1 FROM events WHERE id = ?", eventId).toArray().length > 0;
  }

  /**
   * Applies what PingPay says about a checkout session, read again from PingPay rather than taken
   * from the event. Idempotent by `eventId` when one is given. Says what the session came to.
   */
  onSessionEvent(sessionId: string, eventId: string | null, now: number): Promise<SessionOutcome> {
    return this.applySessionEvent(sessionId, eventId, now);
  }

  /** Whether a checkout session id names a top-up; a `payment.*` webhook picks its candidate by this. */
  hasSession(sessionId: string): boolean {
    return this.sql.exec("SELECT 1 FROM topups WHERE ping_session_id = ?", sessionId).toArray().length > 0;
  }

  /** Reads the newest open checkouts now, for an unmatched `payment.success`; true if one settled. */
  nudgePolling(now: number = Date.now()): Promise<boolean> {
    return pollOpenCheckouts(this.fulfilment(), now);
  }

  /** Records a webhook event id once, after one of its polls settled a top-up. */
  recordEvent(eventId: string, now: number): void {
    this.sql.exec("INSERT OR IGNORE INTO events (id, received_at) VALUES (?, ?)", eventId, now);
  }

  /**
   * `onSessionEvent` for the webhook route, with the outcome as a value rather than a throw across
   * RPC: `upstream` when PingPay could not be read, `retry` when the session is not settled yet (or
   * its amount is wrong). Neither records the event, so PingPay's redelivery is handled.
   */
  async webhookEvent(sessionId: string, eventId: string, now: number): Promise<{ ok: true } | { error: "upstream" | "retry" }> {
    try {
      const outcome = await this.applySessionEvent(sessionId, eventId, now);
      return outcome === "retry" || outcome === "mismatch" ? { error: "retry" } : { ok: true };
    } catch (error) {
      // PingPay's error messages name the request and status only; headers and the key are never logged.
      const { name, message } = error instanceof Error ? error : { name: "Error", message: String(error) };
      console.error(`PingPay webhook for session ${sessionId} failed: ${name}: ${message}`);
      return { error: "upstream" };
    }
  }

  /**
   * The event is recorded only once its outcome is decided, in the same synchronous block as the
   * change, so a failed read or an unsettled session is retried by a redelivery; a duplicate arriving
   * meanwhile is caught by the second check. Returns `retry` without recording anything when the
   * session is not settled yet, and `mismatch` when it charged another amount than the top-up's.
   */
  private async applySessionEvent(sessionId: string, eventId: string | null, now: number): Promise<SessionOutcome> {
    if (eventId !== null && this.seenEvent(eventId)) return "nothing";
    const found = this.sql
      .exec<{ id: string; package_usd: number }>("SELECT id, package_usd FROM topups WHERE ping_session_id = ?", sessionId)
      .toArray()[0];
    if (!found) return "nothing";

    const outcome = await readSession(this.pingPay(), found.id, usdcAmount(found.package_usd), sessionId);
    if (outcome.kind === "retry" || outcome.kind === "mismatch") return outcome.kind;

    // From here on nothing awaits: the rows are re-read, since a request may have changed them meanwhile.
    if (eventId !== null) {
      if (this.seenEvent(eventId)) return "nothing";
      this.sql.exec("INSERT INTO events (id, received_at) VALUES (?, ?)", eventId, now);
    }
    const topupId = found.id;
    if (outcome.kind === "paid") {
      this.sql.exec("UPDATE topups SET ping_payment_id = ? WHERE id = ?", outcome.paymentId, topupId);
      this.settlePaid(topupId, now);
    } else if (outcome.kind === "expired") {
      if (this.move(topupId, "expired", now)) this.releaseReservation(topupId);
    }
    return outcome.kind;
  }

  /**
   * A successful payment (spec 7.5, races 3 and 4). With its hold still active, or with stock that
   * still covers it, the top-up is `paid`, its stock is held until it is credited, and one `credit`
   * is queued. Otherwise it waits as `paid_waiting_stock`, holding no reservation. Never refused.
   * Only a `created` or `expired` top-up is settled here: one already waiting is promoted by the
   * alarm in FIFO order, never by a redelivered event.
   */
  private settlePaid(topupId: string, now: number): void {
    const row = this.topup(topupId);
    if (!row || (row.status !== "created" && row.status !== "expired")) return;
    const held =
      this.sql.exec("SELECT 1 FROM reservations WHERE topup_id = ? AND expires_at > ?", topupId, now).toArray().length > 0;
    if (!held) {
      this.releaseReservation(topupId);
      if (row.credits > this.availableCredits(now).availableCredits) {
        this.move(topupId, "paid_waiting_stock", now);
        return;
      }
    }
    this.holdForCredit(topupId, now);
  }

  /**
   * Moves a top-up to `paid` through `canMove`, holds its stock until the credit releases it, and
   * queues one `credit`. Shared by a payment and by the alarm's promotion of a waiting top-up.
   */
  private holdForCredit(topupId: string, now: number): boolean {
    const row = this.topup(topupId);
    if (!row || !this.move(topupId, "paid", now)) return false;
    this.sql.exec(
      `INSERT INTO reservations (topup_id, device_id, credits, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (topup_id) DO UPDATE SET expires_at = excluded.expires_at`,
      topupId,
      row.device_id,
      row.credits,
      HELD_UNTIL_CREDITED,
    );
    this.sql.exec("UPDATE topups SET reserved_until = NULL WHERE id = ?", topupId);
    this.sql.exec(
      `INSERT INTO queue (id, kind, ref, attempts, next_at, created_at)
       SELECT ?, 'credit', ?, 0, ?, ? WHERE NOT EXISTS (SELECT 1 FROM queue WHERE kind = 'credit' AND ref = ?)`,
      crypto.randomUUID(),
      topupId,
      now,
      now,
      topupId,
    );
    return true;
  }

  /**
   * Redeems a promo code (by its hash) for the device through the reservation and credit path. The
   * snapshot is made current first, as for a top-up; a use is taken only by the synchronous block.
   * With `refusals`, a refused code counts one hit on its key, and once that has reached its limit
   * in the window every attempt is `rate_limited` before the code is looked at; a redemption that
   * works, or one refused for stock or the device cap, is not counted.
   */
  async redeemPromo(
    deviceId: string,
    codeHash: string,
    now: number = Date.now(),
    refusals?: { key: string; limit: number; windowMs: number },
  ): Promise<PromoResult | { error: "rate_limited" }> {
    if (refusals && this.limitReached(refusals.key, refusals.limit, refusals.windowMs, now)) return { error: "rate_limited" };
    const refused = (): { error: "bad_request" } => {
      if (refusals) this.rateLimit(refusals.key, refusals.limit, refusals.windowMs, now);
      return { error: "bad_request" };
    };
    if (promoRefusal(this.sql, codeHash, deviceId)) return refused();
    await this.ensureAlarm();
    if (!(await this.stockIsCurrent(now))) return { error: "stock" };
    const context: PromoContext = {
      sql: this.sql,
      transaction: (body) => this.ctx.storage.transactionSync(body),
      reserve: (id, credits, usd, at) => this.reserve(id, credits, usd, at),
      holdForCredit: (topupId, at) => this.holdForCredit(topupId, at),
    };
    const result = redeemPromo(context, deviceId, codeHash, now);
    return "error" in result && result.error === "bad_request" ? refused() : result;
  }

  /** Admin: creates or updates a promo code, stored by its hash. */
  addPromo(codeHash: string, credits: number, maxUses: number): void {
    savePromo(this.sql, codeHash, credits, maxUses);
  }

  /** Recovery: swaps the secret hash of the device that holds `recoveryHash` and queues a key rotation. */
  async recover(recoveryHash: string, newSecretHash: string, now: number = Date.now()): Promise<{ ok: true } | { error: "bad_request" }> {
    const found = this.sql
      .exec<{ id: string }>("SELECT id FROM devices WHERE secret_hash = ? AND revoked_at IS NULL", recoveryHash)
      .toArray()[0];
    const result = await this.withDeviceLock(found?.id ?? "", async () => {
      const recovered = recoverDevice(
        { sql: this.sql, transaction: (body) => this.ctx.storage.transactionSync(body) },
        recoveryHash,
        newSecretHash,
        now,
      );
      if ("ok" in recovered && found) endSessionsForDevice(this.sql, found.id, now);
      return recovered;
    });
    if ("ok" in result) await this.ensureAlarm();
    return result;
  }

  // ---- per-session spending caps ----

  /**
   * Creates a session key with `credits` of spend limit, funded from the device key's unallocated
   * budget. The row reserves the cap before the first await, so a second start sees it; the key is
   * then made and the device key lowered. A failure anywhere revokes the new key and removes the
   * row, so no budget stays held for a session the app never received.
   */
  async createSession(
    deviceId: string,
    credits: number,
    now: number = Date.now(),
  ): Promise<
    { sessionId: string; key: string; credits: number } | { error: "bad_request" | "insufficient" | "recovering" | "upstream" }
  > {
    if (!isSessionCap(credits)) return { error: "bad_request" };
    return this.withDeviceLock(deviceId, async () => {
      if (this.isRecovering(deviceId)) return { error: "recovering" as const };
      const cfg = this.config();
      const device = this.sql
        .exec<{ nearai_key_id: string | null; credits_bought: number }>(
          "SELECT nearai_key_id, credits_bought FROM devices WHERE id = ? AND revoked_at IS NULL",
          deviceId,
        )
        .toArray()[0];
      if (!device?.nearai_key_id) return { error: "insufficient" as const };
      let liveUsage: bigint;
      try {
        liveUsage = await this.liveDeviceUsage(device.nearai_key_id, now);
      } catch (error) {
        console.error(`Reading the live device usage for private session ${deviceId} failed: ${describeError(error)}`);
        return { error: "upstream" as const };
      }
      const targetBefore = deviceLimitNano(this.sql, cfg, deviceId, device.credits_bought);
      const room = targetBefore > liveUsage ? targetBefore - liveUsage : 0n;
      if (spendLimitNano(credits, cfg) > room) return { error: "insufficient" as const };

      const sessionId = crypto.randomUUID();
      insertSession(this.sql, sessionId, deviceId, credits, now, cfg);
      let key: { id: string; key: string };
      try {
        key = await this.withAccessToken(now, (access) =>
          this.nearAi().createKey(access, cfg.workspaceId, `zorvo-session-${sessionId}`, spendLimitNano(credits, cfg)),
        );
      } catch (error) {
        console.error(`Creating the key of private session ${sessionId} failed: ${describeError(error)}`);
        this.sql.exec("DELETE FROM session_keys WHERE id = ?", sessionId);
        return { error: "upstream" as const };
      }

      const row = sessionRow(this.sql, sessionId);
      if (!row || row.status !== "active") {
        await this.revokeQuietly(key.id, now);
        this.sql.exec("DELETE FROM session_keys WHERE id = ?", sessionId);
        return { error: "upstream" as const };
      }
      const target = deviceLimitNano(this.sql, cfg, deviceId, device.credits_bought);
      const limitNano = target > 0n ? target : 1n;
      try {
        await this.withAccessToken(now, (access) =>
          this.nearAi().setSpendLimit(access, cfg.workspaceId, device.nearai_key_id!, limitNano),
        );
      } catch (error) {
        console.error(`Lowering the device limit for private session ${sessionId} failed: ${describeError(error)}`);
        await this.revokeQuietly(key.id, now);
        this.sql.exec("DELETE FROM session_keys WHERE id = ?", sessionId);
        await this.restoreDeviceLimit(deviceId, device.nearai_key_id, now);
        return { error: "upstream" as const };
      }

      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE session_keys SET nearai_key_id = ?, last_seen_at = ? WHERE id = ?",
          key.id,
          now,
          sessionId,
        );
        recordKeyLimit(this.sql, key.id, spendLimitNano(credits, cfg));
        recordKeyLimit(this.sql, device.nearai_key_id!, limitNano);
      });
      return { sessionId, key: key.key, credits };
    });
  }

  /** Marks `sessionId` ending and queues its end; calling it again changes nothing. */
  async endSession(deviceId: string, sessionId: string, now: number = Date.now()): Promise<{ status: SessionRow["status"] } | null> {
    return this.withDeviceLock(deviceId, async () => {
      const row = sessionRow(this.sql, sessionId);
      if (!row || row.device_id !== deviceId) return null;
      if (row.status === "active") {
        this.sql.exec("UPDATE session_keys SET status = 'ending' WHERE id = ? AND status = 'active'", sessionId);
        queueEndSession(this.sql, sessionId, now);
        await this.ensureAlarm();
      } else if (row.status === "ending") {
        queueEndSession(this.sql, sessionId, now);
        await this.ensureAlarm();
      }
      return { status: sessionRow(this.sql, sessionId)?.status ?? "ended" };
    });
  }

  /** Records that the app is still using `sessionId`; false for an unknown or another device's. */
  seenSession(deviceId: string, sessionId: string, now: number = Date.now()): boolean {
    const row = sessionRow(this.sql, sessionId);
    if (!row || row.device_id !== deviceId || row.status === "ended") return false;
    this.sql.exec("UPDATE session_keys SET last_seen_at = ? WHERE id = ?", now, sessionId);
    return true;
  }

  /**
   * Doubles a session's cap, taking the difference from the device key. The device key is lowered
   * before the session key is raised, so the two keys can never together pass what the device
   * bought, even if the second PATCH fails.
   */
  async raiseSession(
    deviceId: string,
    sessionId: string,
    credits: number,
    now: number = Date.now(),
  ): Promise<
    { cap: number } | { error: "bad_request" | "insufficient" | "recovering" | "upstream" | "not_found" }
  > {
    return this.withDeviceLock(deviceId, async () => {
      const cfg = this.config();
      const row = sessionRow(this.sql, sessionId);
      if (!row || row.device_id !== deviceId) return { error: "not_found" as const };
      if (this.isRecovering(deviceId)) return { error: "recovering" as const };
      if (row.status !== "active" || !Number.isSafeInteger(credits) || credits !== row.cap_credits * 2) {
        return { error: "bad_request" as const };
      }
      const device = this.sql
        .exec<{ nearai_key_id: string | null; credits_bought: number }>(
          "SELECT nearai_key_id, credits_bought FROM devices WHERE id = ? AND revoked_at IS NULL",
          deviceId,
        )
        .toArray()[0];
      if (!device?.nearai_key_id || row.nearai_key_id === null) return { error: "insufficient" as const };
      let liveUsage: bigint;
      try {
        liveUsage = await this.liveDeviceUsage(device.nearai_key_id, now);
      } catch (error) {
        console.error(`Reading the live device usage for raising private session ${sessionId} failed: ${describeError(error)}`);
        return { error: "upstream" as const };
      }

      const oldCapNano = BigInt(row.cap_nano);
      const newCapNano = spendLimitNano(credits, cfg);
      const added = newCapNano > oldCapNano ? newCapNano - oldCapNano : 0n;
      const targetBefore = deviceLimitNano(this.sql, cfg, deviceId, device.credits_bought);
      const room = targetBefore > liveUsage ? targetBefore - liveUsage : 0n;
      if (added > room) return { error: "insufficient" as const };

      this.sql.exec(
        "UPDATE session_keys SET cap_credits = ?, cap_nano = ? WHERE id = ?",
        credits,
        Number(newCapNano),
        sessionId,
      );
      const target = targetBefore > added ? targetBefore - added : 0n;
      const limitNano = target > 0n ? target : 1n;
      try {
        await this.withAccessToken(now, (access) =>
          this.nearAi().setSpendLimit(access, cfg.workspaceId, device.nearai_key_id!, limitNano),
        );
      } catch (error) {
        console.error(`Lowering the device limit for raising private session ${sessionId} failed: ${describeError(error)}`);
        this.revertSessionCap(sessionId, row.cap_credits, oldCapNano);
        await this.restoreDeviceLimit(deviceId, device.nearai_key_id, now);
        return { error: "upstream" as const };
      }
      try {
        await this.withAccessToken(now, (access) =>
          this.nearAi().setSpendLimit(access, cfg.workspaceId, row.nearai_key_id!, newCapNano),
        );
      } catch (error) {
        console.error(`Raising the key of private session ${sessionId} failed: ${describeError(error)}`);
        // The device key is already lower and the new cap is recorded; reverting either would make
        // the difference spendable twice. The end item settles the cap against the final usage.
        this.ctx.storage.transactionSync(() => recordKeyLimit(this.sql, device.nearai_key_id!, limitNano));
        return { error: "upstream" as const };
      }
      this.ctx.storage.transactionSync(() => {
        recordKeyLimit(this.sql, device.nearai_key_id!, limitNano);
        recordKeyLimit(this.sql, row.nearai_key_id!, newCapNano);
      });
      return { cap: credits };
    });
  }

  private revertSessionCap(sessionId: string, cap: number, capNano: bigint): void {
    this.sql.exec("UPDATE session_keys SET cap_credits = ?, cap_nano = ? WHERE id = ?", cap, Number(capNano), sessionId);
  }

  /** Whether the device's key is waiting for a recovery rotation; no session may PATCH it meanwhile. */
  private isRecovering(deviceId: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM queue WHERE kind = 'rotate_key' AND ref = ?", deviceId)
        .toArray().length > 0
    );
  }

  /** The device key's live usage, read from NEAR AI rather than the up-to-2-minute-old snapshot. */
  private async liveDeviceUsage(keyId: string, now: number): Promise<bigint> {
    const cfg = this.config();
    const keys = await this.withAccessToken(now, (access) => this.nearAi().listKeys(access, cfg.workspaceId));
    const key = keys.find((candidate) => candidate.id === keyId);
    if (!key) throw new Error(`NEAR AI's key list does not show device key ${keyId}`);
    return key.usageNano;
  }

  /** Best effort: set the device key back to the invariant after a failed session change. */
  private async restoreDeviceLimit(deviceId: string, keyId: string, now: number): Promise<void> {
    const device = this.sql
      .exec<{ credits_bought: number }>("SELECT credits_bought FROM devices WHERE id = ?", deviceId)
      .toArray()[0];
    if (!device) return;
    const target = deviceLimitNano(this.sql, this.config(), deviceId, device.credits_bought);
    try {
      await this.withAccessToken(now, (access) =>
        this.nearAi().setSpendLimit(access, this.config().workspaceId, keyId, target > 0n ? target : 1n),
      );
    } catch (error) {
      console.error(`Restoring the device limit of ${deviceId} failed: ${describeError(error)}`);
    }
  }

  private async revokeQuietly(keyId: string, now: number): Promise<void> {
    try {
      await this.withAccessToken(now, (access) => this.nearAi().revokeKey(access, this.config().workspaceId, keyId));
    } catch (error) {
      console.error(`Revoking the unheld NEAR AI key ${keyId} failed: ${describeError(error)}`);
    }
  }

  /**
   * Hands the device its pending key once (spec 7.5). The secret is decrypted first and the row is
   * deleted afterwards only if it is still the same, in one synchronous block, so two calls at once
   * hand it over once and a failed decryption loses nothing. Never logged.
   */
  async takeKey(deviceId: string, now: number = Date.now()): Promise<string | null> {
    const row = this.sql
      .exec<{ key_ciphertext: string }>("SELECT key_ciphertext FROM pending_keys WHERE device_id = ? AND expires_at > ?", deviceId, now)
      .toArray()[0];
    if (!row) return null;
    const key = await decrypt(this.secret("KEY_ENCRYPTION_KEY"), row.key_ciphertext);
    const still = this.sql
      .exec("SELECT 1 FROM pending_keys WHERE device_id = ? AND key_ciphertext = ?", deviceId, row.key_ciphertext)
      .toArray().length > 0;
    if (!still) return null;
    this.sql.exec("DELETE FROM pending_keys WHERE device_id = ?", deviceId);
    return key;
  }

  /**
   * Tells the operator: a log line, and a POST of `{ kind, detail }` to `ALERT_URL` when it is set.
   * Never throws, so a hook that is down cannot stop the alarm. `detail` never holds a token or key.
   */
  async alert(kind: AlertKind, detail: string): Promise<void> {
    console.error(`Alert ${kind}: ${detail}`);
    const url = this.env.ALERT_URL;
    if (url === undefined || url === "") return;
    try {
      const response = await this.fetchOut(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, detail }),
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (!response.ok) console.error(`Alert ${kind} was not delivered: the hook answered ${response.status}`);
    } catch (error) {
      console.error(`Alert ${kind} was not delivered: ${describeError(error)}`);
    }
  }

  private async alertOnce(kind: AlertKind, subject: string, detail: string, now: number): Promise<void> {
    if (this.rateLimit(`alert:${kind}:${subject}`, 1, HOUR_MS, now).allowed) await this.alert(kind, detail);
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    // Scheduled here too, so an invocation that joins a tick still running keeps the chain going.
    await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
    await this.runAlarm(now);
  }

  /**
   * One alarm tick at `now` (spec 7.5, race 8): a tick that starts while one runs joins it, so two
   * never overlap. The next tick is scheduled a minute later both when it starts, so a step that
   * hangs cannot end the chain, and when it ends.
   */
  runAlarm(now: number): Promise<void> {
    this.ticking ??= (async () => {
      await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
      this.tickFetches = { count: 0, budget: this.config().tickSubrequestBudget };
      try {
        await runAlarm(this.fulfilment(), now);
      } finally {
        this.tickFetches = undefined;
        await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
      }
    })().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  /** What the alarm's steps may use of the Ledger. */
  private fulfilment(): FulfilmentContext {
    return {
      sql: this.sql,
      transaction: (body) => this.ctx.storage.transactionSync(body),
      config: () => this.config(),
      fetches: () => this.tickFetches?.count ?? 0,
      subrequestBudget: () => this.tickFetches?.budget ?? this.config().tickSubrequestBudget,
      nearAi: () => this.nearAi(),
      withDeviceLock: (deviceId, body) => this.withDeviceLock(deviceId, body),
      accessToken: (now) => this.accessToken(now),
      withAccessToken: (now, call) => this.withAccessToken(now, call),
      keyEncryptionKey: () => this.secret("KEY_ENCRYPTION_KEY"),
      snapshotTakenAt: () => this.snapshotTakenAt(),
      refreshSnapshot: (now) => this.refreshSnapshotOnce(now),
      availableCredits: (now, ignoreWaiting) => this.availableCredits(now, ignoreWaiting).availableCredits,
      onSessionEvent: (sessionId, eventId, now) => this.onSessionEvent(sessionId, eventId, now),
      move: (topupId, to, now) => this.move(topupId, to, now),
      holdForCredit: (topupId, now) => this.holdForCredit(topupId, now),
      releaseReservation: (topupId) => this.releaseReservation(topupId),
      alert: (kind, detail) => this.alert(kind, detail),
      alertOnce: (kind, subject, detail, now) => this.alertOnce(kind, subject, detail, now),
    };
  }
}
