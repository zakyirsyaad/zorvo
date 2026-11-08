import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { randomSecret, sha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { call, MINUTE_MS, newDevice, NOW, paidTopup, seedStock, sql, statusOf, stub, tick, useLedger } from "./harness";

/** The queue's NEAR AI calls and key bookkeeping (key creation, rotation, revokes). */

const h = useLedger();

/** A device with a key from a credited $5 top-up, and the key's id. */
async function deviceWithKey(): Promise<{ deviceId: string; secret: string; keyId: string }> {
  const device = await newDevice();
  await paidTopup(h, device.deviceId);
  await tick(NOW);
  const keyId = await sql((s) => s.exec<{ nearai_key_id: string }>("SELECT nearai_key_id FROM devices WHERE id = ?", device.deviceId).one().nearai_key_id);
  return { ...device, keyId };
}

async function recover(secret: string): Promise<void> {
  const result = await stub().recover(await sha256Hex(secret), await sha256Hex(randomSecret()), NOW);
  if (!("ok" in result)) throw new Error("recovery failed");
}

const queue = () => sql((s) => s.exec<{ kind: string; ref: string; attempts: number }>("SELECT kind, ref, attempts FROM queue").toArray());

describe("a refused access token on key calls", () => {
  it("refreshes and creates the key in the same attempt when createKey is refused once", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    const topupId = await paidTopup(h, deviceId);
    h.near.failOnce.create = 401;

    await tick(NOW);

    expect(await statusOf(topupId)).toBe("credited");
    const creates = h.near.calls.filter((call) => call.route === "create");
    expect(creates.map((call) => call.auth)).toEqual(["Bearer acc-1", "Bearer acc-2"]);
    expect(h.near.keys.size).toBe(1);
  });

  it("refreshes and revokes the replaced key in the same tick when the revoke is refused once", async () => {
    await seedStock(h, 10_000);
    const { secret, keyId } = await deviceWithKey();
    await recover(secret);
    h.near.failOnce.revoke = 401;

    await tick(NOW + 1000);

    expect(h.near.keys.has(keyId)).toBe(false);
    expect(await queue()).toEqual([]);
    const revokes = h.near.calls.filter((call) => call.route === "revoke");
    expect(revokes).toHaveLength(2);
  });
});

describe("NEAR AI keys the Ledger does not hold", () => {
  it("revokes a device's orphan keys before it creates the device's key, and leaves other devices' keys alone", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    const other = await newDevice();
    h.near.keys.set("orphan-1", { name: `zorvo-${deviceId}`, limitNano: 4_000_000_000n, usageNano: 0n, secret: "lost" });
    h.near.keys.set("stranger", { name: `zorvo-${other.deviceId}`, limitNano: 1n, usageNano: 0n, secret: "s" });
    const topupId = await paidTopup(h, deviceId);

    await tick(NOW);

    expect(await statusOf(topupId)).toBe("credited");
    expect(h.near.keys.has("orphan-1")).toBe(false);
    expect(h.near.keys.has("stranger")).toBe(true);
    expect([...h.near.keys.values()].filter((key) => key.name === `zorvo-${deviceId}`)).toHaveLength(1);
  });

  it("revokes orphans before a rotation creates the new key, keeping the key being replaced until its own revoke", async () => {
    await seedStock(h, 10_000);
    const { secret, deviceId, keyId } = await deviceWithKey();
    h.near.keys.set("orphan-2", { name: `zorvo-${deviceId}`, limitNano: 1n, usageNano: 0n, secret: "lost" });
    await recover(secret);

    await tick(NOW + 1000);

    expect(h.near.keys.has("orphan-2")).toBe(false);
    expect(h.near.keys.has(keyId)).toBe(false);
    const current = await sql((s) => s.exec<{ nearai_key_id: string }>("SELECT nearai_key_id FROM devices WHERE id = ?", deviceId).one().nearai_key_id);
    expect(h.near.keys.get(current)?.name).toBe(`zorvo-${deviceId}`);
  });
});

