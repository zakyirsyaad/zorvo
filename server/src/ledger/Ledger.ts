import { DurableObject } from "cloudflare:workers";
import { parseConfig, type Config, type Env } from "../config";
import { creditsForPackage, usdcAmount } from "../credits";
import { decrypt, encrypt } from "../crypto";
import { NearAiClient, NearAiError } from "../nearai";
import { PingPayClient } from "../pingpay";
import { applySchema } from "./schema";
import { canMove, type TopupStatus } from "./status";
import { computeStock, type StockView } from "./stock";

/** How long `reserve` holds credits until `createTopup` sets the hold from the checkout's expiry. */
const RESERVATION_MS = 30 * 60 * 1000;
/** A reservation outlives its checkout session by this much, for a payment that lands at the last moment. */
const RESERVATION_GRACE_MS = 10 * 60 * 1000;
/** The `expires_at` of a paid top-up's reservation: it holds the stock until the credit releases it. */
const HELD_UNTIL_CREDITED = Number.MAX_SAFE_INTEGER;
/** Where PingPay sends the payer after the checkout; the README's "After a checkout" section. */
const CHECKOUT_PAID_URL = "https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-paid";
const CHECKOUT_CANCELLED_URL = "https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-cancelled";
const SNAPSHOT_ID = 1;
const OPERATOR_ID = 1;
/** How long a fresh access token is trusted; the operator session is refreshed on a 30-minute cadence (spec 7.6). */
const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
/** A cached access token is renewed this long before it expires. */
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;
const MAX_STORABLE = BigInt(Number.MAX_SAFE_INTEGER);

/** Brings an upstream amount into the range `setSnapshot` and SQLite accept, so one odd value cannot stop updates. */
function clampNano(nano: bigint): bigint {
  if (nano < 0n) return 0n;
  return nano > MAX_STORABLE ? MAX_STORABLE : nano;
}

/** SQLite hands back plain numbers, so an amount must stay exactly representable as one. */
function storable(nano: bigint): number {
  const value = Number(nano);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("amount must be a whole, non-negative number below 2^53");
  return value;
}

/**
 * The only writer of money state. Every method runs its reads and writes synchronously (SQLite
 * calls are synchronous), so two requests can never interleave a read and a write.
 */
