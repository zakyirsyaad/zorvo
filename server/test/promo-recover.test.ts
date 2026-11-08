import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { creditsFromNano, spendLimitNano } from "../src/credits";
import { decrypt, randomSecret, sha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { FakeNearAi, FakePingPay } from "./fakes";

const ledgerEnv = env as unknown as Env;
const cfg = parseConfig(ledgerEnv);
const NOW = 1_800_000_000_000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const USD = 1_000_000_000n;
const KEY = btoa("k".repeat(32));
const ADMIN = "admin-token-for-tests-0123456789";
const CODE = "JUDGE-300-CREDITS";
const ALERT_URL = "https://alerts.test/hook";

const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

let ping: FakePingPay;
let near: FakeNearAi;
let alerts: { kind: string; detail: string }[];
let consoleError: ReturnType<typeof vi.spyOn>;

const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith(cfg.nearAiBase)) return near.fetcher(input, init);
  if (url === ALERT_URL) {
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
  ledgerEnv.ADMIN_TOKEN = ADMIN;
  await runInDurableObject(stub(), async (ledger: Ledger, state) => {
    const tables = [
      "devices", "topups", "reservations", "queue", "pending_keys", "operator", "snapshot",
      "key_usage", "ratelimits", "events", "promos", "promo_redemptions", "limits_version",
    ];
    for (const table of tables) state.storage.sql.exec(`DELETE FROM ${table}`);
    await state.storage.deleteAlarm();
    (ledger as unknown as { env: Env }).env = { ...ledgerEnv, KEY_ENCRYPTION_KEY: KEY, OPERATOR_REFRESH_TOKEN: "seed", ALERT_URL };
    ledger.fetcher = fetcher;
    ledger.requestTimeoutMs = 15 * SECOND_MS;
  });
  await seedStock(10_000);
});

afterEach(async () => {
  consoleError.mockRestore();
  await runInDurableObject(stub(), (_ledger, state) => state.storage.deleteAlarm());
});

async function newDevice(creditsBought = 0): Promise<{ deviceId: string; secret: string }> {
  const secret = randomSecret();
  const result = await stub().registerDevice(await sha256Hex(secret));
  if ("error" in result) throw new Error("could not register a test device");
  if (creditsBought > 0) {
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec("UPDATE devices SET credits_bought = ? WHERE id = ?", creditsBought, result.deviceId);
    });
  }
  return { deviceId: result.deviceId, secret };
}

async function seedStock(credits: number, takenAt = NOW): Promise<void> {
  near.remainingNano = cfg.stockBufferNano + (BigInt(credits) * USD) / 120n + 1_000_000n;
  await stub().setSnapshot(near.remainingNano, 0n, takenAt);
}

function tick(now: number): Promise<void> {
  return runInDurableObject(stub(), (ledger: Ledger) => ledger.runAlarm(now));
}

type CallInit = { secret?: string; ip?: string; admin?: string; method?: string; body?: unknown; rawBody?: string };

function call(path: string, init: CallInit = {}): Promise<Response> {
  const headers = new Headers();
  if (init.secret) headers.set("Authorization", `Bearer ${init.secret}`);
  if (init.admin !== undefined) headers.set("Authorization", `Bearer ${init.admin}`);
  if (init.ip) headers.set("CF-Connecting-IP", init.ip);
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return exports.default.fetch(new Request(`https://credits.test${path}`, { method: init.method ?? (body === undefined ? "GET" : "POST"), headers, body }));
}

function addPromo(code: string, credits: number, maxUses: number, admin: string = ADMIN): Promise<Response> {
  return call("/v1/admin/promos", { admin, body: { code, credits, maxUses } });
}

function redeem(secret: string, code: unknown): Promise<Response> {
  return call("/v1/promo", { secret, body: { code } });
}

function rows() {
  return runInDurableObject(stub(), (_ledger, state) => {
    const sql = state.storage.sql;
    return {
      promos: sql.exec<{ code_hash: string; credits: number; max_uses: number; uses: number }>("SELECT * FROM promos").toArray(),
      redemptions: sql.exec<{ code_hash: string; device_id: string }>("SELECT * FROM promo_redemptions").toArray(),
      topups: sql.exec<{ id: string; device_id: string; package_usd: number; credits: number; status: string }>("SELECT id, device_id, package_usd, credits, status FROM topups").toArray(),
      reservations: sql.exec<{ topup_id: string; expires_at: number }>("SELECT topup_id, expires_at FROM reservations").toArray(),
      queue: sql.exec<{ id: string; kind: string; ref: string; attempts: number; next_at: number }>("SELECT id, kind, ref, attempts, next_at FROM queue ORDER BY kind, ref").toArray(),
      devices: sql.exec<{ id: string; secret_hash: string; nearai_key_id: string | null; credits_bought: number }>("SELECT id, secret_hash, nearai_key_id, credits_bought FROM devices").toArray(),
      pendingKeys: sql.exec<{ device_id: string; key_ciphertext: string }>("SELECT device_id, key_ciphertext FROM pending_keys").toArray(),
      keyUsage: sql.exec<{ key_id: string; limit_nano: number | null }>("SELECT key_id, limit_nano FROM key_usage ORDER BY key_id").toArray(),
    };
  });
}

