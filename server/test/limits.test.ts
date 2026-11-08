import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/config";
import { randomSecret, sha256Hex } from "../src/crypto";
import { error, json } from "../src/http";

/** The JSON helpers, the 404 fallback and the per-address limits of the routes. */

const ledgerEnv = env as unknown as Env;
const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));
const ADMIN = "admin-token-for-limit-tests";

function call(path: string, init: RequestInit & { ip?: string; secret?: string } = {}): Promise<Response> {
  const { ip, secret, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (ip) headers.set("CF-Connecting-IP", ip);
  if (secret) headers.set("Authorization", `Bearer ${secret}`);
  return exports.default.fetch(new Request(`https://credits.test${path}`, { ...rest, headers }));
}

async function registered(): Promise<string> {
  const secret = randomSecret();
  const result = await stub().registerDevice(await sha256Hex(secret));
  if ("error" in result) throw new Error("could not register a test device");
  return secret;
}

beforeEach(async () => {
  ledgerEnv.ADMIN_TOKEN = ADMIN;
  await runInDurableObject(stub(), (_ledger, state) => {
    state.storage.sql.exec("DELETE FROM ratelimits");
  });
});

describe("json and error", () => {
  it("answers JSON with the status and a UTF-8 content type", async () => {
    const res = json({ ok: true, name: "zorvo" }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ ok: true, name: "zorvo" });
    expect(json([]).status).toBe(200);
  });

  it("wraps an error code in { error }", async () => {
    const res = error("stock", 409);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stock" });
  });
});

describe("routing", () => {
  it.each([
    ["an unknown path", "GET", "/v1/nothing"],
    ["the root", "GET", "/"],
    ["a known path with the wrong method", "GET", "/v1/devices"],
    ["POST on a GET route", "POST", "/v1/balance"],
    ["a malformed top-up id", "GET", "/v1/topups/not-an-id"],
    ["GET on a top-up's cancel", "GET", `/v1/topups/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/cancel`],
  ])("answers %s with 404 not_found", async (_name, method, path) => {
    const res = await call(path, { method });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("failed device authentication", () => {
  it("answers 429 to the 61st wrong secret from one address in an hour, and never to a valid device", async () => {
    const ip = "198.51.100.40";
    for (let i = 0; i < 60; i += 1) {
      const res = await call("/v1/balance", { ip, secret: `wrong-${i}` });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    const limited = await call("/v1/balance", { ip, secret: "wrong-60" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });

    // A device that authenticates is not slowed down by its neighbours' failures.
    const secret = await registered();
    expect((await call("/v1/balance", { ip, secret })).status).toBe(200);
    // Another address still gets its 401.
    expect((await call("/v1/balance", { ip: "198.51.100.41", secret: "wrong" })).status).toBe(401);
  });
});

describe("admin route", () => {
  it("answers 429 to the 21st admin attempt from one address in an hour", async () => {
    const ip = "198.51.100.50";
    const body = JSON.stringify({ code: "LIMIT-CODE-1", credits: 100, maxUses: 1 });
    for (let i = 0; i < 20; i += 1) {
      const res = await call("/v1/admin/promos", { method: "POST", ip, secret: `${ADMIN}-wrong`, body });
      expect(res.status).toBe(401);
    }
    const limited = await call("/v1/admin/promos", { method: "POST", ip, secret: ADMIN, body });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await call("/v1/admin/promos", { method: "POST", ip: "198.51.100.51", secret: ADMIN, body })).status).toBe(200);
  });
});

describe("promo attempts", () => {
  it("answers 429 to the 21st attempt from one address in an hour, across devices", async () => {
    const ip = "198.51.100.80";
    const attempt = (secret: string, i: number) => call("/v1/promo", { method: "POST", ip, secret, body: JSON.stringify({ code: `GUESS-${i}` }) });
    for (let d = 0; d < 4; d += 1) {
      const secret = await registered();
      for (let i = 0; i < 5; i += 1) expect((await attempt(secret, i)).status).toBe(400);
    }
    const fresh = await registered();
    const limited = await attempt(fresh, 0);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await call("/v1/promo", { method: "POST", ip: "198.51.100.81", secret: fresh, body: JSON.stringify({ code: "GUESS" }) })).status).toBe(400);
  });
});

describe("promo redemptions from one address", () => {
  it("lets 25 devices behind one address redeem a valid code: only refused attempts count per address", async () => {
    const ip = "198.51.100.90";
    await stub().setSnapshot(1_000n * 1_000_000_000n, 0n, Date.now());
    const code = `VENUE-${randomSecret(8)}`;
    const added = await call("/v1/admin/promos", {
      method: "POST",
      ip: "198.51.100.91",
      secret: ADMIN,
      body: JSON.stringify({ code, credits: 100, maxUses: 30 }),
    });
    expect(added.status).toBe(200);
    for (let i = 0; i < 25; i += 1) {
      const res = await call("/v1/promo", { method: "POST", ip, secret: await registered(), body: JSON.stringify({ code }) });
      expect(res.status).toBe(201);
    }
    // Refusals still count: 20 wrong codes from the address, then even a valid one is answered 429.
    for (let i = 0; i < 20; i += 1) {
      expect((await call("/v1/promo", { method: "POST", ip, secret: await registered(), body: JSON.stringify({ code: `WRONG-${i}` }) })).status).toBe(400);
    }
    const limited = await call("/v1/promo", { method: "POST", ip, secret: await registered(), body: JSON.stringify({ code }) });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
  });
});

describe("the rate limiter under concurrent requests", () => {
  it("lets exactly 100 of 105 simultaneous registrations from one address through", async () => {
    const ip = "198.51.100.60";
    const hashes = await Promise.all(Array.from({ length: 105 }, (_, i) => sha256Hex(`concurrent-${i}-${randomSecret()}`)));
    const answers = await Promise.all(
      hashes.map((secretHash) => call("/v1/devices", { method: "POST", ip, body: JSON.stringify({ secretHash }) })),
    );
    const statuses = answers.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(100);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });
});
