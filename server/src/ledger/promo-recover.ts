/**
 * Promo codes and device recovery (spec 7.4, 7.5). Both are single synchronous blocks over the
 * Ledger's SQLite, so two requests can never interleave a check and its write. They take hashes:
 * a code or recovery code never reaches this module, and nothing here logs anything.
 */

export interface PromoContext {
  readonly sql: SqlStorage;
  /** `storage.transactionSync`: a throw inside rolls every write back. */
  transaction(body: () => void): void;
  reserve(
    deviceId: string,
    credits: number,
    packageUsd: number,
    now: number,
  ): { topupId: string } | { error: "stock" | "device_cap" };
  /** Moves a top-up `created` -> `paid` through `canMove`, holds its stock and queues one `credit`. */
  holdForCredit(topupId: string, now: number): boolean;
}

export type PromoResult = { topupId: string; credits: number } | { error: "bad_request" | "stock" | "device_cap" };

/** `bad_request` when the code is unknown, used up, or this device already redeemed it. */
export function promoRefusal(sql: SqlStorage, codeHash: string, deviceId: string): "bad_request" | null {
  const promo = sql.exec<{ max_uses: number; uses: number }>("SELECT max_uses, uses FROM promos WHERE code_hash = ?", codeHash).toArray()[0];
  if (!promo || promo.uses >= promo.max_uses) return "bad_request";
  const redeemed = sql.exec("SELECT 1 FROM promo_redemptions WHERE code_hash = ? AND device_id = ?", codeHash, deviceId).toArray().length > 0;
  return redeemed ? "bad_request" : null;
}

/**
 * Redeems a code: the reservation (stock and the device cap apply, `package_usd` 0), the use, the
 * redemption and the queued credit are one block, so a refused reservation uses nothing and a
 * failure half-way leaves nothing behind.
 */
export function redeemPromo(ctx: PromoContext, deviceId: string, codeHash: string, now: number): PromoResult {
  let result: PromoResult = { error: "bad_request" };
  ctx.transaction(() => {
    if (promoRefusal(ctx.sql, codeHash, deviceId)) return;
    const promo = ctx.sql.exec<{ credits: number }>("SELECT credits FROM promos WHERE code_hash = ?", codeHash).one();
    const reserved = ctx.reserve(deviceId, promo.credits, 0, now);
    if ("error" in reserved) {
      result = reserved;
      return;
    }
    ctx.sql.exec("UPDATE promos SET uses = uses + 1 WHERE code_hash = ?", codeHash);
    ctx.sql.exec("INSERT INTO promo_redemptions (code_hash, device_id) VALUES (?, ?)", codeHash, deviceId);
    if (!ctx.holdForCredit(reserved.topupId, now)) throw new Error("A reserved promo top-up could not be marked paid");
    result = { topupId: reserved.topupId, credits: promo.credits };
  });
  return result;
}

/** Creates a code, or replaces the credits and uses of an existing one; how often it was used is kept. */
export function savePromo(sql: SqlStorage, codeHash: string, credits: number, maxUses: number): void {
  sql.exec(
    `INSERT INTO promos (code_hash, credits, max_uses) VALUES (?, ?, ?)
     ON CONFLICT (code_hash) DO UPDATE SET credits = excluded.credits, max_uses = excluded.max_uses`,
    codeHash,
    credits,
    maxUses,
  );
}

/**
 * Recovery: the device whose secret hashes to `recoveryHash` (a revoked one is not found, and looks
 * the same as an unknown one) gets `newSecretHash` in the same block, so its old secret stops
 * authenticating at once and its uncollected key is dropped. A rotation is queued only when there is a key to rotate (or a pending
 * one), and only when none is queued already: it re-reads the device when it runs.
 */
export function recoverDevice(
  ctx: Pick<PromoContext, "sql" | "transaction">,
  recoveryHash: string,
  newSecretHash: string,
  now: number,
): { ok: true } | { error: "bad_request" } {
  let result: { ok: true } | { error: "bad_request" } = { error: "bad_request" };
  ctx.transaction(() => {
    const device = ctx.sql
      .exec<{ id: string; has_key: number }>(
        `SELECT id, (nearai_key_id IS NOT NULL OR EXISTS (SELECT 1 FROM pending_keys WHERE device_id = devices.id)) AS has_key
         FROM devices WHERE secret_hash = ? AND revoked_at IS NULL`,
        recoveryHash,
      )
      .toArray()[0];
    if (!device) return;
    const taken = ctx.sql.exec("SELECT 1 FROM devices WHERE secret_hash = ?", newSecretHash).toArray().length > 0;
    if (taken) return;
    ctx.sql.exec("UPDATE devices SET secret_hash = ? WHERE id = ?", newSecretHash, device.id);
    // The old key is about to be revoked: the new secret's holder must not be handed it, and its
    // encrypted copy is not kept longer than needed. The rotation makes a new one.
    ctx.sql.exec("DELETE FROM pending_keys WHERE device_id = ?", device.id);
    if (device.has_key === 1) {
      ctx.sql.exec(
        `INSERT INTO queue (id, kind, ref, attempts, next_at, created_at)
         SELECT ?, 'rotate_key', ?, 0, ?, ? WHERE NOT EXISTS (SELECT 1 FROM queue WHERE kind = 'rotate_key' AND ref = ?)`,
        crypto.randomUUID(),
        device.id,
        now,
        now,
        device.id,
      );
    }
    result = { ok: true };
  });
  return result;
}
