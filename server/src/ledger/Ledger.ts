import { DurableObject } from "cloudflare:workers";
import type { Env } from "../config";
import { applySchema } from "./schema";

/**
 * The only writer of money state. Every method runs its reads and writes synchronously (SQLite
 * calls are synchronous), so two requests can never interleave a read and a write.
 */
export class Ledger extends DurableObject<Env> {
  private readonly sql: SqlStorage;

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
}
