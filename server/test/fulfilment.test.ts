import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { spendLimitNano } from "../src/credits";
import { decrypt, encrypt, randomSecret, sha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import type { TopupStatus } from "../src/ledger/status";
import { NEAR_USDC_ASSET_ID } from "../src/pingpay";
import { FakeNearAi, FakePingPay } from "./fakes";

const ledgerEnv = env as unknown as Env;
const cfg = parseConfig(ledgerEnv);
const NOW = 1_800_000_000_000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const USD = 1_000_000_000n;
const KEY = btoa("k".repeat(32));
const SEED = "seed-refresh-token";
const ALERT_URL = "https://alerts.test/hook";

const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

let ping: FakePingPay;
let near: FakeNearAi;
let alerts: { kind: string; detail: string }[];
let alertsFail: boolean;
let consoleError: ReturnType<typeof vi.spyOn>;

/** One `fetch` for the Ledger: NEAR AI, the alert hook, and PingPay for the rest. */
const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith(cfg.nearAiBase)) return near.fetcher(input, init);
  if (url === ALERT_URL) {
    if (alertsFail) throw new TypeError("network connection lost");
    alerts.push(JSON.parse(String(init?.body)) as { kind: string; detail: string });
    return new Response(null, { status: 204 });
  }
  return ping.fetcher(input, init);
}) as typeof fetch;

beforeEach(async () => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  ping = new FakePingPay();
  ping.expiresAt = () => NOW + 15 * MINUTE_MS;
  near = new FakeNearAi();
  alerts = [];
  alertsFail = false;
  await runInDurableObject(stub(), async (ledger: Ledger, state) => {
    const tables = ["devices", "topups", "reservations", "queue", "pending_keys", "operator", "snapshot", "key_usage", "ratelimits", "events"];
    for (const table of tables) state.storage.sql.exec(`DELETE FROM ${table}`);
    await state.storage.deleteAlarm();
    (ledger as unknown as { env: Env }).env = { ...ledgerEnv, KEY_ENCRYPTION_KEY: KEY, OPERATOR_REFRESH_TOKEN: SEED, ALERT_URL };
    // A test may have replaced the env and parsed it; this test starts from wrangler.jsonc's values.
    (ledger as unknown as { parsedConfig: unknown }).parsedConfig = undefined;
    ledger.fetcher = fetcher;
    ledger.requestTimeoutMs = 15 * SECOND_MS;
  });
});

afterEach(async () => {
  consoleError.mockRestore();
  await runInDurableObject(stub(), (_ledger, state) => state.storage.deleteAlarm());
});

async function newDevice(): Promise<{ deviceId: string; secret: string }> {
  const secret = randomSecret();
  const result = await stub().registerDevice(await sha256Hex(secret));
  if ("error" in result) throw new Error("could not register a test device");
  return { deviceId: result.deviceId, secret };
}

/** Stock of exactly `credits` sellable credits, as both the snapshot and NEAR AI say. */
async function seedStock(credits: number, takenAt = NOW): Promise<void> {
  near.remainingNano = cfg.stockBufferNano + (BigInt(credits) * USD) / 120n + 1_000_000n;
  await stub().setSnapshot(near.remainingNano, 0n, takenAt);
}

async function checkout(deviceId: string, at = NOW): Promise<{ topupId: string; sessionId: string }> {
  const created = await stub().createTopup(deviceId, 5, at);
  if ("error" in created) throw new Error(`could not create a top-up: ${created.error}`);
  return { topupId: created.topupId, sessionId: created.sessionUrl.split("/").pop()! };
}

/** A $5 top-up of `deviceId` whose payment PingPay has confirmed. */
async function paidTopup(deviceId: string, at = NOW): Promise<string> {
  const { topupId, sessionId } = await checkout(deviceId, at);
  ping.pay(sessionId);
  await stub().onSessionEvent(sessionId, null, at);
  return topupId;
}

function tick(now: number): Promise<void> {
  return runInDurableObject(stub(), (ledger: Ledger) => ledger.runAlarm(now));
}

/** Replaces the Ledger's env for this test and forgets the parsed config it cached. */
async function setVars(vars: Partial<Env>): Promise<void> {
  await runInDurableObject(stub(), (ledger) => {
    const self = ledger as unknown as { env: Env; parsedConfig: unknown };
    self.env = { ...self.env, ...vars };
    self.parsedConfig = undefined;
  });
}