const loggedText = () => consoleError.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");

/** A device holding one 500-credit key that nobody has collected yet. */
async function keyedDevice(): Promise<{ deviceId: string; secret: string }> {
  const device = await newDevice();
  const created = await stub().createTopup(device.deviceId, 5, NOW);
  if ("error" in created) throw new Error("could not create a top-up");
  const sessionId = created.sessionUrl.split("/").pop()!;
  ping.pay(sessionId);
  await stub().onSessionEvent(sessionId, null, NOW);
  await tick(NOW);
  expect((await rows()).devices.find((d) => d.id === device.deviceId)?.nearai_key_id).toBe("key-1");
  return device;
}

async function recover(recoveryCode: unknown, newSecret: string, ip?: string): Promise<Response> {
  return call("/v1/recover", { ip, body: { recoveryCode, newSecretHash: await sha256Hex(newSecret) } });
}

describe("POST /v1/admin/promos", () => {
  it("stores the hash of the code and nothing else about it", async () => {
    const res = await addPromo(CODE, 300, 5);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { promos } = await rows();
    expect(promos).toEqual([{ code_hash: await sha256Hex(CODE), credits: 300, max_uses: 5, uses: 0 }]);
    expect(JSON.stringify(promos)).not.toContain(CODE);
  });

  it("answers 401 without a token, with a wrong one and with a token of another length", async () => {
    const body = { code: CODE, credits: 300, maxUses: 1 };
    expect((await call("/v1/admin/promos", { body })).status).toBe(401);
    expect((await addPromo(CODE, 300, 1, "wrong-token")).status).toBe(401);
    expect((await addPromo(CODE, 300, 1, ADMIN.slice(0, -1))).status).toBe(401);
    expect((await addPromo(CODE, 300, 1, `${ADMIN}x`)).status).toBe(401);
    // A device secret is not an admin token.
    const { secret } = await newDevice();
    expect((await addPromo(CODE, 300, 1, secret)).status).toBe(401);
    expect((await rows()).promos).toEqual([]);
  });

  it.each([["unset", undefined], ["empty", ""]])("answers 401 to everyone when ADMIN_TOKEN is %s", async (_name, value) => {
    ledgerEnv.ADMIN_TOKEN = value;
    for (const token of [ADMIN, "", "undefined", "x"]) {
      expect((await addPromo(CODE, 300, 1, token)).status).toBe(401);
    }
    expect((await call("/v1/admin/promos", { body: { code: CODE, credits: 300, maxUses: 1 } })).status).toBe(401);
    expect((await rows()).promos).toEqual([]);
  });

  it.each([
    ["a short code", { code: "abc", credits: 300, maxUses: 1 }],
    ["a long code", { code: "a".repeat(65), credits: 300, maxUses: 1 }],
    ["a code with a space", { code: "has space", credits: 300, maxUses: 1 }],
    ["a code with a control character", { code: "line\nbreak", credits: 300, maxUses: 1 }],
    ["a non-ASCII code", { code: "café-code", credits: 300, maxUses: 1 }],
    ["a numeric code", { code: 12345678, credits: 300, maxUses: 1 }],
    ["zero credits", { code: CODE, credits: 0, maxUses: 1 }],
    ["fractional credits", { code: CODE, credits: 1.5, maxUses: 1 }],
    ["credits above the device cap", { code: CODE, credits: 5001, maxUses: 1 }],
    ["string credits", { code: CODE, credits: "300", maxUses: 1 }],
    ["zero uses", { code: CODE, credits: 300, maxUses: 0 }],
    ["too many uses", { code: CODE, credits: 300, maxUses: 10_001 }],
    ["fractional uses", { code: CODE, credits: 300, maxUses: 2.5 }],
    ["no fields", {}],
  ])("answers 400 for %s", async (_name, body) => {
    const res = await call("/v1/admin/promos", { admin: ADMIN, body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect((await rows()).promos).toEqual([]);
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await call("/v1/admin/promos", { admin: ADMIN, rawBody: "{" })).status).toBe(400);
  });

  it("accepts the limits themselves", async () => {
    expect((await addPromo("abcd", cfg.deviceCapCredits, 10_000)).status).toBe(200);
    expect((await addPromo("~".repeat(64), 1, 1)).status).toBe(200);
  });

  it("replaces the credits and uses of an existing code but keeps how often it was used", async () => {
    await addPromo(CODE, 300, 5);
    const { secret } = await newDevice();
    expect((await redeem(secret, CODE)).status).toBe(201);
    expect((await addPromo(CODE, 100, 9)).status).toBe(200);
    expect((await rows()).promos).toEqual([{ code_hash: await sha256Hex(CODE), credits: 100, max_uses: 9, uses: 1 }]);
  });

  it("never logs the code or the token", async () => {
    await addPromo(CODE, 300, 1);
    await addPromo(CODE, 0, 1, "wrong-token-value");
    await call("/v1/admin/promos", { admin: ADMIN, rawBody: "{" });
    expect(loggedText()).not.toContain(CODE);
    expect(loggedText()).not.toContain(ADMIN);
    expect(loggedText()).not.toContain("wrong-token-value");
  });
});

