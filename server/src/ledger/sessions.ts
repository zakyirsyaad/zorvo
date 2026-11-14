import type { Config } from "../config";
import { balanceCredits, creditsFromNano, spendLimitNano } from "../credits";
import { HOUR_MS } from "../time";

/**
 * The per-session spending caps a private draft may pick (spec 8.3 D). A session key is funded
 * from the device's budget, so the sum of its cap and the device key's remaining limit never passes
 * what the device bought.
 */
export const SESSION_CAPS = [100, 200, 500] as const;
export type SessionCap = (typeof SESSION_CAPS)[number];
export const SESSION_IDLE_MS = 24 * HOUR_MS;

export type SessionStatus = "active" | "ending" | "ended";

/** One row of `session_keys`; `nearai_key_id` is null only while its key is being made. */
export type SessionRow = {
  id: string;
  device_id: string;
  nearai_key_id: string | null;
  cap_credits: number;
  cap_nano: number;
  usage_nano: number;
  status: SessionStatus;
  created_at: number;
  last_seen_at: number;
  ended_at: number | null;
  settled_at: number | null;
};

export function isSessionCap(value: unknown): value is SessionCap {
  return typeof value === "number" && (SESSION_CAPS as readonly number[]).includes(value);
}

/** Every session row of `deviceId`, newest first; a test and the end paths read them. */
export function sessionRows(sql: SqlStorage, deviceId: string): SessionRow[] {
  return sql
    .exec<SessionRow>("SELECT * FROM session_keys WHERE device_id = ? ORDER BY created_at, id", deviceId)
    .toArray();
}

export function sessionRow(sql: SqlStorage, id: string): SessionRow | undefined {
  return sql.exec<SessionRow>("SELECT * FROM session_keys WHERE id = ?", id).toArray()[0];
}

/**
 * The budget a device's session keys hold: a cap while a session is active or ending, and the
 * final usage once it ended. An ended session that a key rotation has settled is already folded
 * into the device's `credits_bought`, so it is not counted again.
 */
export function sessionDebtNano(sql: SqlStorage, deviceId: string): bigint {
  const row = sql
    .exec<{ total: number }>(
      `SELECT COALESCE(SUM(
         CASE
           WHEN status IN ('active', 'ending') THEN cap_nano
           WHEN status = 'ended' AND settled_at IS NULL THEN usage_nano
           ELSE 0
         END), 0) AS total
       FROM session_keys WHERE device_id = ?`,
      deviceId,
    )
    .one();
  return BigInt(row.total);
}

/** The limit the device key should have under the invariant: bought, less every session debt. */
export function deviceLimitNano(sql: SqlStorage, cfg: Config, deviceId: string, creditsBought: number): bigint {
  const base = spendLimitNano(creditsBought, cfg);
  const debt = sessionDebtNano(sql, deviceId);
  return base > debt ? base - debt : 0n;
}

/** The device key's own usage, as the last NEAR AI snapshot recorded it. */
export function deviceKeyUsageNano(sql: SqlStorage, deviceKeyId: string | null): bigint {
  if (deviceKeyId === null) return 0n;
  const row = sql
    .exec<{ usage_nano: number }>("SELECT usage_nano FROM key_usage WHERE key_id = ?", deviceKeyId)
    .toArray()[0];
  return BigInt(row?.usage_nano ?? 0);
}

/** The budget still on the device key: its invariant limit less its usage, never negative. */
export function deviceUnallocatedNano(
  sql: SqlStorage,
  cfg: Config,
  deviceId: string,
  creditsBought: number,
  deviceKeyId: string | null,
): bigint {
  const limit = deviceLimitNano(sql, cfg, deviceId, creditsBought);
  const usage = deviceKeyUsageNano(sql, deviceKeyId);
  return limit > usage ? limit - usage : 0n;
}

/** Credits still unallocated on the device key: the most a new session cap may take. */
export function deviceUnallocatedCredits(
  sql: SqlStorage,
  cfg: Config,
  deviceId: string,
  creditsBought: number,
  deviceKeyId: string | null,
): number {
  return creditsFromNano(deviceUnallocatedNano(sql, cfg, deviceId, creditsBought, deviceKeyId), cfg);
}

