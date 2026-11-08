import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { balanceCredits, creditsFromNano, spendLimitNano } from "../src/credits";
import { randomSecret, sha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { FakeNearAi, FakePingPay } from "./fakes";
import { forgetModelsInMemory } from "./harness";

const ledgerEnv = env as unknown as Env;
const cfg = parseConfig(ledgerEnv);
const NOW = 1_800_000_000_000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const USD = 1_000_000_000n;
const KEY = btoa("k".repeat(32));
const SEED = "seed-refresh-token";

const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

let ping: FakePingPay;
let near: FakeNearAi;
let consoleError: ReturnType<typeof vi.spyOn>;

const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) =>
  String(input).startsWith(cfg.nearAiBase) ? near.fetcher(input, init) : ping.fetcher(input, init)) as typeof fetch;

beforeEach(async () => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  ping = new FakePingPay();
  ping.expiresAt = () => NOW + 15 * MINUTE_MS;
  near = new FakeNearAi();
  await runInDurableObject(stub(), async (ledger: Ledger, state) => {
    const tables = ["devices", "topups", "reservations", "queue", "pending_keys", "operator", "snapshot", "key_usage", "ratelimits", "events", "models_cache"];
    for (const table of tables) state.storage.sql.exec(`DELETE FROM ${table}`);
    await state.storage.deleteAlarm();
    (ledger as unknown as { env: Env }).env = { ...ledgerEnv, KEY_ENCRYPTION_KEY: KEY, OPERATOR_REFRESH_TOKEN: SEED };
    ledger.fetcher = fetcher;
    ledger.requestTimeoutMs = 15 * SECOND_MS;
    forgetModelsInMemory(ledger);
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

/** Stock for plenty of top-ups, as both the snapshot and NEAR AI say. */
async function seedStock(takenAt = NOW): Promise<void> {
  near.remainingNano = 1_000n * USD;
  await stub().setSnapshot(near.remainingNano, 0n, takenAt);
}

/** A device whose $5 top-up has been paid and credited (a key with the limit for 500 credits). */
async function creditedDevice(): Promise<{ deviceId: string; secret: string; keyId: string }> {
  await seedStock();
  const device = await newDevice();
  const created = await stub().createTopup(device.deviceId, 5, NOW);
  if ("error" in created) throw new Error(`could not create a top-up: ${created.error}`);
  ping.pay(created.sessionUrl.split("/").pop()!);
  await stub().onSessionEvent(created.sessionUrl.split("/").pop()!, null, NOW);
  await runInDurableObject(stub(), (ledger: Ledger) => ledger.runAlarm(NOW));
  const keyId = [...near.keys.keys()].at(-1)!;
  return { ...device, keyId };
}

const LIMIT_NANO = spendLimitNano(500, cfg);

function balance(deviceId: string, fresh = false, now = NOW) {
  return stub().balanceFor(deviceId, fresh, now);
}

async function takeKey(deviceId: string): Promise<void> {
  await stub().takeKey(deviceId, NOW);
}

describe("balanceFor", () => {
  it("reports the credits left under the key's limit and the credits used, from the last snapshot", async () => {
    const { deviceId, keyId } = await creditedDevice();
    near.keys.set(keyId, { ...near.keys.get(keyId)!, usageNano: 1n * USD });
    await runInDurableObject(stub(), (ledger: Ledger) => ledger.refreshSnapshot(NOW + MINUTE_MS));

    const result = await balance(deviceId, false, NOW + MINUTE_MS);
    expect(result.credits).toBe(balanceCredits(4166666666n, 1000000000n, cfg));
    expect(result.usedCredits).toBe(creditsFromNano(1n * USD, cfg));
    expect(result.updatedAt).toBe(new Date(NOW + MINUTE_MS).toISOString());
  });

  it("is not ready while the key waits to be handed over, and ready after", async () => {
    const { deviceId } = await creditedDevice();
    expect((await balance(deviceId)).keyReady).toBe(false);
    await takeKey(deviceId);
    expect((await balance(deviceId)).keyReady).toBe(true);
  });

  it("answers zeros for a device that has no key", async () => {
    const { deviceId } = await newDevice();
    await seedStock();
    expect(await balance(deviceId)).toEqual({ credits: 0, usedCredits: 0, keyReady: false, updatedAt: new Date(NOW).toISOString() });
  });

  it("answers the epoch before any snapshot exists", async () => {
    const { deviceId } = await newDevice();
    expect((await balance(deviceId)).updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("falls back to the limit for the credits bought, with no usage, when the key is not in the snapshot yet", async () => {
    const { deviceId } = await creditedDevice();
    await takeKey(deviceId);
    await runInDurableObject(stub(), (_ledger, state) => state.storage.sql.exec("DELETE FROM key_usage"));
    const result = await balance(deviceId);
    expect(result).toMatchObject({ credits: balanceCredits(LIMIT_NANO, 0n, cfg), usedCredits: 0, keyReady: true });
  });

  it("never reports a negative balance when usage passes the limit", async () => {
    const { deviceId, keyId } = await creditedDevice();
    await runInDurableObject(stub(), (_ledger, state) =>
      state.storage.sql.exec("UPDATE key_usage SET usage_nano = ? WHERE key_id = ?", Number(LIMIT_NANO + USD), keyId),
    );
    expect((await balance(deviceId)).credits).toBe(0);
  });

  it("does not show another device's key usage", async () => {
    const owner = await creditedDevice();
    const other = await newDevice();
    near.keys.set(owner.keyId, { ...near.keys.get(owner.keyId)!, usageNano: USD });
    await runInDurableObject(stub(), (ledger: Ledger) => ledger.refreshSnapshot(NOW + MINUTE_MS));
    expect(await balance(other.deviceId, false, NOW + MINUTE_MS)).toMatchObject({ credits: 0, usedCredits: 0, keyReady: false });
  });
});

describe("balanceFor with fresh", () => {
  const callsToList = () => near.count("list");

  it("reads the key usage from NEAR AI once, and a second call within 30 seconds makes no request", async () => {
    const { deviceId, keyId } = await creditedDevice();
    near.keys.set(keyId, { ...near.keys.get(keyId)!, usageNano: 1n * USD });
    near.calls = [];

    const first = await balance(deviceId, true, NOW + 31 * SECOND_MS);
    expect(callsToList()).toBe(1);
    expect(first.usedCredits).toBe(creditsFromNano(1n * USD, cfg));
    expect(first.credits).toBe(balanceCredits(LIMIT_NANO, 1n * USD, cfg));

    near.keys.set(keyId, { ...near.keys.get(keyId)!, usageNano: 2n * USD });
    near.calls = [];
    const second = await balance(deviceId, true, NOW + 50 * SECOND_MS);
    expect(near.calls).toEqual([]);
    expect(second).toEqual(first);

    const third = await balance(deviceId, true, NOW + 62 * SECOND_MS);
    expect(callsToList()).toBe(1);
    expect(third.usedCredits).toBe(creditsFromNano(2n * USD, cfg));
  });

  it("does not turn many devices' refreshes into a stream of upstream reads", async () => {
    const first = await creditedDevice();
    const others = [await newDevice(), await newDevice()];
    await runInDurableObject(stub(), (_ledger, state) => {
      // Key rows for the others would only matter for the numbers; the point is the request count.
      state.storage.sql.exec("UPDATE devices SET nearai_key_id = 'key-x' WHERE id = ?", others[0]!.deviceId);
      state.storage.sql.exec("UPDATE devices SET nearai_key_id = 'key-y' WHERE id = ?", others[1]!.deviceId);
    });
    near.calls = [];

    await balance(first.deviceId, true, NOW + 31 * SECOND_MS);
    await balance(others[0]!.deviceId, true, NOW + 32 * SECOND_MS);
    await balance(others[1]!.deviceId, true, NOW + 33 * SECOND_MS);
    expect(callsToList()).toBe(1);
  });

  it("makes no request for a device without a key", async () => {
    const { deviceId } = await newDevice();
    await seedStock(NOW - 5 * MINUTE_MS);
    near.calls = [];
    expect(await balance(deviceId, true, NOW)).toMatchObject({ credits: 0, keyReady: false });
    expect(near.calls).toEqual([]);
  });

  it("does not use up a device's Refresh while the snapshot is young enough to need none", async () => {
    const { deviceId } = await creditedDevice();
    near.calls = [];
    await balance(deviceId, true, NOW + 10 * SECOND_MS);
    expect(callsToList()).toBe(0);
    await balance(deviceId, true, NOW + 35 * SECOND_MS);
    expect(callsToList()).toBe(1);
  });

  it("refreshes for the whole server at most once per 30 seconds, even when that refresh failed", async () => {
    const a = await creditedDevice();
    const b = await newDevice();
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec("UPDATE devices SET nearai_key_id = 'key-b' WHERE id = ?", b.deviceId);
    });
    near.status.list = 503;
    near.calls = [];
    await balance(a.deviceId, true, NOW + 31 * SECOND_MS);
    expect(callsToList()).toBe(1);
    near.status.list = undefined;
    await balance(b.deviceId, true, NOW + 45 * SECOND_MS);
    expect(callsToList()).toBe(1);
    await balance(b.deviceId, true, NOW + 62 * SECOND_MS);
    expect(callsToList()).toBe(2);
  });

  it("returns the cached row, not an error, when NEAR AI fails", async () => {
    const { deviceId, keyId } = await creditedDevice();
    near.keys.set(keyId, { ...near.keys.get(keyId)!, usageNano: 1n * USD });
    near.status.list = 503;
    const result = await balance(deviceId, true, NOW + 31 * SECOND_MS);
    expect(result).toMatchObject({ usedCredits: 0, credits: balanceCredits(LIMIT_NANO, 0n, cfg) });
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("device room counts the balance, not lifetime purchases", () => {
  async function deviceWith(bought: number, usageNano: bigint) {
    const device = await newDevice();
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec("UPDATE devices SET credits_bought = ?, nearai_key_id = 'key-room' WHERE id = ?", bought, device.deviceId);
      state.storage.sql.exec("INSERT INTO key_usage (key_id, limit_nano, usage_nano) VALUES ('key-room', ?, ?)", Number(spendLimitNano(bought, cfg)), Number(usageNano));
    });
    return device;
  }

  it("lets a device that bought and spent 5,000 credits buy again", async () => {
    await seedStock();
    const { deviceId } = await deviceWith(5000, spendLimitNano(5000, cfg));
    const view = await stub().stockFor(deviceId, NOW);
    // Rounding the limit down means the 5,000 credits bought read as 4,999 spent.
    expect(view.yourRoomCredits).toBe(4999);
    expect(view.packages.find((p) => p.usd === 25)?.available).toBe(true);
    expect(await stub().reserve(deviceId, 2500, 25, NOW)).toEqual({ topupId: expect.any(String) });
  });

  it("counts only the unspent part of what was bought", async () => {
    await seedStock();
    const { deviceId } = await deviceWith(3000, 10n * USD); // 10 USD of cost is 1,200 credits.
    expect((await stub().stockFor(deviceId, NOW)).yourRoomCredits).toBe(5000 - (3000 - 1200));
  });

  it("never lets usage beyond the credits bought raise the room above the cap", async () => {
    await seedStock();
    const { deviceId } = await deviceWith(500, 100n * USD);
    expect((await stub().stockFor(deviceId, NOW)).yourRoomCredits).toBe(5000);
  });

  it("still adds the device's reservations and waiting top-ups", async () => {
    await seedStock();
    const { deviceId } = await deviceWith(3000, 10n * USD);
    await stub().reserve(deviceId, 500, 5, NOW);
    expect((await stub().stockFor(deviceId, NOW)).yourRoomCredits).toBe(5000 - (3000 - 1200) - 500);
  });
});

describe("models", () => {
  const model = (id: string, verifiable = true) => ({ id, verifiable, inputPerToken: 1.5e-7, outputPerToken: 3e-7 });
  const [first, second] = cfg.models;

  it("lists the allowlisted models that NEAR AI marks verifiable, with prices per million tokens", async () => {
    near.modelList = [model(first!), model(second!, false), model("not/allowlisted")];
    const result = await stub().models(NOW);
    if ("error" in result) throw new Error("expected models");
    expect(result.models.map((m) => m.id)).toEqual([first]);
    expect(result.models[0]!.inputPerM).toBeCloseTo(0.15, 10);
    expect(result.models[0]!.outputPerM).toBeCloseTo(0.3, 10);
  });

  it("serves a second call within 10 minutes from the cache, and asks again after", async () => {
    near.modelList = [model(first!)];
    await stub().models(NOW);
    near.calls = [];
    await stub().models(NOW + 9 * MINUTE_MS);
    expect(near.calls).toEqual([]);
    await stub().models(NOW + 11 * MINUTE_MS);
    expect(near.count("models")).toBe(1);
  });

  it("makes one upstream request for calls that arrive together", async () => {
    near.modelList = [model(first!)];
    await Promise.all([stub().models(NOW), stub().models(NOW), stub().models(NOW)]);
    expect(near.count("models")).toBe(1);
  });

  it("serves the last list, even an old one, when NEAR AI fails, and says upstream when it has none", async () => {
    near.status.models = 503;
    expect(await stub().models(NOW)).toEqual({ error: "upstream" });

    near.status.models = undefined;
    near.modelList = [model(first!)];
    await stub().models(NOW);
    near.status.models = 503;
    const stale = await stub().models(NOW + 60 * MINUTE_MS);
    if ("error" in stale) throw new Error("expected the cached list");
    expect(stale.models.map((m) => m.id)).toEqual([first]);
  });
});

describe("models kept in storage", () => {
  const model = (id: string) => ({ id, verifiable: true, inputPerToken: 1.5e-7, outputPerToken: 3e-7 });
  const [first, second] = cfg.models;

  it("serves the last good list after the object lost its memory, when NEAR AI fails", async () => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    await runInDurableObject(stub(), (ledger: Ledger) => forgetModelsInMemory(ledger));
    near.status.models = 503;
    const served = await stub().models(NOW + 60 * MINUTE_MS);
    if ("error" in served) throw new Error("expected the stored list");
    expect(served.models.map((m) => m.id)).toEqual([first, second]);
  });

  it("serves a stored list younger than 10 minutes without asking NEAR AI", async () => {
    near.modelList = [model(first!)];
    await stub().models(NOW);
    await runInDurableObject(stub(), (ledger: Ledger) => forgetModelsInMemory(ledger));
    near.calls = [];
    await stub().models(NOW + 5 * MINUTE_MS);
    expect(near.count("models")).toBe(0);
  });

  it("keeps the last good list when an answer does not mention the allowlisted models at all", async () => {
    near.modelList = [model(first!)];
    await stub().models(NOW);
    near.modelList = [model("not/allowlisted")];
    const served = await stub().models(NOW + 11 * MINUTE_MS);
    if ("error" in served) throw new Error("expected the last good list");
    expect(served.models.map((m) => m.id)).toEqual([first]);
    // Nor is that answer stored: after an eviction the good list is still there.
    await runInDurableObject(stub(), (ledger: Ledger) => forgetModelsInMemory(ledger));
    near.status.models = 503;
    const after = await stub().models(NOW + 12 * MINUTE_MS);
    if ("error" in after) throw new Error("expected the stored list");
    expect(after.models.map((m) => m.id)).toEqual([first]);
  });

  it("offers nothing when NEAR AI lists the allowlisted models as not verifiable, and stores that", async () => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    near.modelList = [{ ...model(first!), verifiable: false }, { ...model(second!), verifiable: false }];
    expect(await stub().models(NOW + 11 * MINUTE_MS)).toEqual({ models: [] });
    // The empty list replaced the stored one: a later failure serves nothing, not the old models.
    await runInDurableObject(stub(), (ledger: Ledger) => forgetModelsInMemory(ledger));
    near.status.models = 503;
    expect(await stub().models(NOW + 30 * MINUTE_MS)).toEqual({ models: [] });
  });

  it("drops a model that turned non-verifiable and keeps the others", async () => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    near.modelList = [model(first!), { ...model(second!), verifiable: false }];
    const served = await stub().models(NOW + 11 * MINUTE_MS);
    if ("error" in served) throw new Error("expected models");
    expect(served.models.map((m) => m.id)).toEqual([first]);
    near.status.models = 503;
    const later = await stub().models(NOW + 30 * MINUTE_MS);
    if ("error" in later) throw new Error("expected the stored list");
    expect(later.models.map((m) => m.id)).toEqual([first]);
  });

  it("serves the last good list for an answer of the wrong shape", async () => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    near.rawModels = { models: "not a list" };
    const served = await stub().models(NOW + 11 * MINUTE_MS);
    if ("error" in served) throw new Error("expected the last good list");
    expect(served.models.map((m) => m.id)).toEqual([first, second]);
  });

  it.each([
    ["errors", () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })],
    ["has the wrong shape", () => new Response(JSON.stringify({ models: "not a list" }), { status: 200 })],
  ])("drops a model page 1 marks not verifiable when page 2 %s", async (_name, secondPage) => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    const priced = (id: string, verifiable: boolean) => ({
      modelId: id,
      inputCostPerToken: { amount: 1, scale: 9 },
      outputCostPerToken: { amount: 1, scale: 9 },
      metadata: { verifiable },
    });
    near.modelPages = (offset) =>
      offset === null ? new Response(JSON.stringify({ models: [priced(first!, false)], total: 2 }), { status: 200 }) : secondPage();
    const served = await stub().models(NOW + 11 * MINUTE_MS);
    if ("error" in served) throw new Error("expected the last good list");
    expect(served.models.map((m) => m.id)).toEqual([second]);
    near.modelPages = undefined;
    near.status.models = 503;
    await runInDurableObject(stub(), (ledger: Ledger) => forgetModelsInMemory(ledger));
    const stored = await stub().models(NOW + 30 * MINUTE_MS);
    if ("error" in stored) throw new Error("expected the stored list");
    expect(stored.models.map((m) => m.id)).toEqual([second]);
  });

  it("on an answer it cannot use, still drops from the last list a model that answer marks not verifiable", async () => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    near.rawModels = {
      models: [
        { modelId: first, inputCostPerToken: "free", outputCostPerToken: { amount: 1, scale: 9 }, metadata: { verifiable: true } },
        { modelId: second, inputCostPerToken: { amount: 1, scale: 9 }, outputCostPerToken: { amount: 1, scale: 9 }, metadata: { verifiable: false } },
      ],
    };
    const served = await stub().models(NOW + 11 * MINUTE_MS);
    if ("error" in served) throw new Error("expected the last good list");
    expect(served.models.map((m) => m.id)).toEqual([first]);
    near.rawModels = undefined;
    near.status.models = 503;
    await runInDurableObject(stub(), (ledger: Ledger) => forgetModelsInMemory(ledger));
    const stored = await stub().models(NOW + 30 * MINUTE_MS);
    if ("error" in stored) throw new Error("expected the stored list");
    expect(stored.models.map((m) => m.id)).toEqual([first]);
  });

  it("answers upstream when the first list NEAR AI gives holds none of the allowlisted models", async () => {
    near.modelList = [model("not/allowlisted")];
    expect(await stub().models(NOW)).toEqual({ error: "upstream" });
  });

  it("leaves out a stored model the allowlist no longer has", async () => {
    near.modelList = [model(first!), model(second!)];
    await stub().models(NOW);
    await runInDurableObject(stub(), (ledger: Ledger) => {
      forgetModelsInMemory(ledger);
      const self = ledger as unknown as { env: Env; parsedConfig: unknown };
      self.env = { ...self.env, MODELS: first! };
      self.parsedConfig = undefined;
    });
    near.status.models = 503;
    const served = await stub().models(NOW + 60 * MINUTE_MS);
    if ("error" in served) throw new Error("expected the stored list");
    expect(served.models.map((m) => m.id)).toEqual([first]);
  });
});