describe("POST /v1/promo", () => {
  it("credits a 300-credit code once and refuses its second use", async () => {
    await addPromo(CODE, 300, 1);
    const first = await newDevice();
    const second = await newDevice();

    const res = await redeem(first.secret, CODE);
    expect(res.status).toBe(201);
    const { topupId, credits } = (await res.json()) as { topupId: string; credits: number };
    expect(credits).toBe(300);

    let state = await rows();
    expect(state.topups).toEqual([{ id: topupId, device_id: first.deviceId, package_usd: 0, credits: 300, status: "paid" }]);
    expect(state.reservations).toEqual([{ topup_id: topupId, expires_at: Number.MAX_SAFE_INTEGER }]);
    expect(state.queue).toEqual([expect.objectContaining({ kind: "credit", ref: topupId, attempts: 0 })]);
    expect(state.promos[0]).toMatchObject({ uses: 1 });
    expect(state.redemptions).toEqual([{ code_hash: await sha256Hex(CODE), device_id: first.deviceId }]);

    const refused = await redeem(second.secret, CODE);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "bad_request" });
    state = await rows();
    expect(state.promos[0]).toMatchObject({ uses: 1 });
    expect(state.topups).toHaveLength(1);

    await tick(NOW);
    state = await rows();
    expect(state.topups[0]).toMatchObject({ status: "credited" });
    expect(state.queue).toEqual([]);
    expect(state.reservations).toEqual([]);
    expect(near.calls.filter((call) => call.route === "create").map((call) => call.body)).toEqual([
      { name: `zorvo-${first.deviceId}`, spendLimit: { amount: Number(spendLimitNano(300, cfg)), currency: "USD" } },
    ]);
    const balance = await call("/v1/balance", { secret: first.secret });
    expect(await balance.json()).toMatchObject({ credits: 300, keyReady: false });
    const key = await call("/v1/key", { secret: first.secret });
    expect(await key.json()).toEqual({ key: "sk-secret-1" });
  });

  it("answers 400 for an unknown code, a malformed body and a missing code", async () => {
    await addPromo(CODE, 300, 5);
    const { secret } = await newDevice();
    for (const code of ["NOT-A-CODE", "", 12, null, undefined]) {
      const res = await redeem(secret, code);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    const other = await newDevice();
    expect((await redeem(other.secret, "x".repeat(200))).status).toBe(400);
    expect((await call("/v1/promo", { secret: other.secret, rawBody: "{" })).status).toBe(400);
    expect((await rows()).topups).toEqual([]);
  });

  it("answers 401 without a device", async () => {
    await addPromo(CODE, 300, 5);
    expect((await call("/v1/promo", { body: { code: CODE } })).status).toBe(401);
  });

  it("lets one device redeem a code once only, without using it up a second time", async () => {
    await addPromo(CODE, 300, 5);
    const { secret } = await newDevice();
    expect((await redeem(secret, CODE)).status).toBe(201);
    const again = await redeem(secret, CODE);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "bad_request" });
    const state = await rows();
    expect(state.promos[0]).toMatchObject({ uses: 1 });
    expect(state.topups).toHaveLength(1);
  });

  it("answers 409 device_cap for a device at the cap and does not use the code", async () => {
    await addPromo(CODE, 300, 1);
    const full = await newDevice(cfg.deviceCapCredits - 100);
    const res = await redeem(full.secret, CODE);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "device_cap" });
    const state = await rows();
    expect(state.promos[0]).toMatchObject({ uses: 0 });
    expect(state.topups).toEqual([]);
    expect(state.queue).toEqual([]);
    expect(state.redemptions).toEqual([]);

    // The unused use is still there for someone else.
    const other = await newDevice();
    expect((await redeem(other.secret, CODE)).status).toBe(201);
  });

  it("answers 409 stock when the stock does not cover it and does not use the code", async () => {
    await seedStock(100);
    await addPromo(CODE, 300, 1);
    const { secret } = await newDevice();
    const res = await redeem(secret, CODE);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stock" });
    const state = await rows();
    expect(state.promos[0]).toMatchObject({ uses: 0 });
    expect(state.topups).toEqual([]);
    expect(state.reservations).toEqual([]);
    expect(state.redemptions).toEqual([]);

    // The same device may try again once there is stock.
    await seedStock(10_000);
    expect((await redeem(secret, CODE)).status).toBe(201);
  });

  it("gives the last use to exactly one of two devices racing for it", async () => {
    await addPromo(CODE, 300, 1);
    const a = await newDevice();
    const b = await newDevice();
    const results = await Promise.all([redeem(a.secret, CODE), redeem(b.secret, CODE)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 400]);
    const state = await rows();
    expect(state.promos[0]).toMatchObject({ uses: 1 });
    expect(state.topups).toHaveLength(1);
    expect(state.queue.filter((item) => item.kind === "credit")).toHaveLength(1);
    await tick(NOW);
    expect(near.count("create")).toBe(1);
  });

  it("holds the promo's credits against the stock until they are credited", async () => {
    await seedStock(300);
    await addPromo(CODE, 300, 2);
    const a = await newDevice();
    const b = await newDevice();
    expect((await redeem(a.secret, CODE)).status).toBe(201);
    const second = await redeem(b.secret, CODE);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "stock" });
  });

  it("allows 5 attempts per device an hour and answers 429 to the 6th, valid code or not", async () => {
    await addPromo(CODE, 300, 5);
    const guesser = await newDevice();
    const other = await newDevice();
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await redeem(guesser.secret, `WRONG-${attempt}`)).status).toBe(400);
    const sixth = await redeem(guesser.secret, CODE);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: "rate_limited" });
    expect((await rows()).topups).toEqual([]);
    // Another device has its own count.
    expect((await redeem(other.secret, CODE)).status).toBe(201);
  });

  it("counts malformed attempts too", async () => {
    await addPromo(CODE, 300, 5);
    const { secret } = await newDevice();
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await call("/v1/promo", { secret, rawBody: "{" })).status).toBe(400);
    expect((await redeem(secret, CODE)).status).toBe(429);
  });

  it("never logs the code", async () => {
    await addPromo(CODE, 300, 1);
    const { secret } = await newDevice();
    await redeem(secret, "WRONG-CODE-VALUE");
    await redeem(secret, CODE);
    await tick(NOW);
    expect(loggedText()).not.toContain(CODE);
    expect(loggedText()).not.toContain("WRONG-CODE-VALUE");
  });
});