/** A cached operator access token, so the tick spends no fetch refreshing it. */
async function seedOperator(now: number): Promise<void> {
  const access = await encrypt(KEY, "access-token");
  const refresh = await encrypt(KEY, "refresh-token");
  await runInDurableObject(stub(), (_ledger, state) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO operator (id, refresh_token_ciphertext, seed_hash, access_token, access_expires_at, version)
       VALUES (1, ?, NULL, ?, ?, 1)`,
      refresh,
      access,
      now + 30 * MINUTE_MS,
    );
  });
}

/** `count` devices, each with a paid $5 top-up and a due credit item. */
async function seedCreditQueue(count: number): Promise<void> {
  await runInDurableObject(stub(), (_ledger, state) => {
    for (let i = 0; i < count; i += 1) {
      const sql = state.storage.sql;
      sql.exec("INSERT INTO devices (id, secret_hash, created_at) VALUES (?, ?, ?)", `d-${i}`, `hash-${i}`, NOW);
      sql.exec(
        "INSERT INTO topups (id, device_id, package_usd, credits, status, created_at, updated_at) VALUES (?, ?, 5, 500, 'paid', ?, ?)",
        `t-${i}`,
        `d-${i}`,
        NOW,
        NOW,
      );
      sql.exec("INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES (?, 'credit', ?, 0, ?, ?)", `q-${i}`, `t-${i}`, NOW, NOW);
    }
  });
}

type QueueRow = { id: string; kind: string; ref: string; attempts: number; next_at: number };

function rows() {
  return runInDurableObject(stub(), (_ledger, state) => {
    const sql = state.storage.sql;
    return {
      topups: sql.exec<{ id: string; status: TopupStatus }>("SELECT id, status FROM topups ORDER BY created_at, id").toArray(),
      reservations: sql.exec<{ topup_id: string; expires_at: number }>("SELECT topup_id, expires_at FROM reservations").toArray(),
      queue: sql.exec<QueueRow>("SELECT id, kind, ref, attempts, next_at FROM queue").toArray(),
      devices: sql.exec<{ id: string; nearai_key_id: string | null; credits_bought: number }>("SELECT id, nearai_key_id, credits_bought FROM devices").toArray(),
      pendingKeys: sql.exec<{ device_id: string; key_ciphertext: string; expires_at: number }>("SELECT * FROM pending_keys").toArray(),
    };
  });
}

async function statusOf(topupId: string): Promise<TopupStatus | undefined> {
  return (await rows()).topups.find((topup) => topup.id === topupId)?.status;
}

function getKey(secret?: string): Promise<Response> {
  const headers = new Headers();
  if (secret) headers.set("Authorization", `Bearer ${secret}`);
  return exports.default.fetch(new Request("https://credits.test/v1/key", { headers }));
}

const loggedText = () => consoleError.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");

describe("credit queue", () => {
  it("creates one key for a new device's first top-up and hands it over once", async () => {
    await seedStock(10_000);
    const { deviceId, secret } = await newDevice();
    const topupId = await paidTopup(deviceId);

    await tick(NOW);

    const creates = near.calls.filter((call) => call.route === "create");
    expect(creates).toEqual([
      expect.objectContaining({ auth: "Bearer acc-1", body: { name: `zorvo-${deviceId}`, spendLimit: { amount: 4166666666, currency: "USD" } } }),
    ]);
    const { topups, reservations, queue, devices, pendingKeys } = await rows();
    expect(topups).toEqual([{ id: topupId, status: "credited" }]);
    expect(reservations).toEqual([]);
    expect(queue).toEqual([]);
    expect(devices).toEqual([{ id: deviceId, nearai_key_id: "key-1", credits_bought: 500 }]);
    expect(pendingKeys).toHaveLength(1);
    expect(pendingKeys[0]!.key_ciphertext).not.toContain("sk-secret-1");
    expect(await decrypt(KEY, pendingKeys[0]!.key_ciphertext)).toBe("sk-secret-1");
    expect(pendingKeys[0]!.expires_at).toBe(NOW + DAY_MS);

    expect((await getKey()).status).toBe(401);
    const first = await getKey(secret);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ key: "sk-secret-1" });
    const second = await getKey(secret);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "not_found" });
    expect((await rows()).pendingKeys).toEqual([]);
    expect(loggedText()).not.toContain("sk-secret");
  });

  it("does not hand one device's key to another", async () => {
    await seedStock(10_000);
    const owner = await newDevice();
    const other = await newDevice();
    await paidTopup(owner.deviceId);
    await tick(NOW);
    expect((await getKey(other.secret)).status).toBe(404);
    expect((await getKey(owner.secret)).status).toBe(200);
  });

  it("hands a key over once to two calls at once", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    await paidTopup(deviceId);
    await tick(NOW);
    const taken = await runInDurableObject(stub(), (ledger: Ledger) => Promise.all([ledger.takeKey(deviceId), ledger.takeKey(deviceId)]));
    expect(taken.sort()).toEqual(["sk-secret-1", null].sort());
  });

  it("race 5: sets a second top-up's limit to the absolute total, and a repeated PATCH sends the same body", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    await paidTopup(deviceId);
    await tick(NOW);
    const second = await paidTopup(deviceId, NOW + MINUTE_MS);

    near.status.patch = 503;
    await tick(NOW + MINUTE_MS);
    delete near.status.patch;
    await tick(NOW + MINUTE_MS + 30 * SECOND_MS);

    const patches = near.calls.filter((call) => call.route === "patch");
    const body = { spendLimit: { amount: Number(spendLimitNano(1000, cfg)), currency: "USD" } };
    expect(patches).toEqual([expect.objectContaining({ path: `/workspaces/${cfg.workspaceId}/api-keys/key-1/spend-limit`, body }), expect.objectContaining({ body })]);
    expect(near.count("create")).toBe(1);
    const { devices, queue } = await rows();
    expect(devices[0]).toMatchObject({ nearai_key_id: "key-1", credits_bought: 1000 });
    expect(queue).toEqual([]);
    expect(await statusOf(second)).toBe("credited");
    expect(near.keys.get("key-1")?.limitNano).toBe(spendLimitNano(1000, cfg));
  });

  it("race 7: a reservation made while createKey is pending is decided from the recorded state", async () => {
    await seedStock(1000);
    const a = await newDevice();
    const b = await newDevice();
    const c = await newDevice();
    const topupId = await paidTopup(a.deviceId);
    const hold = near.hold("create");

    await runInDurableObject(stub(), async (ledger: Ledger, state) => {
      const running = ledger.runAlarm(NOW);
      await hold.started;
      const bought = () => state.storage.sql.exec<{ credits_bought: number }>("SELECT credits_bought FROM devices WHERE id = ?", a.deviceId).one().credits_bought;
      // Recorded before the call, and still held: the 500 credits count twice, never zero times.
      expect(bought()).toBe(500);
      expect(ledger.stockFor(a.deviceId, NOW).yourRoomCredits).toBe(cfg.deviceCapCredits - 1000);
      expect(ledger.reserve(b.deviceId, 500, 5, NOW)).toHaveProperty("topupId");
      expect(ledger.reserve(c.deviceId, 500, 5, NOW)).toEqual({ error: "stock" });

      hold.release();
      await running;
      expect(bought()).toBe(500);
      expect(ledger.stockFor(a.deviceId, NOW).yourRoomCredits).toBe(cfg.deviceCapCredits - 500);
      // The released hold is replaced by the key's limit at once, so the stock does not grow back.
      expect(ledger.stockFor(c.deviceId, NOW).availableCredits).toBe(0);
    });
    expect(await statusOf(topupId)).toBe("credited");
  });

  it("race 7: a key the device got while createKey was pending is kept, and the new one is revoked", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const topupId = await paidTopup(deviceId);
    near.keys.set("key-other", { name: "other", limitNano: 0n, usageNano: 0n, secret: "sk-other" });
    const hold = near.hold("create");

    await runInDurableObject(stub(), async (ledger: Ledger, state) => {
      const running = ledger.runAlarm(NOW);
      await hold.started;
      state.storage.sql.exec("UPDATE devices SET nearai_key_id = 'key-other' WHERE id = ?", deviceId);
      hold.release();
      await running;
    });

    expect(near.calls.filter((call) => call.route === "revoke").map((call) => call.path)).toEqual([`/workspaces/${cfg.workspaceId}/api-keys/key-1`]);
    let state = await rows();
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-other", credits_bought: 500 });
    expect(state.pendingKeys).toEqual([]);
    expect(await statusOf(topupId)).toBe("paid");

    await tick(NOW + 30 * SECOND_MS);
    expect(near.calls.filter((call) => call.route === "patch").map((call) => call.path)).toEqual([`/workspaces/${cfg.workspaceId}/api-keys/key-other/spend-limit`]);
    state = await rows();
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-other", credits_bought: 500 });
    expect(await statusOf(topupId)).toBe("credited");
  });

  it("retries a NEAR AI 503 after 30 s, then 60 s, alerts on the 10th failure and keeps the top-up paid", async () => {
    await seedStock(10_000);
    const { secret, deviceId } = await newDevice();
    const topupId = await paidTopup(deviceId);
    near.status.create = 503;

    await tick(NOW);
    expect(near.count("create")).toBe(1);
    await tick(NOW + 30 * SECOND_MS - 1);
    expect(near.count("create")).toBe(1);
    await tick(NOW + 30 * SECOND_MS);
    expect(near.count("create")).toBe(2);
    await tick(NOW + 90 * SECOND_MS - 1);
    expect(near.count("create")).toBe(2);
    await tick(NOW + 90 * SECOND_MS);
    expect(near.count("create")).toBe(3);

    for (let attempt = 3; attempt < 10; attempt += 1) {
      expect(alerts.filter((alert) => alert.kind === "attempts_exhausted")).toEqual([]);
      await tick((await rows()).queue[0]!.next_at);
    }
    expect(near.count("create")).toBe(10);
    const exhausted = alerts.filter((alert) => alert.kind === "attempts_exhausted");
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.detail).toContain(topupId);

    const item = (await rows()).queue[0]!;
    expect(item).toMatchObject({ kind: "credit", ref: topupId, attempts: 10 });
    await tick(item.next_at);
    expect(near.count("create")).toBe(11);
    expect((await rows()).queue[0]!.next_at - item.next_at).toBe(30 * MINUTE_MS);
    expect(alerts.filter((alert) => alert.kind === "attempts_exhausted")).toHaveLength(1);

    const res = await exports.default.fetch(new Request(`https://credits.test/v1/topups/${topupId}`, { headers: { Authorization: `Bearer ${secret}` } }));
    expect(await res.json()).toEqual({ status: "paid", credits: 500 });
    expect((await rows()).devices[0]).toMatchObject({ nearai_key_id: null, credits_bought: 500 });
  });

  it("backs off 30 s × 2^(attempts − 1), at most 30 minutes", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    await paidTopup(deviceId);
    near.status.create = 503;
    let at = NOW;
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await tick(at);
      const next = (await rows()).queue[0]!.next_at;
      delays.push(next - at);
      at = next;
    }
    expect(delays.map((ms) => ms / SECOND_MS)).toEqual([30, 60, 120, 240, 480, 960, 1800, 1800, 1800]);
  });

  it("alerts a queue item older than an hour, at most once an hour", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const topupId = await paidTopup(deviceId);
    near.status.create = 503;

    await tick(NOW + 59 * MINUTE_MS);
    expect(alerts.filter((alert) => alert.kind === "stuck_queue")).toEqual([]);
    await tick(NOW + 61 * MINUTE_MS);
    await tick(NOW + 62 * MINUTE_MS);
    const stuck = alerts.filter((alert) => alert.kind === "stuck_queue");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.detail).toContain(topupId);
    await tick(NOW + 122 * MINUTE_MS);
    expect(alerts.filter((alert) => alert.kind === "stuck_queue")).toHaveLength(2);
  });

  it("runs at most 5 credit items a tick by default, leaving the rest queued", async () => {
    await seedCreditQueue(25);
    await tick(NOW);
    expect(near.count("create")).toBe(5);
    expect((await rows()).queue).toHaveLength(20);
    await tick(NOW + SECOND_MS);
    expect(near.count("create")).toBe(10);
    expect((await rows()).queue).toHaveLength(15);
  });

  it("runs the configured number of credit items a tick", async () => {
    await setVars({ CREDITS_PER_TICK: "20", TICK_SUBREQUEST_BUDGET: "100" });
    await seedCreditQueue(25);
    await tick(NOW);
    expect(near.count("create")).toBe(20);
    expect((await rows()).queue).toHaveLength(5);
  });

  it("stops starting queue items once the tick's subrequest budget is spent", async () => {
    await setVars({ TICK_SUBREQUEST_BUDGET: "2" });
    await seedOperator(NOW);
    await seedStock(10_000);
    await seedCreditQueue(25);
    await tick(NOW);
    expect(near.count("create")).toBe(1);
    expect((await rows()).queue).toHaveLength(24);
    await tick(NOW + SECOND_MS);
    expect(near.count("create")).toBe(2);
    expect((await rows()).queue).toHaveLength(23);
  });

  it("race 7: a top-up's snapshot refresh that listed the keys before a credit landed keeps the credit's limit", async () => {
    await seedStock(1000, NOW - MINUTE_MS);
    const a = await newDevice();
    const b = await newDevice();
    const c = await newDevice();
    const paid = await paidTopup(a.deviceId, NOW - MINUTE_MS);
    const listing = near.hold("list");

    await runInDurableObject(stub(), async (ledger: Ledger, state) => {
      const later = NOW + 2 * MINUTE_MS;
      const buying = ledger.createTopup(b.deviceId, 5, later);
      await listing.started;
      // The snapshot is a minute old for the alarm, so it does not refresh: it credits A.
      await ledger.runAlarm(NOW);
      const status = state.storage.sql.exec<{ status: string }>("SELECT status FROM topups WHERE id = ?", paid).one().status;
      expect(status).toBe("credited");

      listing.release();
      expect(await buying).toHaveProperty("topupId");
      const outstanding = state.storage.sql.exec<{ outstanding_usd: number }>("SELECT outstanding_usd FROM snapshot").one().outstanding_usd;
      expect(outstanding).toBe(Number(spendLimitNano(500, cfg)));
      expect(ledger.stockFor(c.deviceId, later).availableCredits).toBe(0);
    });
  });

  it("leaves a queue item of a kind it has no handler for untouched", async () => {
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec("INSERT INTO queue (id, kind, ref, attempts, next_at) VALUES ('q-1', 'mystery', 'device-1', 0, ?)", NOW);
    });
    await tick(NOW + MINUTE_MS);
    expect((await rows()).queue).toEqual([{ id: "q-1", kind: "mystery", ref: "device-1", attempts: 0, next_at: NOW }]);
  });

  it("race 8: two alarm runs at once process an item once", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    await paidTopup(deviceId);
    const hold = near.hold("create");
    await runInDurableObject(stub(), async (ledger: Ledger) => {
      const first = ledger.runAlarm(NOW);
      await hold.started;
      const second = ledger.runAlarm(NOW);
      expect(second).toBe(first);
      hold.release();
      await Promise.all([first, second]);
    });
    expect(near.count("create")).toBe(1);
    expect((await rows()).devices[0]).toMatchObject({ credits_bought: 500 });
  });
});

