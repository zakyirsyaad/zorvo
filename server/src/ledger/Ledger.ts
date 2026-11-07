import { DurableObject } from "cloudflare:workers";
import { parseConfig, type Config, type Env } from "../config";
import { creditsForPackage } from "../credits";
import { decrypt, encrypt } from "../crypto";
import { NearAiClient, NearAiError } from "../nearai";
import { applySchema } from "./schema";
import { computeStock, type StockView } from "./stock";

const RESERVATION_MS = 30 * 60 * 1000;
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
  /** The `fetch` used for NEAR AI calls; tests replace it. */
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

  /** How many more credits the device may buy or reserve before it reaches the per-device cap. */
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
    return Math.max(0, this.config().deviceCapCredits - device.credits_bought - reserved);
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

  private secret(name: "KEY_ENCRYPTION_KEY" | "OPERATOR_REFRESH_TOKEN"): string {
    const value = this.env[name];
    if (value === undefined || value === "") throw new Error(`Missing secret ${name}`);
    return value;
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
}
