import type { Config } from "../config";
import { balanceCredits, creditsFromNano, spendLimitNano } from "../credits";
import { UnusableModelList, type NearAiClient } from "../nearai";
import { describeError } from "./fulfilment";

/**
 * What the app reads (spec 7.4): a device's balance and the models it may pick. The Ledger owns
 * the state, the snapshot refresh and the model cache; these functions reach them through a context.
 */

export type BalanceView = {
  credits: number;
  usedCredits: number;
  keyReady: boolean;
  /** When the snapshot behind the numbers was taken, ISO-8601. */
  updatedAt: string;
};

export type ModelInfo = { id: string; inputPerM: number; outputPerM: number };

/** A device's Refresh reads NEAR AI at most this often, and so does the server as a whole. */
export const FRESH_BALANCE_MS = 30 * 1000;
/** How long the model list is served without asking NEAR AI again. */
export const MODELS_CACHE_MS = 10 * 60 * 1000;
const FRESH_ALL_KEY = "fresh:all";
const MODELS_ROW_ID = 1;

/** Whether a once-per-`FRESH_BALANCE_MS` window has room now, without taking it. */
function windowIsFree(sql: SqlStorage, key: string, now: number): boolean {
  const row = sql.exec<{ window_start: number }>("SELECT window_start FROM ratelimits WHERE key = ?", key).toArray()[0];
  return row === undefined || now - row.window_start >= FRESH_BALANCE_MS;
}

export interface BalanceContext {
  readonly sql: SqlStorage;
  config(): Config;
  rateLimit(key: string, limit: number, windowMs: number, now: number): { allowed: boolean };
  snapshotTakenAt(): number;
  /** The snapshot refresh in flight, or a new one. */
  refreshSnapshotOnce(now: number): Promise<void>;
}

export interface ModelsContext {
  config(): Config;
  nearAi(): NearAiClient;
  /** The last model list and when it was read. */
  cachedModels(): { models: ModelInfo[]; at: number } | undefined;
  rememberModels(cache: { models: ModelInfo[]; at: number }): void;
  /** The model list read in flight, or a new `loadModels`. */
  loadModelsOnce(): Promise<ModelInfo[]>;
}

/**
 * The device's balance from its `key_usage` row. A key credited since the last snapshot normally
 * has a row from `recordKeyLimit`; without one the limit for the credits bought and no usage is
 * used. With `fresh` the snapshot is refreshed first (see `refreshForBalance`).
 */
export async function balanceFor(ctx: BalanceContext, deviceId: string, fresh: boolean, now: number): Promise<BalanceView> {
  if (fresh) await refreshForBalance(ctx, deviceId, now);
  const cfg = ctx.config();
  const device = ctx.sql
    .exec<{ nearai_key_id: string | null; credits_bought: number; waiting: number }>(
      `SELECT nearai_key_id, credits_bought,
              EXISTS (SELECT 1 FROM pending_keys WHERE device_id = devices.id) AS waiting
       FROM devices WHERE id = ?`,
      deviceId,
    )
    .toArray()[0];
  if (!device) throw new Error("unknown device");
  const updatedAt = new Date(ctx.snapshotTakenAt()).toISOString();
  if (device.nearai_key_id === null) return { credits: 0, usedCredits: 0, keyReady: false, updatedAt };

  const row = ctx.sql
    .exec<{ limit_nano: number | null; usage_nano: number | null }>(
      "SELECT limit_nano, usage_nano FROM key_usage WHERE key_id = ?",
      device.nearai_key_id,
    )
    .toArray()[0];
  const limit = row?.limit_nano != null ? BigInt(row.limit_nano) : spendLimitNano(device.credits_bought, cfg);
  const usage = BigInt(row?.usage_nano ?? 0);
  return {
    credits: balanceCredits(limit, usage, cfg),
    usedCredits: creditsFromNano(usage, cfg),
    keyReady: device.waiting === 0,
    updatedAt,
  };
}

/**
 * Refresh in the app. NEAR AI has no per-key total cheaper than the key list, so this reuses
 * `refreshSnapshot` (its race guard and access-token retry included), and is bounded so devices
 * cannot turn Refresh into a stream of key-list reads: once per 30 s per device, once per 30 s
 * for the server as a whole, and not at all when the snapshot is already that young. A window is
 * used up only by a refresh that is made: both are checked first, then both taken, with no await
 * in between, so a Refresh that was answered from a young snapshot or refused by the server's
 * window does not hold the device's back. A device without a key has nothing to read. A NEAR AI
 * failure is logged and the cached row is served, never an error: the balance on screen stays usable.
 */