describe("alarm", () => {
  it("completes a created top-up whose webhook never came, once it is older than 2 minutes", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId);
    ping.pay(sessionId);
    const sessionReads = () => ping.calls.filter((call) => call.method === "GET" && call.url.endsWith(`/checkout/sessions/${sessionId}`)).length;

    await tick(NOW + 2 * MINUTE_MS);
    expect(sessionReads()).toBe(0);
    expect(await statusOf(topupId)).toBe("created");

    await tick(NOW + 2 * MINUTE_MS + 1);
    expect(sessionReads()).toBe(1);
    expect(await statusOf(topupId)).toBe("credited");
    expect(near.count("create")).toBe(1);
  });

  it("finds a late payment on an expired top-up younger than 7 days, and stops looking after that", async () => {
    await seedStock(10_000);
    const recent = await newDevice();
    const old = await newDevice();
    const fresh = await checkout(recent.deviceId);
    const stale = await checkout(old.deviceId, NOW - 8 * DAY_MS);
    for (const [device, topup] of [[recent, fresh], [old, stale]] as const) {
      await stub().cancelTopup(device.deviceId, topup.topupId, NOW);
      ping.pay(topup.sessionId);
    }
    expect(await statusOf(fresh.topupId)).toBe("expired");

    await tick(NOW + 3 * MINUTE_MS);
    expect(await statusOf(fresh.topupId)).toBe("credited");
    expect(await statusOf(stale.topupId)).toBe("expired");
    expect(ping.calls.some((call) => call.url.endsWith(`/checkout/sessions/${stale.sessionId}`))).toBe(false);
  });

  it("polls at most 3 sessions a tick by default, none again before its next poll, and still runs the queue", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const paid = await paidTopup(deviceId);
    await runInDurableObject(stub(), (_ledger, state) => {
      for (let i = 0; i < 50; i += 1) {
        state.storage.sql.exec(
          `INSERT INTO topups (id, device_id, package_usd, credits, status, ping_session_id, created_at, updated_at)
           VALUES (?, ?, 5, 500, 'expired', ?, ?, ?)`,
          `t-${i}`,
          deviceId,
          `cs_old_${i}`,
          NOW - HOUR_MS,
          NOW - HOUR_MS,
        );
      }
    });
    for (let i = 0; i < 50; i += 1) {
      ping.sessions.set(`cs_old_${i}`, { status: "EXPIRED", paymentId: null, body: {}, amount: { assetId: NEAR_USDC_ASSET_ID, amount: "5000000" } });
    }
    const reads = () => ping.calls.filter((call) => /\/checkout\/sessions\/cs_old_/.test(call.url)).map((call) => call.url.split("/").pop());

    await tick(NOW);
    expect(reads()).toHaveLength(3);
    expect(await statusOf(paid)).toBe("credited");

    for (let second = 1; second < 18; second += 1) await tick(NOW + second * SECOND_MS);
    expect(reads()).toHaveLength(50);
    expect(new Set(reads()).size).toBe(50);
    await tick(NOW + 18 * SECOND_MS);
    expect(reads()).toHaveLength(50);
  });

  it("stops polling once the tick's subrequest budget is spent", async () => {
    await setVars({ TICK_SUBREQUEST_BUDGET: "1" });
    await seedOperator(NOW);
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    await runInDurableObject(stub(), (_ledger, state) => {
      for (let i = 0; i < 5; i += 1) {
        state.storage.sql.exec(
          `INSERT INTO topups (id, device_id, package_usd, credits, status, ping_session_id, created_at, updated_at)
           VALUES (?, ?, 5, 500, 'expired', ?, ?, ?)`,
          `t-${i}`,
          deviceId,
          `cs_old_${i}`,
          NOW - HOUR_MS,
          NOW - HOUR_MS,
        );
        ping.sessions.set(`cs_old_${i}`, { status: "EXPIRED", paymentId: null, body: {}, amount: { assetId: NEAR_USDC_ASSET_ID, amount: "5000000" } });
      }
    });
    const reads = () => ping.calls.filter((call) => /\/checkout\/sessions\/cs_old_/.test(call.url)).length;

    await tick(NOW);
    expect(reads()).toBe(1);
  });

  it("backs off polling an abandoned checkout: 1 minute, then 2, 4, up to an hour", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId);
    await stub().cancelTopup(deviceId, topupId, NOW);
    const readTimes: number[] = [];
    let at = NOW;
    for (let minute = 0; minute <= 200; minute += 1) {
      at = NOW + minute * MINUTE_MS;
      const before = ping.calls.length;
      await tick(at);
      if (ping.calls.slice(before).some((call) => call.url.endsWith(`/checkout/sessions/${sessionId}`))) readTimes.push(minute);
    }
    expect(readTimes).toEqual([0, 1, 3, 7, 15, 31, 63, 123, 183]);
  });

  it("keeps polling a created checkout every minute while it can still be paid", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { sessionId } = await checkout(deviceId);
    const reads = () => ping.calls.filter((call) => call.url.endsWith(`/checkout/sessions/${sessionId}`)).length;
    for (let minute = 3; minute <= 10; minute += 1) await tick(NOW + minute * MINUTE_MS);
    expect(reads()).toBe(8);
  });

  it("schedules the next alarm when a tick starts, and runs the later steps once a hung call times out", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId);
    ping.pay(sessionId);
    near.hang.add("refresh");

    await runInDurableObject(stub(), async (ledger: Ledger, state) => {
      ledger.requestTimeoutMs = 50;
      const running = ledger.runAlarm(NOW + 3 * MINUTE_MS);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await state.storage.getAlarm()).toBe(NOW + 4 * MINUTE_MS);
      await running;
    });

    expect(await statusOf(topupId)).toBe("paid");
    expect(alerts.map((alert) => alert.kind)).toContain("refresh_failed");
    expect((await rows()).queue).toEqual([expect.objectContaining({ ref: topupId, attempts: 1 })]);
  });

  it("tries an unsettled session again on the next tick without failing the alarm", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId);
    ping.pay(sessionId, "PENDING");

    await tick(NOW + 3 * MINUTE_MS);
    expect(await statusOf(topupId)).toBe("created");
    ping.payments.set(`pay_${sessionId}`, "SUCCESS");
    await tick(NOW + 4 * MINUTE_MS);
    expect(await statusOf(topupId)).toBe("credited");
  });

  it("raises payment_mismatch for a paid session that charged another amount, at most once an hour per top-up", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId);
    ping.pay(sessionId);
    ping.restate(sessionId, { assetId: NEAR_USDC_ASSET_ID, amount: "1000000" });

    const reads = () => ping.calls.filter((call) => call.url.endsWith(`/checkout/sessions/${sessionId}`)).length;

    await tick(NOW + 3 * MINUTE_MS);
    await tick(NOW + 4 * MINUTE_MS);
    const mismatches = () => alerts.filter((alert) => alert.kind === "payment_mismatch");
    expect(mismatches()).toHaveLength(1);
    expect(mismatches()[0]!.detail).toContain(topupId);
    expect(await statusOf(topupId)).toBe("created");
    // A mismatch is asked about again an hour later, not every minute.
    expect(reads()).toBe(1);
    await tick(NOW + 62 * MINUTE_MS);
    expect(reads()).toBe(1);

    await tick(NOW + 63 * MINUTE_MS);
    expect(reads()).toBe(2);
    expect(mismatches()).toHaveLength(2);
  });

  it("expires reservations past their time but never a paid top-up's hold", async () => {
    await seedStock(10_000);
    const buyer = await newDevice();
    const browser = await newDevice();
    const paid = await paidTopup(buyer.deviceId);
    const open = await checkout(browser.deviceId);
    near.status.create = 503;

    await tick(NOW + 365 * DAY_MS);
    const { reservations } = await rows();
    expect(reservations.map((r) => r.topup_id)).toEqual([paid]);
    expect(await statusOf(paid)).toBe("paid");
    // Its hold ended more than 7 days before the tick, so the sweep also expired it.
    expect(await statusOf(open.topupId)).toBe("expired");
  });

  it("expires a created top-up whose hold ended more than 7 days ago and keeps a younger one", async () => {
    await seedStock(10_000);
    const old = await newDevice();
    const young = await newDevice();
    const stale = await checkout(old.deviceId, NOW - 8 * DAY_MS);
    const recent = await checkout(young.deviceId, NOW - 6 * DAY_MS);

    await tick(NOW);

    expect(await statusOf(stale.topupId)).toBe("expired");
    expect(await statusOf(recent.topupId)).toBe("created");
    expect((await rows()).reservations).toEqual([]);
  });

  it("purges rate-limit windows older than 24 hours and webhook events older than 30 days, keeping younger ones", async () => {
    await seedStock(10_000);
    await runInDurableObject(stub(), (_ledger, state) => {
      const sql = state.storage.sql;
      sql.exec("INSERT INTO ratelimits (key, count, window_start) VALUES ('old', 1, ?), ('young', 1, ?)", NOW - 25 * HOUR_MS, NOW - 23 * HOUR_MS);
      sql.exec("INSERT INTO events (id, received_at) VALUES ('evt_old', ?), ('evt_young', ?)", NOW - 31 * DAY_MS, NOW - 29 * DAY_MS);
    });

    await tick(NOW);

    const left = await runInDurableObject(stub(), (_ledger, state) => ({
      limits: state.storage.sql.exec<{ key: string }>("SELECT key FROM ratelimits WHERE key IN ('old', 'young')").toArray().map((r) => r.key),
      events: state.storage.sql.exec<{ id: string }>("SELECT id FROM events ORDER BY id").toArray().map((r) => r.id),
    }));
    expect(left).toEqual({ limits: ["young"], events: ["evt_young"] });
  });

  it("deletes a pending key once it is 24 hours old", async () => {
    await seedStock(10_000);
    const { deviceId, secret } = await newDevice();
    await paidTopup(deviceId);
    await tick(NOW);
    await tick(NOW + DAY_MS - 1);
    expect((await rows()).pendingKeys).toHaveLength(1);
    await tick(NOW + DAY_MS);
    expect((await rows()).pendingKeys).toEqual([]);
    expect((await getKey(secret)).status).toBe(404);
  });

  it("promotes top-ups waiting for stock oldest first while the stock allows, queueing each credit once", async () => {
    await seedStock(500);
    const first = await newDevice();
    const second = await newDevice();
    await runInDurableObject(stub(), (_ledger, state) => {
      for (const [id, device, at] of [["t-second", second.deviceId, NOW - MINUTE_MS], ["t-first", first.deviceId, NOW - 2 * MINUTE_MS]] as const) {
        state.storage.sql.exec(
          `INSERT INTO topups (id, device_id, package_usd, credits, status, created_at, updated_at)
           VALUES (?, ?, 5, 500, 'paid_waiting_stock', ?, ?)`,
          id,
          device,
          at,
          at,
        );
      }
    });
    near.status.create = 503;

    await tick(NOW);
    await tick(NOW + MINUTE_MS);
    let state = await rows();
    expect(state.topups.map((t) => [t.id, t.status])).toEqual([["t-first", "paid"], ["t-second", "paid_waiting_stock"]]);
    expect(state.queue.map((q) => q.ref)).toEqual(["t-first"]);
    expect(state.reservations.map((r) => r.topup_id)).toEqual(["t-first"]);

    delete near.status.create;
    await tick(NOW + 2 * MINUTE_MS);
    state = await rows();
    expect(state.topups.map((t) => [t.id, t.status])).toEqual([["t-first", "credited"], ["t-second", "paid_waiting_stock"]]);
    expect(state.queue).toEqual([]);

    near.remainingNano += spendLimitNano(500, cfg);
    await tick(NOW + 5 * MINUTE_MS);
    expect(await statusOf("t-second")).toBe("credited");
  });

  it("raises low_stock after a refresh that leaves less than $3, at most once an hour", async () => {
    await seedStock(10_000, NOW - 3 * MINUTE_MS);
    near.remainingNano = cfg.stockBufferNano + spendLimitNano(300, cfg) + 1_000_000n;
    const lows = () => alerts.filter((alert) => alert.kind === "low_stock");

    await tick(NOW);
    expect(lows()).toHaveLength(1);
    await tick(NOW + 3 * MINUTE_MS);
    expect(lows()).toHaveLength(1);
    await tick(NOW + 61 * MINUTE_MS);
    expect(lows()).toHaveLength(2);
  });

  it("raises no low_stock while $3 or more is left", async () => {
    await seedStock(400, NOW - 3 * MINUTE_MS);
    await tick(NOW);
    expect(alerts).toEqual([]);
  });

  it("raises refresh_failed without the token, runs the other steps and reschedules, even when the alert cannot be sent", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId);
    ping.pay(sessionId);
    near.status.refresh = 401;
    alertsFail = true;

    await tick(NOW + 3 * MINUTE_MS);

    expect(await statusOf(topupId)).toBe("paid");
    expect((await rows()).queue).toEqual([expect.objectContaining({ ref: topupId, attempts: 1 })]);
    expect(await runInDurableObject(stub(), (_ledger, state) => state.storage.getAlarm())).toBe(NOW + 3 * MINUTE_MS + MINUTE_MS);
    const logged = loggedText();
    expect(logged).toContain("refresh_failed");
    expect(logged).not.toContain(SEED);

    alertsFail = false;
    await tick(NOW + 2 * HOUR_MS);
    const failed = alerts.filter((alert) => alert.kind === "refresh_failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(JSON.stringify(failed)).not.toContain(SEED);
  });

  it("is set by the first registration and the first top-up, and reschedules itself a minute later", async () => {
    const alarm = () => runInDurableObject(stub(), (_ledger, state) => state.storage.getAlarm());
    const before = Date.now();
    const { deviceId } = await newDevice();
    expect(await alarm()).toBeGreaterThanOrEqual(before + MINUTE_MS);

    await runInDurableObject(stub(), (_ledger, state) => state.storage.deleteAlarm());
    await seedStock(10_000, Date.now());
    ping.expiresAt = () => Date.now() + 15 * MINUTE_MS;
    await checkout(deviceId, Date.now());
    expect(await alarm()).not.toBeNull();

    const ranAt = Date.now();
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    expect(await alarm()).toBeGreaterThanOrEqual(ranAt + MINUTE_MS);
  });
});

