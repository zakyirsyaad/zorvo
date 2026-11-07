import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hmacSha256Hex, randomSecret, sha256Hex, timingSafeEqual } from "../src/crypto";
import type { Env } from "../src/config";

const ledgerEnv = env as unknown as Env;

function call(path: string, init: RequestInit & { ip?: string; secret?: string } = {}): Promise<Response> {
  const { ip, secret, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (ip) headers.set("CF-Connecting-IP", ip);
  if (secret) headers.set("Authorization", `Bearer ${secret}`);
  return exports.default.fetch(new Request(`https://credits.test${path}`, { ...rest, headers }));
}

function register(secretHash: string, ip = "198.51.100.1"): Promise<Response> {
  return call("/v1/devices", { method: "POST", body: JSON.stringify({ secretHash }), ip });
}

/** A device with a fresh secret; the IP is unique per call so the rate limit never gets in the way. */
let nextIp = 0;
async function registerFresh(): Promise<{ secret: string; deviceId: string }> {
  const secret = randomSecret();
  nextIp += 1;
  const res = await register(await sha256Hex(secret), `203.0.113.${nextIp}`);
  expect(res.status).toBe(201);
  return { secret, deviceId: ((await res.json()) as { deviceId: string }).deviceId };
}

describe("POST /v1/devices", () => {
  it("registers a device and returns its id", async () => {
    const res = await register(await sha256Hex("first"), "192.0.2.10");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { deviceId: string };
    expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects the same secret hash twice", async () => {
    const hash = await sha256Hex("duplicate");
    expect((await register(hash, "192.0.2.11")).status).toBe(201);
    const again = await register(hash, "192.0.2.11");
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "bad_request" });
  });

  it.each([
    ["not json", "{"],
    ["a missing hash", "{}"],
    ["a non-string hash", JSON.stringify({ secretHash: 5 })],
    ["a short hash", JSON.stringify({ secretHash: "abc" })],
    ["an uppercase hash", JSON.stringify({ secretHash: "A".repeat(64) })],
    ["a non-hex hash", JSON.stringify({ secretHash: "g".repeat(64) })],
  ])("rejects %s with bad_request", async (_name, body) => {
    const res = await call("/v1/devices", { method: "POST", body, ip: "192.0.2.12" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("answers the 11th registration from one IP within an hour with 429", async () => {
    const ip = "192.0.2.20";
    for (let i = 0; i < 10; i += 1) {
      expect((await register(await sha256Hex(`limit-${i}`), ip)).status).toBe(201);
    }
    const res = await register(await sha256Hex("limit-10"), ip);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    // Another IP is not affected.
    expect((await register(await sha256Hex("limit-other"), "192.0.2.21")).status).toBe(201);
  });

  it("counts requests without a CF-Connecting-IP header in one shared bucket", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await call("/v1/devices", {
        method: "POST",
        body: JSON.stringify({ secretHash: await sha256Hex(`unknown-${i}`) }),
      });
      expect(res.status).toBe(201);
    }
    const res = await call("/v1/devices", {
      method: "POST",
      body: JSON.stringify({ secretHash: await sha256Hex("unknown-10") }),
    });
    expect(res.status).toBe(429);
  });

  it("opens a new window once the hour is over", async () => {
    const ip = "192.0.2.30";
    for (let i = 0; i < 10; i += 1) await register(await sha256Hex(`window-${i}`), ip);
    expect((await register(await sha256Hex("window-10"), ip)).status).toBe(429);

    const stub = ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));
    await runInDurableObject(stub, (_ledger, state) => {
      state.storage.sql.exec(
        "UPDATE ratelimits SET window_start = window_start - 3600001 WHERE key = ?",
        `devices:${ip}`,
      );
    });
    expect((await register(await sha256Hex("window-11"), ip)).status).toBe(201);
  });
});

describe("device auth", () => {
  it("answers 401 unauthorized without a Bearer token", async () => {
    const res = await call("/v1/balance");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("answers 401 for a malformed Authorization header", async () => {
    const res = await call("/v1/balance", { headers: { Authorization: "Basic abc" } });
    expect(res.status).toBe(401);
  });

  it("answers 401 for an unknown secret", async () => {
    const res = await call("/v1/balance", { secret: randomSecret() });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("lets a registered device through", async () => {
    const { secret } = await registerFresh();
    const res = await call("/v1/balance", { secret });
    expect(res.status).not.toBe(401);
  });

  it("refuses a revoked device", async () => {
    const { secret, deviceId } = await registerFresh();
    const stub = ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));
    await runInDurableObject(stub, (_ledger, state) => {
      state.storage.sql.exec("UPDATE devices SET revoked_at = ? WHERE id = ?", Date.now(), deviceId);
    });
    const res = await call("/v1/balance", { secret });
    expect(res.status).toBe(401);
  });

  it("answers unknown paths with 404", async () => {
    const res = await call("/v1/nothing");
    expect(res.status).toBe(404);
  });
});

describe("crypto", () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

  it("round-trips AES-GCM and never repeats a ciphertext", async () => {
    const a = await encrypt(key, "x");
    const b = await encrypt(key, "x");
    expect(await decrypt(key, a)).toBe("x");
    expect(a).not.toBe(b);
  });

  it("refuses a tampered blob or the wrong key", async () => {
    const blob = await encrypt(key, "secret");
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    await expect(decrypt(other, blob)).rejects.toThrow();
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await expect(decrypt(key, btoa(String.fromCharCode(...bytes)))).rejects.toThrow();
  });

  it("compares strings without short-circuiting", () => {
    expect(timingSafeEqual("ab", "ab")).toBe(true);
    expect(timingSafeEqual("ab", "ac")).toBe(false);
    expect(timingSafeEqual("ab", "abc")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("hashes and signs with the standard test vectors", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("makes url-safe secrets of the requested size", () => {
    expect(randomSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomSecret(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomSecret()).not.toBe(randomSecret());
  });
});