describe("POST /v1/recover", () => {
  it("stops the old secret at once on every device endpoint and lets the new one in", async () => {
    const { secret: oldSecret } = await keyedDevice();
    const newSecret = randomSecret();

    const res = await recover(oldSecret, newSecret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    for (const [path, method, body] of [
      ["/v1/balance", "GET"],
      ["/v1/key", "GET"],
      ["/v1/stock", "GET"],
      ["/v1/models", "GET"],
      ["/v1/topups", "POST", { packageUsd: 5 }],
      ["/v1/promo", "POST", { code: CODE }],
    ] as const) {
      const denied = await call(path, { secret: oldSecret, method, body });
      expect([path, denied.status]).toEqual([path, 401]);
      expect(await denied.json()).toEqual({ error: "unauthorized" });
    }
    expect((await call("/v1/balance", { secret: newSecret })).status).toBe(200);
    expect((await call("/v1/stock", { secret: newSecret })).status).toBe(200);
  });

  it("rotates the key: the new secret gets a new key, the old key is revoked, the old pending key is gone", async () => {
    const { deviceId, secret: oldSecret } = await keyedDevice();
    const newSecret = randomSecret();
    expect((await recover(oldSecret, newSecret)).status).toBe(200);
    expect((await rows()).queue).toEqual([expect.objectContaining({ kind: "rotate_key", ref: deviceId, attempts: 0 })]);

    await tick(NOW + MINUTE_MS);

    const creates = near.calls.filter((call) => call.route === "create");
    expect(creates).toHaveLength(2);
    expect(creates[1]!.body).toEqual({ name: `zorvo-${deviceId}`, spendLimit: { amount: Number(spendLimitNano(500, cfg)), currency: "USD" } });
    expect([...near.keys.keys()]).toEqual(["key-2"]);
    expect(near.calls.filter((call) => call.route === "revoke").map((call) => call.path)).toEqual([`/workspaces/${cfg.workspaceId}/api-keys/key-1`]);

    const state = await rows();
    expect(state.queue).toEqual([]);
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-2", credits_bought: 500 });
    expect(state.keyUsage).toEqual([{ key_id: "key-2", limit_nano: Number(spendLimitNano(500, cfg)) }]);
    expect(state.pendingKeys).toHaveLength(1);
    expect(await decrypt(KEY, state.pendingKeys[0]!.key_ciphertext)).toBe("sk-secret-2");

    expect((await call("/v1/key", { secret: oldSecret })).status).toBe(401);
    const handed = await call("/v1/key", { secret: newSecret });
    expect(handed.status).toBe(200);
    expect(await handed.json()).toEqual({ key: "sk-secret-2" });
    expect((await call("/v1/key", { secret: newSecret })).status).toBe(404);
    expect(loggedText()).not.toContain("sk-secret");
    expect(loggedText()).not.toContain(oldSecret);
  });

  it("keeps the stock honest: the old key's outstanding amount is replaced by the new key's", async () => {
    const { secret } = await keyedDevice();
    const outstanding = () => runInDurableObject(stub(), (_ledger, state) => state.storage.sql.exec<{ outstanding_usd: number }>("SELECT outstanding_usd FROM snapshot").one().outstanding_usd);
    const before = await outstanding();
    expect((await recover(secret, randomSecret())).status).toBe(200);
    await tick(NOW + MINUTE_MS);
    expect(await outstanding()).toBe(before);
  });

  it("carries only what is left: the new key does not give back what the old one spent", async () => {
    const { deviceId, secret } = await keyedDevice();
    near.keys.get("key-1")!.usageNano = (100n * USD) / 120n;

    expect((await recover(secret, randomSecret())).status).toBe(200);
    await tick(NOW + MINUTE_MS);

    expect(near.keys.get("key-2")?.limitNano).toBe(spendLimitNano(400, cfg));
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: "key-2", credits_bought: 400 });
  });

  it("rounds what is left down: a fraction of a credit spent costs the whole credit, and repeated recoveries never add any", async () => {
    const { deviceId, secret } = await keyedDevice();
    // 0.99 of a credit used.
    near.keys.get("key-1")!.usageNano = 8_250_000n;
    const second = randomSecret();
    expect((await recover(secret, second)).status).toBe(200);
    await tick(NOW + MINUTE_MS);
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: "key-2", credits_bought: 499 });
    expect(near.keys.get("key-2")?.limitNano).toBe(spendLimitNano(499, cfg));

    // The new key has used nothing: recovering again keeps 499, it does not drift up.
    expect((await recover(second, randomSecret())).status).toBe(200);
    await tick(NOW + 2 * MINUTE_MS);
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: "key-3", credits_bought: 499 });
    expect(near.keys.get("key-3")?.limitNano).toBe(spendLimitNano(499, cfg));
  });

  it("freezes the old key before it reads the usage it carries: patch, list, then the orphan check, create, revoke", async () => {
    const { secret } = await keyedDevice();
    expect((await recover(secret, randomSecret())).status).toBe(200);
    const seen = near.calls.length;

    await tick(NOW + MINUTE_MS);

    const routes = near.calls.slice(seen).map((call) => call.route).filter((route) => ["list", "patch", "create", "revoke"].includes(route));
    expect(routes).toEqual(["list", "patch", "list", "list", "create", "revoke"]);
    const patch = near.calls.slice(seen).find((call) => call.route === "patch")!;
    expect(patch.path).toBe(`/workspaces/${cfg.workspaceId}/api-keys/key-1/spend-limit`);
    expect(patch.body).toEqual({ spendLimit: { amount: 1, currency: "USD" } });
  });

  it("counts usage that grows between the first read and the freeze", async () => {
    const { deviceId, secret } = await keyedDevice();
    expect((await recover(secret, randomSecret())).status).toBe(200);
    const hold = near.hold("patch");

    await runInDurableObject(stub(), async (ledger: Ledger) => {
      const running = ledger.runAlarm(NOW + MINUTE_MS);
      await hold.started;
      near.keys.get("key-1")!.usageNano = (50n * USD) / 120n;
      hold.release();
      await running;
    });

    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: "key-2", credits_bought: 450 });
    expect(near.keys.get("key-2")?.limitNano).toBe(spendLimitNano(450, cfg));
  });

  it("records the frozen limit, so the key's outstanding amount drops at once", async () => {
    const { secret } = await keyedDevice();
    expect((await recover(secret, randomSecret())).status).toBe(200);
    near.status.create = 503;
    await tick(NOW + MINUTE_MS);
    const state = await runInDurableObject(stub(), (_ledger, s) => ({
      outstanding: s.storage.sql.exec<{ outstanding_usd: number }>("SELECT outstanding_usd FROM snapshot").one().outstanding_usd,
      keyUsage: s.storage.sql.exec<{ key_id: string; limit_nano: number }>("SELECT key_id, limit_nano FROM key_usage").toArray(),
    }));
    expect(state.keyUsage).toEqual([{ key_id: "key-1", limit_nano: 1 }]);
    expect(state.outstanding).toBe(1);
  });

  it("treats a key NEAR AI no longer knows as frozen and carries the usage it had on record", async () => {
    const { deviceId, secret } = await keyedDevice();
    await runInDurableObject(stub(), (_ledger, s) => {
      s.storage.sql.exec("UPDATE key_usage SET usage_nano = ? WHERE key_id = 'key-1'", Number((100n * USD) / 120n));
    });
    near.keys.delete("key-1");
    expect((await recover(secret, randomSecret())).status).toBe(200);
    await tick(NOW + MINUTE_MS);
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: "key-2", credits_bought: 400 });
  });

  it("creates no key when nothing is left: the old key is revoked and the next credit makes a new one", async () => {
    const { deviceId, secret } = await keyedDevice();
    near.keys.get("key-1")!.usageNano = near.keys.get("key-1")!.limitNano;
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);

    await tick(NOW + MINUTE_MS);

    expect(near.count("create")).toBe(1);
    expect(near.keys.size).toBe(0);
    expect(near.calls.filter((call) => call.route === "revoke").map((call) => call.path)).toEqual([`/workspaces/${cfg.workspaceId}/api-keys/key-1`]);
    const state = await rows();
    expect(state.devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: null, credits_bought: 0 });
    expect(state.pendingKeys).toEqual([]);
    expect(state.keyUsage).toEqual([]);
    expect(state.queue).toEqual([]);
    expect(await (await call("/v1/balance", { secret: next })).json()).toMatchObject({ credits: 0, usedCredits: 0, keyReady: false });
    expect((await call("/v1/key", { secret: next })).status).toBe(404);

    await addPromo(CODE, 300, 1);
    expect((await redeem(next, CODE)).status).toBe(201);
    await tick(NOW + 2 * MINUTE_MS);
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ nearai_key_id: "key-2", credits_bought: 300 });
    expect(near.keys.get("key-2")?.limitNano).toBe(spendLimitNano(300, cfg));
    expect(await (await call("/v1/key", { secret: next })).json()).toEqual({ key: "sk-secret-2" });
  });

  it("holds back the pending key of the old secret at once", async () => {
    const { secret } = await keyedDevice();
    expect((await rows()).pendingKeys).toHaveLength(1);
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);
    expect((await rows()).pendingKeys).toEqual([]);
    expect((await call("/v1/key", { secret: next })).status).toBe(404);
  });

  it("replaces a pending key nobody collected, and recovering with the device's own current code works", async () => {
    const { deviceId, secret } = await keyedDevice();
    expect((await rows()).pendingKeys).toHaveLength(1);
    // Recovering with the device's own secret is a recovery like any other.
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);
    await tick(NOW + MINUTE_MS);
    const state = await rows();
    expect(state.pendingKeys).toHaveLength(1);
    expect(state.pendingKeys[0]!.device_id).toBe(deviceId);
    expect(await decrypt(KEY, state.pendingKeys[0]!.key_ciphertext)).toBe("sk-secret-2");
  });

  it("revokes the old key even though the new Mac has the key already, and retries a failed revoke without creating another key", async () => {
    const { secret } = await keyedDevice();
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);
    near.status.revoke = 503;

    await tick(NOW + MINUTE_MS);
    expect(near.count("create")).toBe(2);
    expect(near.count("revoke")).toBe(1);
    expect(near.keys.has("key-1")).toBe(true);
    let state = await rows();
    // The rotation stands: the device is on the new key and the new Mac can fetch it.
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-2" });
    expect(state.queue).toEqual([expect.objectContaining({ kind: "revoke_key", ref: "key-1", attempts: 1 })]);
    expect(await (await call("/v1/key", { secret: next })).json()).toEqual({ key: "sk-secret-2" });

    delete near.status.revoke;
    await tick(state.queue[0]!.next_at - 1);
    expect(near.count("revoke")).toBe(1);
    await tick(state.queue[0]!.next_at);
    expect(near.count("revoke")).toBe(2);
    expect(near.count("create")).toBe(2);
    expect(near.keys.has("key-1")).toBe(false);
    state = await rows();
    expect(state.queue).toEqual([]);
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-2" });
  });

  it("alerts attempts_exhausted when the old key cannot be revoked 10 times, and keeps trying", async () => {
    const { secret } = await keyedDevice();
    expect((await recover(secret, randomSecret())).status).toBe(200);
    near.status.revoke = 503;

    await tick(NOW + MINUTE_MS);
    for (let attempt = 1; attempt < 10; attempt += 1) {
      expect(alerts.filter((alert) => alert.kind === "attempts_exhausted")).toEqual([]);
      await tick((await rows()).queue[0]!.next_at);
    }
    const exhausted = alerts.filter((alert) => alert.kind === "attempts_exhausted");
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.detail).toContain("key-1");
    const item = (await rows()).queue[0]!;
    expect(item).toMatchObject({ kind: "revoke_key", attempts: 10 });
    await tick(item.next_at);
    expect((await rows()).queue[0]).toMatchObject({ attempts: 11 });
    expect(alerts.filter((alert) => alert.kind === "attempts_exhausted")).toHaveLength(1);
  });

  it("keeps the old key when the new one cannot be created, and tries again with backoff", async () => {
    const { secret } = await keyedDevice();
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);
    near.status.create = 503;

    await tick(NOW + MINUTE_MS);
    expect(near.count("create")).toBe(2);
    expect(near.count("revoke")).toBe(0);
    let state = await rows();
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-1" });
    expect(state.queue).toEqual([expect.objectContaining({ kind: "rotate_key", attempts: 1, next_at: NOW + MINUTE_MS + 30 * SECOND_MS })]);
    // The old secret is dead already; the new one just has no new key yet.
    expect((await call("/v1/key", { secret })).status).toBe(401);
    expect((await call("/v1/balance", { secret: next })).status).toBe(200);

    delete near.status.create;
    await tick(NOW + MINUTE_MS + 30 * SECOND_MS);
    state = await rows();
    expect(state.devices[0]).toMatchObject({ nearai_key_id: "key-2" });
    expect(state.queue).toEqual([]);
    expect([...near.keys.keys()]).toEqual(["key-2"]);
  });

  it("enqueues nothing for a device without a key, and its new secret works", async () => {
    const { deviceId, secret } = await newDevice();
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);
    expect((await rows()).queue).toEqual([]);
    expect((await rows()).devices.find((d) => d.id === deviceId)?.secret_hash).toBe(await sha256Hex(next));
    expect((await call("/v1/balance", { secret })).status).toBe(401);
    expect((await call("/v1/balance", { secret: next })).status).toBe(200);
    await tick(NOW + MINUTE_MS);
    expect(near.calls.filter((call) => call.route === "create" || call.route === "revoke")).toEqual([]);
  });

  it("queues one rotation for two recoveries before the alarm runs, and ends on the last secret", async () => {
    const { secret } = await keyedDevice();
    const second = randomSecret();
    const third = randomSecret();
    expect((await recover(secret, second)).status).toBe(200);
    expect((await recover(second, third)).status).toBe(200);
    expect((await rows()).queue.filter((item) => item.kind === "rotate_key")).toHaveLength(1);

    await tick(NOW + MINUTE_MS);
    expect(near.count("create")).toBe(2);
    expect((await call("/v1/key", { secret: second })).status).toBe(401);
    expect(await (await call("/v1/key", { secret: third })).json()).toEqual({ key: "sk-secret-2" });
  });

  it("answers 400, the same for an unknown code and a revoked device, and changes nothing", async () => {
    const { deviceId, secret } = await keyedDevice();
    const unknown = await recover("not-a-device-secret", randomSecret());
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec("UPDATE devices SET revoked_at = ? WHERE id = ?", NOW, deviceId);
    });
    const revoked = await recover(secret, randomSecret());
    expect([unknown.status, revoked.status]).toEqual([400, 400]);
    expect(await unknown.json()).toEqual({ error: "bad_request" });
    expect(await revoked.json()).toEqual({ error: "bad_request" });
    const state = await rows();
    expect(state.devices[0]!.secret_hash).toBe(await sha256Hex(secret));
    expect(state.queue).toEqual([]);
  });

  it("answers 400 for a new secret hash that another device or the same one already uses", async () => {
    const owner = await newDevice();
    const other = await newDevice();
    const taken = await call("/v1/recover", { body: { recoveryCode: other.secret, newSecretHash: await sha256Hex(owner.secret) } });
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({ error: "bad_request" });
    const same = await call("/v1/recover", { body: { recoveryCode: other.secret, newSecretHash: await sha256Hex(other.secret) } });
    expect(same.status).toBe(400);
    expect((await call("/v1/balance", { secret: other.secret })).status).toBe(200);
    expect((await call("/v1/balance", { secret: owner.secret })).status).toBe(200);
  });

  it.each([
    ["a short hash", { recoveryCode: "code", newSecretHash: "abc" }],
    ["an uppercase hash", { recoveryCode: "code", newSecretHash: "A".repeat(64) }],
    ["a missing hash", { recoveryCode: "code" }],
    ["an empty code", { recoveryCode: "", newSecretHash: "a".repeat(64) }],
    ["a numeric code", { recoveryCode: 5, newSecretHash: "a".repeat(64) }],
    ["a code over 100 characters", { recoveryCode: "x".repeat(101), newSecretHash: "a".repeat(64) }],
    ["no fields", {}],
  ])("answers 400 for %s", async (_name, body) => {
    const res = await call("/v1/recover", { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await call("/v1/recover", { rawBody: "{" })).status).toBe(400);
  });

  it("allows 5 attempts per IP an hour and answers 429 to the 6th, right code or not", async () => {
    const { secret } = await newDevice();
    const next = randomSecret();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await recover(`wrong-${attempt}`, randomSecret(), "203.0.113.7")).status).toBe(400);
    }
    const sixth = await recover(secret, next, "203.0.113.7");
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: "rate_limited" });
    expect((await call("/v1/balance", { secret })).status).toBe(200);
    // Another address has its own count.
    expect((await recover(secret, next, "203.0.113.8")).status).toBe(200);
  });

  it("shares one bucket between requests without an address", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await recover(`wrong-${attempt}`, randomSecret());
    expect((await recover("wrong-again", randomSecret())).status).toBe(429);
  });

  it("never logs the recovery code or the new secret hash", async () => {
    const { secret } = await keyedDevice();
    const next = randomSecret();
    await recover("wrong-recovery-code", next);
    await recover(secret, next);
    await tick(NOW + MINUTE_MS);
    for (const text of [secret, "wrong-recovery-code", await sha256Hex(next), "sk-secret"]) expect(loggedText()).not.toContain(text);
  });
});