export class Ledger extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private parsedConfig: Config | undefined;
  private refreshing: Promise<string> | undefined;
  /** The `fetch` used for NEAR AI and PingPay calls; tests replace it. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => applySchema(this.sql));
  }

  /** Counts one hit on `key` in a fixed window and says whether it is within `limit`. */
  rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean } {
    const now = Date.now();
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

  registerDevice(secretHash: string): { deviceId: string } | { error: "bad_request" } {
    if (!/^[0-9a-f]{64}$/.test(secretHash)) return { error: "bad_request" };
    const taken = this.sql.exec("SELECT 1 FROM devices WHERE secret_hash = ?", secretHash).toArray().length > 0;
    if (taken) return { error: "bad_request" };
    const deviceId = crypto.randomUUID();
    this.sql.exec("INSERT INTO devices (id, secret_hash, created_at) VALUES (?, ?, ?)", deviceId, secretHash, Date.now());
    return { deviceId };
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

  private availableCredits(now: number): { availableCredits: number; takenAt: number } {
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
        waitingCredits: this.sum("SELECT COALESCE(SUM(credits), 0) AS total FROM topups WHERE status = 'paid_waiting_stock'"),
        bufferNano: this.config().stockBufferNano,
      },
      this.config(),
    );
    return { availableCredits, takenAt: snapshot?.taken_at ?? 0 };
  }

  /**
   * How many more credits the device may buy or reserve before it reaches the per-device cap. The one
   * calculation behind `stockFor` and `reserve`: credits bought, plus active reservations (a paid
   * top-up's is held until credited), plus the device's paid top-ups waiting for stock, which are in
   * neither of the other two.
   */
  private roomCredits(deviceId: string, now: number): number {
    const device = this.sql
      .exec<{ credits_bought: number }>("SELECT credits_bought FROM devices WHERE id = ?", deviceId)
      .toArray()[0];
    if (!device) throw new Error("unknown device");
    const reserved = this.sum(
      "SELECT COALESCE(SUM(credits), 0) AS total FROM reservations WHERE device_id = ? AND expires_at > ?",
      deviceId,
      now,
    );
    const waiting = this.sum(
      "SELECT COALESCE(SUM(credits), 0) AS total FROM topups WHERE device_id = ? AND status = 'paid_waiting_stock'",
      deviceId,
    );
    return Math.max(0, this.config().deviceCapCredits - device.credits_bought - reserved - waiting);
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
    return new PingPayClient(this.config().pingPayBase, this.secret("PINGPAY_API_KEY"), this.fetcher);
  }

  private nearAi(): NearAiClient {
    return new NearAiClient(this.config().nearAiBase, this.fetcher);
  }

  /**
   * A NEAR AI access token for the operator. The cached one is used while it has more than a minute
   * left; otherwise it is refreshed, with at most one refresh in flight, because every refresh
   * spends the refresh token (spec 7.5, race 6).
   */
  accessToken(now: number): Promise<string> {
    const row = this.sql
      .exec<{ access_token: string | null; access_expires_at: number | null }>(
        "SELECT access_token, access_expires_at FROM operator WHERE id = ?",
        OPERATOR_ID,
      )
      .toArray()[0];
    if (row?.access_token && row.access_expires_at !== null && row.access_expires_at - ACCESS_TOKEN_MARGIN_MS > now) {
      return Promise.resolve(row.access_token);
    }
    this.refreshing ??= this.refreshOperator(now).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /** The stored refresh token, seeded from the `OPERATOR_REFRESH_TOKEN` secret the first time. */
  private async operatorRefreshToken(): Promise<string> {
    const keyB64 = this.secret("KEY_ENCRYPTION_KEY");
    const row = this.sql
      .exec<{ refresh_token_ciphertext: string }>("SELECT refresh_token_ciphertext FROM operator WHERE id = ?", OPERATOR_ID)
      .toArray()[0];
    if (row) return decrypt(keyB64, row.refresh_token_ciphertext);
    const seed = this.secret("OPERATOR_REFRESH_TOKEN");
    this.sql.exec(
      "INSERT INTO operator (id, refresh_token_ciphertext, version) VALUES (?, ?, 0)",
      OPERATOR_ID,
      await encrypt(keyB64, seed),
    );
    return seed;
  }

  private async refreshOperator(now: number): Promise<string> {
    const refreshToken = await this.operatorRefreshToken();
    const fresh = await this.nearAi().refresh(refreshToken);
    // The old refresh token is spent: store the new one before anyone can use the new access token.
    this.sql.exec(
      `UPDATE operator SET refresh_token_ciphertext = ?, access_token = ?, access_expires_at = ?, version = version + 1
       WHERE id = ?`,
      await encrypt(this.secret("KEY_ENCRYPTION_KEY"), fresh.refreshToken),
      fresh.accessToken,
      now + ACCESS_TOKEN_TTL_MS,
      OPERATOR_ID,
    );
    return fresh.accessToken;
  }

  /**
   * Runs an operator call with the cached access token. If NEAR AI refuses that token (401) the
   * cache is dropped and the call is retried once with a freshly refreshed token, so a lifetime
   * shorter than assumed costs one refresh, not a run of failures. A second refusal is surfaced.
   */
  private async withAccessToken<T>(now: number, call: (access: string) => Promise<T>): Promise<T> {
    const access = await this.accessToken(now);
    try {
      return await call(access);
    } catch (error) {
      if (!(error instanceof NearAiError) || error.status !== 401) throw error;
      // Only the token that failed is dropped: a caller that already refreshed past it keeps its new one.
      this.sql.exec("UPDATE operator SET access_expires_at = NULL WHERE id = ? AND access_token = ?", OPERATOR_ID, access);
      return call(await this.accessToken(now));
    }
  }

  /**
   * Reads the organization balance and the device keys from NEAR AI and records them: the stock
   * snapshot, and each device key's limit and usage in `key_usage`. The device list is read after
   * the calls, so a key created meanwhile is not mistaken for a stranger's. The replacement of
   * `key_usage` and the snapshot is one transaction: either both change or neither does.
   */
  async refreshSnapshot(now: number): Promise<void> {
    const cfg = this.config();
    const client = this.nearAi();
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
    const ours = keys.filter((key) => deviceKeys.has(key.id));
    // Keys the server creates always have a limit; a key without one counts as 0 outstanding.
    const outstanding = ours.reduce((sum, key) => (key.limitNano !== null && key.limitNano > key.usageNano ? sum + key.limitNano - key.usageNano : sum), 0n);

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
   * Reserves the package and opens a PingPay checkout for it. The stock and cap check and both
   * inserts happen in the synchronous `reserve`, before the first await. When PingPay fails the
   * reservation is released and the top-up is `failed`.
   */
  async createTopup(
    deviceId: string,
    packageUsd: number,
    now: number,
  ): Promise<{ topupId: string; sessionUrl: string; expiresAt: string } | { error: "stock" | "device_cap" | "upstream" }> {
    const cfg = this.config();
    if (!cfg.packagesUsd.includes(packageUsd)) throw new RangeError("unknown package");
    const client = this.pingPay();
    const reserved = this.reserve(deviceId, creditsForPackage(packageUsd, cfg), packageUsd, now);
    if ("error" in reserved) return reserved;
    const { topupId } = reserved;

    let session: { sessionId: string; sessionUrl: string; expiresAt: string };
    try {
      session = await client.createSession({
        amountUsdc: usdcAmount(packageUsd),
        recipient: cfg.operatorAccount,
        customerReference: deviceId,
        topupId,
        successUrl: CHECKOUT_PAID_URL,
        cancelUrl: CHECKOUT_CANCELLED_URL,
      });
    } catch {
      if (this.move(topupId, "failed", now)) this.releaseReservation(topupId);
      return { error: "upstream" };
    }

    const reservedUntil = Date.parse(session.expiresAt) + RESERVATION_GRACE_MS;
    this.sql.exec(
      "UPDATE topups SET ping_session_id = ?, reserved_until = ?, updated_at = ? WHERE id = ?",
      session.sessionId,
      reservedUntil,
      now,
      topupId,
    );
    this.sql.exec("UPDATE reservations SET expires_at = ? WHERE topup_id = ?", reservedUntil, topupId);
    return { topupId, sessionUrl: session.sessionUrl, expiresAt: session.expiresAt };
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
   * from the event. Idempotent by `eventId` when one is given. The event is recorded only once the
   * session was read, in the same synchronous block as the change, so a failed read can be retried
   * by a redelivery; a duplicate arriving meanwhile is caught by the second check.
   */
  async onSessionEvent(sessionId: string, eventId: string | null, now: number): Promise<void> {
    if (eventId !== null && this.seenEvent(eventId)) return;
    const found = this.sql.exec<{ id: string }>("SELECT id FROM topups WHERE ping_session_id = ?", sessionId).toArray()[0];
    if (!found) return;

    const client = this.pingPay();
    const session = await client.getSession(sessionId);
    const payment = session.status === "COMPLETED" && session.paymentId !== null ? await client.getPayment(session.paymentId) : null;

    // From here on nothing awaits: the rows are re-read, since a request may have changed them meanwhile.
    if (eventId !== null) {
      if (this.seenEvent(eventId)) return;
      this.sql.exec("INSERT INTO events (id, received_at) VALUES (?, ?)", eventId, now);
    }
    const topupId = found.id;
    if (payment?.status === "SUCCESS") {
      this.sql.exec("UPDATE topups SET ping_payment_id = ? WHERE id = ?", session.paymentId, topupId);
      this.settlePaid(topupId, now);
    } else if (payment?.status === "FAILED") {
      if (this.move(topupId, "failed", now)) this.releaseReservation(topupId);
    } else if (session.status === "EXPIRED" || session.status === "CANCELLED") {
      if (this.move(topupId, "expired", now)) this.releaseReservation(topupId);
    }
  }

  /**
   * `onSessionEvent` for the webhook route: a PingPay failure comes back as a value, not a throw
   * across RPC. The event is then not recorded, so PingPay's redelivery is handled.
   */
  async webhookEvent(sessionId: string, eventId: string, now: number): Promise<{ ok: true } | { error: "upstream" }> {
    try {
      await this.onSessionEvent(sessionId, eventId, now);
      return { ok: true };
    } catch {
      return { error: "upstream" };
    }
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
    this.move(topupId, "paid", now);
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
      `INSERT INTO queue (id, kind, ref, attempts, next_at)
       SELECT ?, 'credit', ?, 0, ? WHERE NOT EXISTS (SELECT 1 FROM queue WHERE kind = 'credit' AND ref = ?)`,
      crypto.randomUUID(),
      topupId,
      now,
      topupId,
    );
  }
}