describe("POST /v1/topups with a stale snapshot", () => {
  it("refreshes a snapshot older than 2 minutes before it reserves", async () => {
    await seedStock(10_000, NOW - 3 * MINUTE_MS);
    near.remainingNano = 0n;
    const { deviceId } = await newDevice();
    expect(await stub().createTopup(deviceId, 5, NOW)).toEqual({ error: "stock" });
    expect(near.count("balance")).toBe(1);
    expect(ping.calls).toEqual([]);

    await stub().setSnapshot(0n, 0n, NOW - 3 * MINUTE_MS);
    near.remainingNano = 1_000n * USD;
    expect(await stub().createTopup(deviceId, 5, NOW)).toHaveProperty("topupId");
  });

  it("goes on with a snapshot under 10 minutes old when the refresh fails", async () => {
    await seedStock(10_000, NOW - 5 * MINUTE_MS);
    near.status.balance = 503;
    const { deviceId } = await newDevice();
    expect(await stub().createTopup(deviceId, 5, NOW)).toHaveProperty("topupId");
  });

  it("answers 409 stock when the refresh fails and the snapshot is older than 10 minutes", async () => {
    await seedStock(10_000, Date.now() - 11 * MINUTE_MS);
    near.status.balance = 503;
    const { secret } = await newDevice();
    const res = await exports.default.fetch(
      new Request("https://credits.test/v1/topups", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ packageUsd: 5 }) }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stock" });
    expect(ping.calls).toEqual([]);
  });
});