describe("rotate_key next to credit", () => {
  it("defers a device's credit while its rotation is queued, then lands it on the new key", async () => {
    const { deviceId, secret } = await keyedDevice();
    await addPromo(CODE, 500, 1);
    expect((await redeem(secret, CODE)).status).toBe(201);
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);
    near.status.create = 503;
    const queuedCredit = (await rows()).queue.find((item) => item.kind === "credit")!;

    await tick(NOW + MINUTE_MS);

    // The rotation failed after freezing the old key; the credit did not lift the freeze.
    expect(near.calls.filter((call) => call.route === "patch")).toHaveLength(1);
    expect(near.keys.get("key-1")?.limitNano).toBe(1n);
    let state = await rows();
    expect(state.queue.find((item) => item.kind === "credit")).toEqual(queuedCredit);
    expect(state.queue.find((item) => item.kind === "rotate_key")).toMatchObject({ attempts: 1 });
    expect(state.devices.find((d) => d.id === deviceId)).toMatchObject({ credits_bought: 500, nearai_key_id: "key-1" });

    delete near.status.create;
    await tick(NOW + MINUTE_MS + 30 * SECOND_MS);
    state = await rows();
    expect(state.devices.find((d) => d.id === deviceId)).toMatchObject({ credits_bought: 500, nearai_key_id: "key-2" });
    expect(state.queue.map((item) => item.kind)).toEqual(["credit"]);
    expect(state.queue[0]).toMatchObject({ attempts: 0 });

    await tick(NOW + MINUTE_MS + 31 * SECOND_MS);
    state = await rows();
    expect(state.queue).toEqual([]);
    expect(state.topups.map((t) => t.status)).toContain("credited");
    expect(state.devices.find((d) => d.id === deviceId)).toMatchObject({ credits_bought: 1000, nearai_key_id: "key-2" });
    expect([...near.keys.keys()]).toEqual(["key-2"]);
    expect(near.keys.get("key-2")?.limitNano).toBe(spendLimitNano(1000, cfg));
    // The original key, the refused attempt, and the new key.
    expect(near.count("create")).toBe(3);
    expect(await (await call("/v1/key", { secret: next })).json()).toEqual({ key: "sk-secret-2" });
  });
});

