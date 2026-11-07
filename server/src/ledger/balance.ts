import type { Config } from "../config";
import { balanceCredits, creditsFromNano, spendLimitNano } from "../credits";
import type { NearAiClient } from "../nearai";
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
 * for the server as a whole, and not at all when the snapshot is already that young. A device
 * without a key has nothing to read. A NEAR AI failure is logged and the cached row is served,
 * never an error: the balance on screen stays usable.
 */
export async function refreshForBalance(ctx: BalanceContext, deviceId: string, now: number): Promise<void> {
  const hasKey = ctx.sql.exec("SELECT 1 FROM devices WHERE id = ? AND nearai_key_id IS NOT NULL", deviceId).toArray().length > 0;
  if (!hasKey) return;
  if (!ctx.rateLimit(`fresh:${deviceId}`, 1, FRESH_BALANCE_MS, now).allowed) return;
  if (now - ctx.snapshotTakenAt() < FRESH_BALANCE_MS) return;
  if (!ctx.rateLimit("fresh:all", 1, FRESH_BALANCE_MS, now).allowed) return;
  try {
    await ctx.refreshSnapshotOnce(now);
  } catch (error) {
    console.error(`Balance refresh failed: ${describeError(error)}`);
  }
}

/**
 * The models users may pick: the configured allowlist that NEAR AI marks verifiable, cached 10
 * minutes. When NEAR AI cannot be read the last list is served however old; `upstream` only when
 * there never was one.
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
    return last ? { models: last.models } : { error: "upstream" };
  }
}

export async function loadModels(ctx: ModelsContext): Promise<ModelInfo[]> {
  const verifiable = new Map((await ctx.nearAi().verifiableModels()).map((model) => [model.id, model]));
  return ctx.config().models.flatMap((id) => {
    const model = verifiable.get(id);
    return model ? [model] : [];
  });
}
