import type { Env } from "../config";
import { decrypt, encrypt, sha256Hex } from "../crypto";
import { NearAiError, type NearAiClient } from "../nearai";

/**
 * The operator's NEAR AI session (spec 7.5 race 6, 7.6): the access token, its refresh, and the
 * `OPERATOR_REFRESH_TOKEN` seed. The Ledger owns the state and the single refresh in flight; these
 * functions reach it through an `OperatorContext`.
 */

export const OPERATOR_ID = 1;
/** The operator's NEAR AI access token and the version of the `operator` row it was read at. */
export type OperatorSession = { token: string; version: number };
/** How long a fresh access token is trusted; the operator session is refreshed on a 30-minute cadence (spec 7.6). */
export const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
/** A cached access token is renewed this long before it expires. */
export const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

export interface OperatorContext {
  readonly sql: SqlStorage;
  readonly env: Env;
  secret(name: "KEY_ENCRYPTION_KEY" | "OPERATOR_REFRESH_TOKEN"): string;
  nearAi(): NearAiClient;
  /** The refresh in flight, or a new `refreshOperator` when there is none: at most one at a time. */
  refreshOnce(now: number): Promise<OperatorSession>;
}

/**
 * The access token and the `version` of the operator row it belongs to. Whether the stored token is
 * still fresh is read synchronously, so an expired one goes to `refreshOnce` with no await in
 * between and joins a refresh already in flight rather than starting a second.
 */
export async function operatorSession(ctx: OperatorContext, now: number): Promise<OperatorSession> {
  const row = freshTokenRow(ctx, now);
  if (!row) return ctx.refreshOnce(now);
  try {
    return { token: await decrypt(ctx.secret("KEY_ENCRYPTION_KEY"), row.access_token), version: row.version };
  } catch {
    // One that cannot be decrypted (an old plaintext value, a replaced key) counts as expired.
    return ctx.refreshOnce(now);
  }
}

/** The stored, still encrypted access token while it has more than a minute left. */
function freshTokenRow(ctx: OperatorContext, now: number): { access_token: string; version: number } | null {
  const row = ctx.sql
    .exec<{ access_token: string | null; access_expires_at: number | null; version: number }>(
      "SELECT access_token, access_expires_at, version FROM operator WHERE id = ?",
      OPERATOR_ID,
    )
    .toArray()[0];
  if (!row?.access_token || row.access_expires_at === null || row.access_expires_at - ACCESS_TOKEN_MARGIN_MS <= now) return null;
  return { access_token: row.access_token, version: row.version };
}

/**
 * The refresh token to spend. The `OPERATOR_REFRESH_TOKEN` secret seeds it the first time, and
 * again whenever the secret's value changes (its hash differs from `seed_hash`): that is how the
 * operator replaces a dead session. An unchanged secret never overwrites the rotated token. It
 * runs inside the single refresh in flight, so it cannot race a rotation.
 */
export async function operatorRefreshToken(ctx: OperatorContext): Promise<string> {
  const keyB64 = ctx.secret("KEY_ENCRYPTION_KEY");
  const row = ctx.sql
    .exec<{ refresh_token_ciphertext: string; seed_hash: string | null }>(
      "SELECT refresh_token_ciphertext, seed_hash FROM operator WHERE id = ?",
      OPERATOR_ID,
    )
    .toArray()[0];
  const seed = ctx.env.OPERATOR_REFRESH_TOKEN;
  if (seed === undefined || seed === "") {
    if (row) return decrypt(keyB64, row.refresh_token_ciphertext);
    return ctx.secret("OPERATOR_REFRESH_TOKEN");
  }
  const seedHash = await sha256Hex(seed);
  if (row && row.seed_hash === seedHash) return decrypt(keyB64, row.refresh_token_ciphertext);
  const sealed = await encrypt(keyB64, seed);
  if (row) {
    ctx.sql.exec(
      `UPDATE operator SET refresh_token_ciphertext = ?, seed_hash = ?, access_token = NULL, access_expires_at = NULL,
       version = version + 1 WHERE id = ?`,
      sealed,
      seedHash,
      OPERATOR_ID,
    );
  } else {
    ctx.sql.exec(
      "INSERT INTO operator (id, refresh_token_ciphertext, seed_hash, version) VALUES (?, ?, ?, 0)",
      OPERATOR_ID,
      sealed,
      seedHash,
    );
  }
  return seed;
}

/**
 * Spends the refresh token and stores the new pair. An answer whose access token is empty still
 * carries the new refresh token, which is the only live one now: it is stored, the access token is
 * not, and the call fails, so the next one refreshes with the stored token.
 */
export async function refreshOperator(ctx: OperatorContext, now: number): Promise<OperatorSession> {
  const refreshToken = await operatorRefreshToken(ctx);
  const fresh = await ctx.nearAi().refresh(refreshToken);
  const keyB64 = ctx.secret("KEY_ENCRYPTION_KEY");
  if (fresh.accessToken === "") {
    ctx.sql.exec(
      `UPDATE operator SET refresh_token_ciphertext = ?, access_token = NULL, access_expires_at = NULL, version = version + 1
       WHERE id = ?`,
      await encrypt(keyB64, fresh.refreshToken),
      OPERATOR_ID,
    );
    throw new Error("NEAR AI answered the refresh with an empty access token");
  }
  // The old refresh token is spent: store the new one before anyone can use the new access token.
  ctx.sql.exec(
    `UPDATE operator SET refresh_token_ciphertext = ?, access_token = ?, access_expires_at = ?, version = version + 1
     WHERE id = ?`,
    await encrypt(keyB64, fresh.refreshToken),
    await encrypt(keyB64, fresh.accessToken),
    now + ACCESS_TOKEN_TTL_MS,
    OPERATOR_ID,
  );
  const { version } = ctx.sql.exec<{ version: number }>("SELECT version FROM operator WHERE id = ?", OPERATOR_ID).one();
  return { token: fresh.accessToken, version };
}

/**
 * Runs an operator call with the cached access token. If NEAR AI refuses that token (401) the
 * cache is dropped and the call is retried once with a freshly refreshed token, so a lifetime
 * shorter than assumed costs one refresh, not a run of failures. A second refusal is surfaced.
 */
export async function withAccessToken<T>(ctx: OperatorContext, now: number, call: (access: string) => Promise<T>): Promise<T> {
  const session = await operatorSession(ctx, now);
  try {
    return await call(session.token);
  } catch (error) {
    if (!(error instanceof NearAiError) || error.status !== 401) throw error;
    // Only the token that failed is dropped: a caller that already refreshed past it keeps its new one.
    ctx.sql.exec("UPDATE operator SET access_expires_at = NULL WHERE id = ? AND version = ?", OPERATOR_ID, session.version);
    return call((await operatorSession(ctx, now)).token);
  }
}