describe("a credit absorbed by a zero-remainder rotation", () => {
  it("never sends a 0 spend limit: the credit ends credited with nothing queued and no key made", async () => {
    const { deviceId, secret } = await keyedDevice();
    await addPromo(CODE, 500, 1);
    expect((await redeem(secret, CODE)).status).toBe(201);
    const promoTopup = (await rows()).topups.find((t) => t.package_usd === 0)!;
    // The credit is counted (credits_bought 1000) but its PATCH fails, so it is still queued.
    near.status.patch = 503;
    await tick(NOW + MINUTE_MS);
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ credits_bought: 1000, nearai_key_id: "key-1" });
    delete near.status.patch;
    // The old key overshot its 500-credit limit by the promo's 500: nothing is left to carry.
    near.keys.get("key-1")!.usageNano = spendLimitNano(1000, cfg);
    const next = randomSecret();
    expect((await recover(secret, next)).status).toBe(200);

    await tick(NOW + 2 * MINUTE_MS);
    expect((await rows()).devices.find((d) => d.id === deviceId)).toMatchObject({ credits_bought: 0, nearai_key_id: null });
    await tick(NOW + 3 * MINUTE_MS);

    const limits = near.calls
      .filter((c) => c.route === "create" || c.route === "patch")
      .map((c) => (c.body as { spendLimit: { amount: number } }).spendLimit.amount);
    expect(limits).not.toContain(0);
    expect(near.count("create")).toBe(1);
    const state = await rows();
    expect(state.topups.find((t) => t.id === promoTopup.id)?.status).toBe("credited");
    expect(state.queue).toEqual([]);
    expect(state.reservations.find((r) => r.topup_id === promoTopup.id)).toBeUndefined();
    expect(state.devices.find((d) => d.id === deviceId)).toMatchObject({ credits_bought: 0, nearai_key_id: null });
    expect(state.pendingKeys).toEqual([]);
    expect(loggedText()).toContain(promoTopup.id);
    expect((await call("/v1/key", { secret: next })).status).toBe(404);
  });
});

