import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { randomSecret, sha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import type { TopupStatus } from "../src/ledger/status";
import { FakeNearAi, FakePingPay } from "./fakes";

/**
 * One Ledger with fake NEAR AI, PingPay and alert hook, emptied before every test, for test files
 * that drive the alarm and the routes. `useLedger()` registers the hooks and returns the helpers.
 */

export const ledgerEnv = env as unknown as Env;
export const cfg = parseConfig(ledgerEnv);
export const NOW = 1_800_000_000_000;
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const USD = 1_000_000_000n;
export const KEY = btoa("k".repeat(32));
export const SEED = "seed-refresh-token";
export const ALERT_URL = "https://alerts.test/hook";
const TABLES = [
  "devices", "topups", "reservations", "queue", "pending_keys", "operator", "snapshot", "key_usage",
  "ratelimits", "events", "promos", "promo_redemptions", "limits_version", "models_cache",
];

export const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

export type Harness = {
  ping: FakePingPay;
  near: FakeNearAi;
  alerts: { kind: string; detail: string }[];
  logged: () => string;
};

export function useLedger(extraTables: string[] = []): Harness {
  const harness = { alerts: [] } as unknown as Harness;
  let consoleError: ReturnType<typeof vi.spyOn>;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(cfg.nearAiBase)) return harness.near.fetcher(input, init);
    if (url === ALERT_URL) {
      harness.alerts.push(JSON.parse(String(init?.body)) as { kind: string; detail: string });
      return new Response(null, { status: 204 });
    }
    return harness.ping.fetcher(input, init);
  }) as typeof fetch;

  beforeEach(async () => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    harness.ping = new FakePingPay();
    harness.ping.expiresAt = () => NOW + 15 * MINUTE_MS;
    harness.near = new FakeNearAi();
    harness.alerts = [];
    harness.logged = () => consoleError.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");
    await runInDurableObject(stub(), async (ledger: Ledger, state) => {
      for (const table of [...TABLES, ...extraTables]) state.storage.sql.exec(`DELETE FROM ${table}`);
      await state.storage.deleteAlarm();
      (ledger as unknown as { env: Env }).env = { ...ledgerEnv, KEY_ENCRYPTION_KEY: KEY, OPERATOR_REFRESH_TOKEN: SEED, ALERT_URL };
      ledger.fetcher = fetcher;
      ledger.requestTimeoutMs = 15 * SECOND_MS;
    });
  });

  afterEach(async () => {
    consoleError.mockRestore();
    await runInDurableObject(stub(), (_ledger, state) => state.storage.deleteAlarm());
  });

  return harness;
}

export async function newDevice(creditsBought = 0): Promise<{ deviceId: string; secret: string }> {
  const secret = randomSecret();
  const result = await stub().registerDevice(await sha256Hex(secret));
  if ("error" in result) throw new Error("could not register a test device");
  if (creditsBought > 0) await sql((s) => s.exec("UPDATE devices SET credits_bought = ? WHERE id = ?", creditsBought, result.deviceId));
  return { deviceId: result.deviceId, secret };
}

/** Runs `body` on the Ledger's SQLite. */
export function sql<T>(body: (sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(stub(), (_ledger, state) => body(state.storage.sql));
}

/** Stock of exactly `credits` sellable credits, as both the snapshot and NEAR AI say. */
export async function seedStock(harness: Harness, credits: number, takenAt = NOW): Promise<void> {
  harness.near.remainingNano = cfg.stockBufferNano + (BigInt(credits) * USD) / 120n + 1_000_000n;
  await stub().setSnapshot(harness.near.remainingNano, 0n, takenAt);
}

export async function checkout(deviceId: string, at = NOW): Promise<{ topupId: string; sessionId: string }> {
  const created = await stub().createTopup(deviceId, 5, at);
  if ("error" in created) throw new Error(`could not create a top-up: ${created.error}`);
  return { topupId: created.topupId, sessionId: created.sessionUrl.split("/").pop()! };
}

/** A $5 top-up of `deviceId` whose payment PingPay has confirmed. */
export async function paidTopup(harness: Harness, deviceId: string, at = NOW): Promise<string> {
  const { topupId, sessionId } = await checkout(deviceId, at);
  harness.ping.pay(sessionId);
  await stub().onSessionEvent(sessionId, null, at);
  return topupId;
}

export function tick(now: number): Promise<void> {
  return runInDurableObject(stub(), (ledger: Ledger) => ledger.runAlarm(now));
}

export async function statusOf(topupId: string): Promise<TopupStatus | undefined> {
  return sql((s) => s.exec<{ status: TopupStatus }>("SELECT status FROM topups WHERE id = ?", topupId).toArray()[0]?.status);
}

export function call(path: string, init: RequestInit & { secret?: string; ip?: string } = {}): Promise<Response> {
  const { secret, ip, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (secret) headers.set("Authorization", `Bearer ${secret}`);
  if (ip) headers.set("CF-Connecting-IP", ip);
  return exports.default.fetch(new Request(`https://credits.test${path}`, { ...rest, headers }));
}

/** As after an eviction: the Ledger forgets the model list it holds in memory (its stored copy stays). */
export function forgetModelsInMemory(ledger: Ledger): void {
  const self = ledger as unknown as { modelsCache: unknown; modelsLoading: unknown };
  self.modelsCache = undefined;
  self.modelsLoading = undefined;
}