describe("holds of finished top-ups", () => {
  it("are released by the sweep when a top-up is no longer paid", async () => {
    const { deviceId } = await newDevice();
    await sql((s) => {
      s.exec(
        `INSERT INTO topups (id, device_id, package_usd, credits, status, created_at, updated_at)
         VALUES ('t-done', ?, 5, 500, 'credited', ?, ?)`,
        deviceId,
        NOW,
        NOW,
      );
      s.exec("INSERT INTO reservations (topup_id, device_id, credits, expires_at) VALUES ('t-done', ?, 500, ?)", deviceId, Number.MAX_SAFE_INTEGER);
      s.exec("INSERT INTO reservations (topup_id, device_id, credits, expires_at) VALUES ('t-gone', ?, 500, ?)", deviceId, Number.MAX_SAFE_INTEGER);
    });
    await tick(NOW);
    expect(await sql((s) => s.exec("SELECT topup_id FROM reservations").toArray())).toEqual([]);
  });
});

describe("stuck queue alerts", () => {
  it("sends one summary an hour for all stuck items, not one per item", async () => {
    await seedStock(h, 10_000);
    for (let i = 0; i < 3; i += 1) await paidTopup(h, (await newDevice()).deviceId);
    h.near.status.create = 503;

    await tick(NOW + 61 * MINUTE_MS);
    await tick(NOW + 62 * MINUTE_MS);

    const stuck = h.alerts.filter((alert) => alert.kind === "stuck_queue");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.detail).toMatch(/^3 queue items have waited over an hour/);
  });
});

describe("GET /v1/key when the stored key cannot be decrypted", () => {
  it("answers 503 upstream with no-store and keeps the stored key", async () => {
    await seedStock(h, 10_000);
    const { deviceId, secret } = await deviceWithKey();
    await sql((s) => s.exec("UPDATE pending_keys SET key_ciphertext = ? WHERE device_id = ?", btoa("x".repeat(40)), deviceId));
    const res = await call("/v1/key", { secret });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "upstream" });
    expect(await sql((s) => s.exec("SELECT 1 FROM pending_keys WHERE device_id = ?", deviceId).toArray())).toHaveLength(1);
  });
});

describe("rotation edge cases", () => {
  it("does not rotate on a usage it could not read: a key the list leaves out keeps the rotation queued", async () => {
    await seedStock(h, 10_000);
    const { secret, deviceId, keyId } = await deviceWithKey();
    h.near.unlisted.add(keyId);
    await recover(secret);

    await tick(NOW + 1000);

    expect(await queue()).toEqual([expect.objectContaining({ kind: "rotate_key", ref: deviceId, attempts: 1 })]);
    const device = await sql((s) => s.exec<{ nearai_key_id: string }>("SELECT nearai_key_id FROM devices WHERE id = ?", deviceId).one());
    expect(device.nearai_key_id).toBe(keyId);
    expect(h.near.count("create")).toBe(1);
  });

  it("freezes a key whose usage is beyond 2^53 nano-USD and keeps every stored amount exact", async () => {
    await seedStock(h, 10_000);
    const { secret, deviceId, keyId } = await deviceWithKey();
    const key = h.near.keys.get(keyId)!;
    h.near.keys.set(keyId, { ...key, usageNano: 2n ** 53n + 4096n });
    await recover(secret);

    await tick(NOW + 1000);

    expect(await queue()).toEqual([]);
    const device = await sql((s) => s.exec<{ nearai_key_id: string | null }>("SELECT nearai_key_id FROM devices WHERE id = ?", deviceId).one());
    expect(device.nearai_key_id).toBeNull();
    const amounts = await sql((s) => [
      ...s.exec<{ v: number }>("SELECT limit_nano AS v FROM key_usage UNION ALL SELECT usage_nano FROM key_usage").toArray(),
      ...s.exec<{ v: number }>("SELECT outstanding_usd AS v FROM snapshot UNION ALL SELECT org_remaining_usd FROM snapshot").toArray(),
    ]);
    expect(amounts.every(({ v }) => v === null || Number.isSafeInteger(v))).toBe(true);
  });

  it("logs a failed revoke after a successful rotation as a revoke failure, not a rotation failure", async () => {
    await seedStock(h, 10_000);
    const { secret } = await deviceWithKey();
    await recover(secret);
    h.near.status.revoke = 500;

    await tick(NOW + 1000);

    expect(h.logged()).toMatch(/Revoking the replaced NEAR AI key/);
    expect(h.logged()).not.toMatch(/Key rotation for device/);
    expect((await queue()).map((item) => item.kind)).toEqual(["revoke_key"]);
  });
});

