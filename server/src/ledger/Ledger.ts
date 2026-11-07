import { DurableObject } from "cloudflare:workers";
import { parseConfig, type Config, type Env } from "../config";
import { creditsForPackage } from "../credits";
import { applySchema } from "./schema";
import { computeStock, type StockView } from "./stock";

const RESERVATION_MS = 30 * 60 * 1000;
const SNAPSHOT_ID = 1;

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
}