describe("queue items without a device to serve", () => {
  it("drops a rotate_key item for a device that has no key and calls nothing", async () => {
    const { deviceId } = await newDevice();
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec("INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES ('q-1', 'rotate_key', ?, 0, ?, ?)", deviceId, NOW, NOW);
      state.storage.sql.exec("INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES ('q-2', 'rotate_key', 'no-such-device', 0, ?, ?)", NOW, NOW);
    });
    await tick(NOW + HOUR_MS / 60);
    expect((await rows()).queue).toEqual([]);
    expect(near.calls.filter((call) => call.route === "create" || call.route === "revoke")).toEqual([]);
  });

  it("runs at most 20 credit and rotate items a tick between them", async () => {
    near.status.create = 503;
    await runInDurableObject(stub(), (_ledger, state) => {
      for (let i = 0; i < 25; i += 1) {
        const sql = state.storage.sql;
        sql.exec("INSERT INTO devices (id, secret_hash, nearai_key_id, credits_bought, created_at) VALUES (?, ?, ?, 500, ?)", `d-${i}`, `hash-${i}`, `old-${i}`, NOW);
        near.keys.set(`old-${i}`, { name: "x", limitNano: 1n, usageNano: 0n, secret: "s" });
        sql.exec("INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES (?, 'rotate_key', ?, 0, ?, ?)", `q-${i}`, `d-${i}`, NOW, NOW);
      }
    });
    await tick(NOW);
    expect(near.count("create")).toBe(20);
  });
});