/**
 * All NEAR AI usage of `deviceId`: its device key, its active and ending session keys, and the
 * final usage of sessions that ended (until a rotation settles them). This is what the balance
 * subtracts from `credits_bought`; an active session's unused cap is not usage.
 */
export function sessionUsageNano(sql: SqlStorage, deviceId: string, deviceKeyId: string | null): bigint {
  const active = sql
    .exec<{ total: number }>(
      `SELECT COALESCE(SUM(k.usage_nano), 0) AS total
       FROM session_keys s JOIN key_usage k ON k.key_id = s.nearai_key_id
       WHERE s.device_id = ? AND s.status IN ('active', 'ending')`,
      deviceId,
    )
    .one();
  const ended = sql
    .exec<{ total: number }>(
      "SELECT COALESCE(SUM(usage_nano), 0) AS total FROM session_keys WHERE device_id = ? AND status = 'ended' AND settled_at IS NULL",
      deviceId,
    )
    .one();
  return deviceKeyUsageNano(sql, deviceKeyId) + BigInt(active.total) + BigInt(ended.total);
}

/** Credits left from `credits_bought` after all usage, never negative; the balance the app shows. */
export function remainingCredits(
  sql: SqlStorage,
  cfg: Config,
  deviceId: string,
  creditsBought: number,
  deviceKeyId: string | null,
): number {
  return balanceCredits(spendLimitNano(creditsBought, cfg), sessionUsageNano(sql, deviceId, deviceKeyId), cfg);
}

/** Inserts the reservation for a new session before its key exists, so two starts see each other. */
export function insertSession(sql: SqlStorage, id: string, deviceId: string, cap: SessionCap, now: number, cfg: Config): void {
  sql.exec(
    `INSERT INTO session_keys
       (id, device_id, nearai_key_id, cap_credits, cap_nano, usage_nano, status, created_at, last_seen_at)
     VALUES (?, ?, NULL, ?, ?, 0, 'active', ?, ?)`,
    id,
    deviceId,
    cap,
    Number(spendLimitNano(cap, cfg)),
    now,
    now,
  );
}

/** Queues one `end_session` for `id`; no second item is queued while one is waiting. */
export function queueEndSession(sql: SqlStorage, id: string, now: number): void {
  sql.exec(
    `INSERT INTO queue (id, kind, ref, attempts, next_at, created_at)
     SELECT ?, 'end_session', ?, 0, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM queue WHERE kind = 'end_session' AND ref = ?)`,
    crypto.randomUUID(),
    id,
    now,
    now,
    id,
  );
}

/** Marks every open session of `deviceId` ending and queues its end; recovery calls this first. */
export function endSessionsForDevice(sql: SqlStorage, deviceId: string, now: number): void {
  const open = sql
    .exec<{ id: string; status: SessionStatus }>(
      "SELECT id, status FROM session_keys WHERE device_id = ? AND status IN ('active', 'ending')",
      deviceId,
    )
    .toArray();
  for (const { id, status } of open) {
    if (status === "active") sql.exec("UPDATE session_keys SET status = 'ending' WHERE id = ?", id);
    queueEndSession(sql, id, now);
  }
}

/** Folds the ended sessions' usage into a rotation's new `credits_bought`, so it is not counted twice. */
export function settleEndedSessions(sql: SqlStorage, deviceId: string, now: number): void {
  sql.exec(
    "UPDATE session_keys SET settled_at = ? WHERE device_id = ? AND status = 'ended' AND settled_at IS NULL",
    now,
    deviceId,
  );
}

/** The active sessions with no `/seen` for `SESSION_IDLE_MS`; the alarm ends each. */
export function idleSessions(sql: SqlStorage, now: number): { id: string; device_id: string }[] {
  return sql
    .exec<{ id: string; device_id: string }>(
      "SELECT id, device_id FROM session_keys WHERE status = 'active' AND last_seen_at < ?",
      now - SESSION_IDLE_MS,
    )
    .toArray();
}