export async function refreshForBalance(ctx: BalanceContext, deviceId: string, now: number): Promise<void> {
  const hasKey = ctx.sql.exec("SELECT 1 FROM devices WHERE id = ? AND nearai_key_id IS NOT NULL", deviceId).toArray().length > 0;
  if (!hasKey) return;
  if (now - ctx.snapshotTakenAt() < FRESH_BALANCE_MS) return;
  const deviceKey = `fresh:${deviceId}`;
  if (!windowIsFree(ctx.sql, deviceKey, now) || !windowIsFree(ctx.sql, FRESH_ALL_KEY, now)) return;
  ctx.rateLimit(deviceKey, 1, FRESH_BALANCE_MS, now);
  ctx.rateLimit(FRESH_ALL_KEY, 1, FRESH_BALANCE_MS, now);
  try {
    await ctx.refreshSnapshotOnce(now);
  } catch (error) {
    console.error(`Balance refresh failed: ${describeError(error)}`);
  }
}

/**
 * The models users may pick: the configured allowlist that NEAR AI marks verifiable, cached 10
 * minutes in memory and in SQLite; possibly empty, when NEAR AI marks none of them verifiable. When
 * NEAR AI cannot be read or its answer cannot be used (`loadModels`), the last good list is served
 * however old, also after an eviction, less any model that answer marked not verifiable;
 * `upstream` only when there never was one.
 */
export async function models(ctx: ModelsContext, now: number): Promise<{ models: ModelInfo[] } | { error: "upstream" }> {
  const cached = ctx.cachedModels();
  if (cached && now - cached.at < MODELS_CACHE_MS) return { models: cached.models };
  try {
    const list = await ctx.loadModelsOnce();
    ctx.rememberModels({ models: list, at: now });
    return { models: list };
  } catch (error) {
    console.error(`Reading the NEAR AI model list failed: ${describeError(error)}`);
    const last = ctx.cachedModels();
    if (!last) return { error: "upstream" };
    // A model even an unusable answer marks not verifiable leaves the last list for good.
    const dropped = error instanceof UnusableModelList ? error.notVerifiable : [];
    const kept = last.models.filter((model) => !dropped.includes(model.id));
    if (kept.length !== last.models.length) ctx.rememberModels({ models: kept, at: last.at });
    return { models: kept };
  }
}

/** Writes the model list read from NEAR AI, so it outlives the object's memory. */
export function storeModels(sql: SqlStorage, cache: { models: ModelInfo[]; at: number }): void {
  sql.exec(
    "INSERT OR REPLACE INTO models_cache (id, models_json, read_at) VALUES (?, ?, ?)",
    MODELS_ROW_ID,
    JSON.stringify(cache.models),
    cache.at,
  );
}

function isModelInfo(value: unknown): value is ModelInfo {
  if (typeof value !== "object" || value === null) return false;
  const { id, inputPerM, outputPerM } = value as Record<string, unknown>;
  return typeof id === "string" && typeof inputPerM === "number" && typeof outputPerM === "number";
}

/**
 * The stored model list, limited to what the allowlist still names (a deploy may have dropped a
 * model since it was read); undefined when there is none or it does not read as a list of models.
 */
export function storedModels(sql: SqlStorage, allowlist: readonly string[]): { models: ModelInfo[]; at: number } | undefined {
  const row = sql.exec<{ models_json: string; read_at: number }>("SELECT models_json, read_at FROM models_cache WHERE id = ?", MODELS_ROW_ID).toArray()[0];
  if (!row) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.models_json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every(isModelInfo)) return undefined;
  return { models: parsed.filter((model) => allowlist.includes(model.id)), at: row.read_at };
}

/**
 * The allowlisted models NEAR AI marks verifiable, in allowlist order. Only TEE models may ever be
 * offered, so an answer that names allowlisted models but marks none verifiable is real data and
 * gives an empty list (fail closed). It throws `UnusableModelList` for an answer that cannot be
 * trusted as a list, so the last good one is served instead (see `models`).
 */
export async function loadModels(ctx: ModelsContext): Promise<ModelInfo[]> {
  const listing = await ctx.nearAi().modelListing();
  const allowlist = ctx.config().models;
  const allowed = (ids: readonly string[]) => ids.filter((id) => allowlist.includes(id));
  const notVerifiable = allowed(listing.notVerifiable);
  const verifiable = new Map(listing.verifiable.map((model) => [model.id, model]));
  if (allowed(listing.unusable).length > 0) {
    throw new UnusableModelList(`NEAR AI listed ${allowed(listing.unusable).join(", ")} with prices that do not read`, notVerifiable);
  }
  if (notVerifiable.length === 0 && !allowlist.some((id) => verifiable.has(id))) {
    throw new UnusableModelList("NEAR AI's model list mentions none of the allowlisted models", []);
  }
  return allowlist.flatMap((id) => {
    const model = verifiable.get(id);
    return model ? [model] : [];
  });
}