describe("routes", () => {
  const get = (path: string, secret?: string) =>
    exports.default.fetch(new Request(`https://credits.test${path}`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {} }));

  it("answers 401 without a device", async () => {
    expect((await get("/v1/balance")).status).toBe(401);
    expect((await get("/v1/models")).status).toBe(401);
  });

  it("GET /v1/balance returns the four fields", async () => {
    const { secret } = await newDevice();
    const res = await get("/v1/balance", secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ credits: 0, usedCredits: 0, keyReady: false, updatedAt: "1970-01-01T00:00:00.000Z" });
  });

  it("GET /v1/balance?fresh=1 reads the key usage from NEAR AI", async () => {
    const { secret, keyId } = await creditedDevice();
    await takeKey((await stub().deviceBySecretHash(await sha256Hex(secret)))!.id);
    near.keys.set(keyId, { ...near.keys.get(keyId)!, usageNano: 1n * USD });
    await stub().setSnapshot(near.remainingNano, 0n, Date.now() - 2 * MINUTE_MS);

    const res = await get("/v1/balance?fresh=1", secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ usedCredits: creditsFromNano(1n * USD, cfg), keyReady: true });
  });

  it("GET /v1/models answers an empty list when no allowlisted model is verifiable", async () => {
    const { secret } = await newDevice();
    near.modelList = cfg.models.map((id) => ({ id, verifiable: false, inputPerToken: 1.5e-7, outputPerToken: 3e-7 }));
    const res = await get("/v1/models", secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [] });
  });

  it("GET /v1/models returns the models, or 502 upstream when there are none to serve", async () => {
    const { secret } = await newDevice();
    near.status.models = 503;
    const failed = await get("/v1/models", secret);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "upstream" });

    near.status.models = undefined;
    near.modelList = [{ id: cfg.models[0]!, verifiable: true, inputPerToken: 1.5e-7, outputPerToken: 3e-7 }];
    const res = await get("/v1/models", secret);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { id: string }[] };
    expect(body.models.map((m) => m.id)).toEqual([cfg.models[0]]);
  });
});