describe("a credit absorbed by a rotation", () => {
  it("raises credit_absorbed and ends the top-up credited", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    const topupId = await paidTopup(h, deviceId);
    // As after a zero-remainder rotation: the credit was counted, then credits_bought went back to 0.
    await sql((s) => s.exec("UPDATE queue SET counted = 1 WHERE ref = ?", topupId));

    await tick(NOW);

    expect(await statusOf(topupId)).toBe("credited");
    const absorbed = h.alerts.filter((alert) => alert.kind === "credit_absorbed");
    expect(absorbed).toHaveLength(1);
    expect(absorbed[0]!.detail).toContain(topupId);
  });
});

describe("the queue runner", () => {
  it("skips the credits of a device that is rotating, so they cannot crowd out another device's credit", async () => {
    await seedStock(h, 10_000);
    const rotating = await newDevice();
    await sql((s) => {
      for (let i = 0; i < 20; i += 1) {
        s.exec(
          `INSERT INTO topups (id, device_id, package_usd, credits, status, created_at, updated_at) VALUES (?, ?, 5, 500, 'paid', ?, ?)`,
          `t-rot-${i}`,
          rotating.deviceId,
          NOW,
          NOW,
        );
        s.exec("INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES (?, 'credit', ?, 0, ?, ?)", `q-${i}`, `t-rot-${i}`, NOW - 60_000, NOW);
      }
      s.exec("INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES ('q-rot', 'rotate_key', ?, 0, ?, ?)", rotating.deviceId, NOW + 3_600_000, NOW);
    });
    const { deviceId } = await newDevice();
    const topupId = await paidTopup(h, deviceId);

    await tick(NOW);

    expect(await statusOf(topupId)).toBe("credited");
  });
});

describe("alertOnce", () => {
  it("sends a kind and subject once an hour, and another subject at once", async () => {
    const send = (subject: string, at: number) =>
      runInDurableObject(stub(), (ledger: Ledger) =>
        (ledger as unknown as { alertOnce(k: string, s: string, d: string, n: number): Promise<void> }).alertOnce("low_stock", subject, `about ${subject}`, at),
      );
    await send("a", NOW);
    await send("a", NOW + 59 * MINUTE_MS);
    await send("b", NOW + 59 * MINUTE_MS);
    await send("a", NOW + 60 * MINUTE_MS);
    expect(h.alerts.map((alert) => alert.detail)).toEqual(["about a", "about b", "about a"]);
  });
});

describe("POST /v1/recover twice at once", () => {
  it("moves the device once and queues one rotation", async () => {
    await seedStock(h, 10_000);
    const { secret, deviceId } = await deviceWithKey();
    const hashes = await Promise.all([sha256Hex(randomSecret()), sha256Hex(randomSecret())]);
    const answers = await Promise.all(
      hashes.map((newSecretHash, i) =>
        call("/v1/recover", { method: "POST", ip: `198.51.100.7${i}`, body: JSON.stringify({ recoveryCode: secret, newSecretHash }) }),
      ),
    );
    expect(answers.map((res) => res.status).sort()).toEqual([200, 400]);
    const rotations = (await queue()).filter((item) => item.kind === "rotate_key");
    expect(rotations).toEqual([expect.objectContaining({ ref: deviceId })]);
  });
});

describe("/v1/topups/:id", () => {
  it("cancels once, answers the same on a second cancel, and 404s an unknown id", async () => {
    await seedStock(h, 10_000, Date.now());
    const { secret } = await newDevice();
    const created = await call("/v1/topups", { method: "POST", secret, body: JSON.stringify({ packageUsd: 5 }) });
    const { topupId } = (await created.json()) as { topupId: string };
    for (let i = 0; i < 2; i += 1) {
      const res = await call(`/v1/topups/${topupId}/cancel`, { method: "POST", secret });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "expired", credits: 500 });
    }
    expect(await (await call(`/v1/topups/${topupId}`, { secret })).json()).toEqual({ status: "expired", credits: 500 });
    expect(await sql((s) => s.exec("SELECT 1 FROM reservations").toArray())).toEqual([]);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await call(`/v1/topups/${unknown}`, { secret })).status).toBe(404);
    expect((await call(`/v1/topups/${unknown}/cancel`, { method: "POST", secret })).status).toBe(404);
  });
});
