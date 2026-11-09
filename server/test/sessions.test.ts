// Per-session spending caps (spec 8.3 D): the routes, the invariant between the device key and
// its session keys, the end/raise paths and the alarm's idle sweep. NEAR AI is the harness fake.

import { describe, expect, it } from "vitest";
import { randomSecret, sha256Hex } from "../src/crypto";
import { spendLimitNano } from "../src/credits";
import { deviceLimitNano, sessionDebtNano, sessionRows } from "../src/ledger/sessions";
import {
  call,
  cfg,
  HOUR_MS,
  MINUTE_MS,
  newDevice,
  NOW,
  seedStock,
  sql,
  stub,
  tick,
  USD,
  useLedger,
} from "./harness";

const CAP = 100;
const BOUGHT = 500;
const harness = useLedger();

/** A device with `credits` bought and one key, as a completed top-up leaves it. */
async function deviceWithKey(credits = BOUGHT) {
  const { deviceId, secret } = await newDevice(credits);
  const keyId = "device-key";
  const limit = spendLimitNano(credits, cfg);
  harness.near.keys.set(keyId, { name: `zorvo-${deviceId}`, limitNano: limit, usageNano: 0n, secret: "sk-device" });
  await sql((s) => {
    s.exec("UPDATE devices SET nearai_key_id = ? WHERE id = ?", keyId, deviceId);
    s.exec(
      "INSERT OR REPLACE INTO key_usage (key_id, limit_nano, usage_nano) VALUES (?, ?, ?)",
      keyId,
      Number(limit),
      0,
    );
    s.exec(
      "INSERT OR REPLACE INTO snapshot (id, org_remaining_usd, outstanding_usd, taken_at) VALUES (1, ?, ?, ?)",
      Number(10n * USD),
      Number(limit),
      NOW,
    );
  });
  return { deviceId, secret, keyId, limit };
}

/** The device key's invariant limit and its session rows, both read after an operation. */
async function limits(deviceId: string) {
  return sql((s) => {
    const device = s.exec<{ credits_bought: number }>("SELECT credits_bought FROM devices WHERE id = ?", deviceId).one();
    return {
      expected: deviceLimitNano(s, cfg, deviceId, device.credits_bought),
      debt: sessionDebtNano(s, deviceId),
      rows: sessionRows(s, deviceId),
    };
  });
}

async function create(secret: string, credits: number) {
  const response = await call("/v1/sessions", {
    method: "POST",
    secret,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credits }),
  });
  return { response, body: (await response.json()) as { sessionId?: string; key?: string; error?: string } };
}

async function end(secret: string, id: string) {
  return call(`/v1/sessions/${id}/end`, { method: "POST", secret });
}

async function raise(secret: string, id: string, credits: number) {
  const response = await call(`/v1/sessions/${id}/raise`, {
    method: "POST",
    secret,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credits }),
  });
  return { response, body: (await response.json()) as { cap?: number; error?: string } };
}

/** A $5 top-up of `deviceId`, paid and waiting for the next tick's credit. */
async function paidTopup(deviceId: string, at = NOW): Promise<void> {
  const created = await stub().createTopup(deviceId, 5, at);
  if ("error" in created) throw new Error(`could not create a test top-up: ${created.error}`);
  const sessionId = created.sessionUrl.split("/").pop()!;
  harness.ping.pay(sessionId);
  await stub().onSessionEvent(sessionId, null, at);
}

describe("POST /v1/sessions", () => {
  it("makes a session key with the cap's limit and lowers the device key by the same amount", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    const { response, body } = await create(secret, CAP);

    expect(response.status).toBe(201);
    expect(body.key).toMatch(/^sk-secret-/);
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(row).toMatchObject({ id: body.sessionId, cap_credits: CAP, status: "active", usage_nano: 0 });
    expect(harness.near.keys.get(row.nearai_key_id!)).toMatchObject({
      name: `zorvo-session-${body.sessionId}`,
      limitNano: spendLimitNano(CAP, cfg),
      usageNano: 0n,
    });
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit - spendLimitNano(CAP, cfg));
    expect((await limits(deviceId)).expected).toBe(limit - spendLimitNano(CAP, cfg));
  });

  it("refuses a cap larger than the device key has unallocated, without making a key", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey(80);
    const before = harness.near.count("create");
    const { response, body } = await create(secret, 500);

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "insufficient" });
    expect(harness.near.count("create")).toBe(before);
    expect(await sql((s) => sessionRows(s, deviceId))).toEqual([]);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit);
  });

  it("refuses a cap that is not 100, 200 or 500", async () => {
    const { secret, deviceId } = await deviceWithKey();
    for (const credits of [0, 50, 150, -100, 1.5]) {
      const response = await create(secret, credits);
      expect(response.response.status).toBe(400);
      expect(response.body).toEqual({ error: "bad_request" });
    }
    expect(await sql((s) => sessionRows(s, deviceId))).toEqual([]);
  });

  it("removes the session and restores the device limit when the key cannot be made", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    harness.near.status.create = 503;
    const { response, body } = await create(secret, CAP);

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "upstream" });
    expect(await sql((s) => sessionRows(s, deviceId))).toEqual([]);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit);
  });

  it("revokes the new session key and restores the device limit when the device PATCH fails", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    harness.near.failOnce.patch = 503;
    const { response, body } = await create(secret, CAP);

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "upstream" });
    expect(await sql((s) => sessionRows(s, deviceId))).toEqual([]);
    expect([...harness.near.keys.values()].some((key) => key.name.startsWith("zorvo-session-"))).toBe(false);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit);
  });

  it("answers 401 without the device secret", async () => {
    const response = await call("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits: CAP }),
    });
    expect(response.status).toBe(401);
  });
});

describe("ending a session", () => {
  it("returns the unspent cap, records the usage and revokes the session key", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    harness.near.keys.set(row.nearai_key_id!, {
      ...harness.near.keys.get(row.nearai_key_id!)!,
      usageNano: 500_000_000n,
    });

    const ended = await end(secret, id);
    expect(ended.status).toBe(200);
    await tick(NOW + MINUTE_MS);

    const after = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(after).toMatchObject({ status: "ended", usage_nano: 500_000_000 });
    const expected = limit - 500_000_000n;
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(expected);
    expect(harness.near.keys.has(row.nearai_key_id!)).toBe(true); // frozen, revoked by the next tick
    await tick(NOW + 2 * MINUTE_MS);
    expect(harness.near.keys.has(row.nearai_key_id!)).toBe(false);
    expect((await limits(deviceId)).expected).toBe(expected);
  });

  it("is idempotent and queues one end", async () => {
    const { secret } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;

    expect((await end(secret, id)).status).toBe(200);
    expect((await end(secret, id)).status).toBe(200);
    const queue = await sql((s) =>
      s.exec<{ kind: string }>("SELECT kind FROM queue WHERE kind = 'end_session'").toArray(),
    );
    expect(queue).toHaveLength(1);
  });

  it("answers 404 for another device's session", async () => {
    const first = await deviceWithKey();
    const { body } = await create(first.secret, CAP);
    const other = await newDevice(BOUGHT);
    const response = await end(other.secret, body.sessionId!);
    expect(response.status).toBe(404);
  });
});

describe("POST /v1/sessions/:id/seen", () => {
  it("moves last_seen_at, and the 24-hour sweep ends the session", async () => {
    const { deviceId, secret } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;

    const seen = await call(`/v1/sessions/${id}/seen`, { method: "POST", secret });
    expect(seen.status).toBe(200);
    await sql((s) => s.exec("UPDATE session_keys SET last_seen_at = ? WHERE id = ?", NOW - 25 * HOUR_MS, id));
    await tick(NOW);

    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(row.status).toBe("ended");
    expect(row.usage_nano).toBe(0);
  });

  it("answers 404 for a session that has ended", async () => {
    const { secret } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    await end(secret, body.sessionId!);
    await tick(NOW + MINUTE_MS);
    const seen = await call(`/v1/sessions/${body.sessionId}/seen`, { method: "POST", secret });
    expect(seen.status).toBe(404);
  });
});

describe("raising a cap", () => {
  it("doubles the session key and takes the difference from the device key", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    const sessionKey = (await sql((s) => sessionRows(s, deviceId)))[0]!.nearai_key_id!;

    const { response, body: raised } = await raise(secret, id, 200);
    expect(response.status).toBe(200);
    expect(raised).toEqual({ cap: 200 });
    expect((await sql((s) => sessionRows(s, deviceId)))[0]!.cap_credits).toBe(200);
    expect(harness.near.keys.get(sessionKey)?.limitNano).toBe(spendLimitNano(200, cfg));
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit - spendLimitNano(200, cfg));

    const { response: again } = await raise(secret, id, 400);
    expect(again.status).toBe(200);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit - spendLimitNano(400, cfg));
  });

  it("refuses more than the current cap plus the device's unallocated credits", async () => {
    const { deviceId, secret, keyId } = await deviceWithKey(300);
    const { body } = await create(secret, 200);
    const id = body.sessionId!;
    const before = harness.near.keys.get(keyId)?.limitNano;

    const { response, body: refused } = await raise(secret, id, 400);
    expect(response.status).toBe(409);
    expect(refused).toEqual({ error: "insufficient" });
    expect((await sql((s) => sessionRows(s, deviceId)))[0]!.cap_credits).toBe(200);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(before);
  });

  it("refuses a cap that is not double, a bad body, and an ended session", async () => {
    const { secret } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    for (const credits of [100, 150, 300, 0, 1.5]) {
      const result = await raise(secret, id, credits);
      expect(result.response.status).toBe(400);
      expect(result.body).toEqual({ error: "bad_request" });
    }
    await end(secret, id);
    expect((await raise(secret, id, 200)).response.status).toBe(400);
  });
});

describe("the invariant with credits and sessions", () => {
  it("keeps device limit = bought - active caps - ended usage after a credit lands", async () => {
    const { deviceId, secret, keyId } = await deviceWithKey();
    await seedStock(harness, 1000);
    await create(secret, CAP);
    // The route uses the real clock; the alarm below runs at the harness's NOW.
    await sql((s) => s.exec("UPDATE session_keys SET last_seen_at = ?", NOW));

    // A $5 top-up lands while the cap is active.
    const topup = await call("/v1/topups", {
      method: "POST",
      secret,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packageUsd: 5 }),
    });
    expect(topup.status).toBe(201);
    const { sessionUrl } = (await topup.json()) as { sessionUrl: string };
    const sessionId = sessionUrl.split("/").pop()!;
    harness.ping.pay(sessionId);
    await stub().onSessionEvent(sessionId, null, NOW);
    await tick(NOW + MINUTE_MS);

    const state = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(state.status).toBe("active");
    const expected = spendLimitNano(BOUGHT + 500, cfg) - spendLimitNano(CAP, cfg);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(expected);
    expect((await limits(deviceId)).expected).toBe(expected);
  });

  it("counts an active session key's usage in the balance and the used credits", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    harness.near.keys.set(row.nearai_key_id!, {
      ...harness.near.keys.get(row.nearai_key_id!)!,
      usageNano: 1n * USD,
    });
    await stub().refreshSnapshot(NOW);
    const balance = await stub().balanceFor(deviceId, false, NOW);
    expect(balance.usedCredits).toBe(120);
    expect(balance.credits).toBe(379);
    expect(balance.credits).toBe(
      Number(((limit - 1n * USD) * 120n) / 1_000_000_000n),
    );
  });
});

describe("races", () => {
  it("starts a session while a credit lands, and both end on the invariant", async () => {
    const { deviceId, secret, keyId } = await deviceWithKey();
    await seedStock(harness, 1000);
    const at = Date.now();
    await paidTopup(deviceId, at);
    const hold = harness.near.hold("create");
    const session = create(secret, CAP);
    await hold.started;
    const credit = tick(at + 1_000);
    hold.release();
    const [{ response }] = await Promise.all([session, credit]);

    expect(response.status).toBe(201);
    const expected = spendLimitNano(BOUGHT + 500, cfg) - spendLimitNano(CAP, cfg);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(expected);
    expect((await limits(deviceId)).expected).toBe(expected);
  });

  it("starts two sessions at once without overcommitting the device key", async () => {
    const { deviceId, secret, keyId } = await deviceWithKey();
    const [first, second] = await Promise.all([create(secret, 200), create(secret, 200)]);
    expect([first.response.status, second.response.status].sort()).toEqual([201, 201]);
    const expected = spendLimitNano(BOUGHT, cfg) - 2n * spendLimitNano(200, cfg);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(expected);
    expect((await limits(deviceId)).expected).toBe(expected);
  });

  it("refuses the second of two sessions that together pass the device key", async () => {
    const { deviceId, secret } = await deviceWithKey();
    const results = await Promise.all([create(secret, 500), create(secret, 100)]);
    expect(results.map((result) => result.response.status).sort()).toEqual([201, 409]);
    expect(await sql((s) => sessionRows(s, deviceId))).toHaveLength(1);
  });

  it("raises a cap while a credit lands, and the later invariant wins", async () => {
    const { deviceId, secret, keyId } = await deviceWithKey();
    await seedStock(harness, 1000);
    await paidTopup(deviceId);
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    await sql((s) => s.exec("UPDATE session_keys SET last_seen_at = ? WHERE id = ?", NOW, id));
    const hold = harness.near.hold("patch");
    const credit = tick(NOW);
    await hold.started;
    const raised = raise(secret, id, 200);
    hold.release();
    const [, result] = await Promise.all([credit, raised]);

    expect(result.response.status).toBe(200);
    const expected = spendLimitNano(BOUGHT + 500, cfg) - spendLimitNano(200, cfg);
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(expected);
    expect((await limits(deviceId)).expected).toBe(expected);
  });

  it("ends a session while a raise is asked for, and ends on the invariant", async () => {
    const { deviceId, secret, keyId, limit } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    const [ended, raised] = await Promise.all([end(secret, id), raise(secret, id, 200)]);
    expect(ended.status).toBe(200);
    expect([200, 400]).toContain(raised.response.status);
    await tick(NOW + MINUTE_MS);
    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(row.status).toBe("ended");
    expect(harness.near.keys.get(keyId)?.limitNano).toBe(limit);
    expect((await limits(deviceId)).expected).toBe(limit);
  });

  it("recovers with an active session: ends it, counts its usage and rotates the device key", async () => {
    const { deviceId, secret } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    harness.near.keys.set(row.nearai_key_id!, {
      ...harness.near.keys.get(row.nearai_key_id!)!,
      usageNano: 250_000_000n,
    });
    await sql((s) => s.exec("UPDATE session_keys SET last_seen_at = ? WHERE id = ?", NOW, id));
    const newSecret = randomSecret();
    const recovered = await call("/v1/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recoveryCode: secret, newSecretHash: await sha256Hex(newSecret) }),
    });
    expect(recovered.status).toBe(200);
    await tick(NOW + MINUTE_MS);
    await tick(NOW + 2 * MINUTE_MS);

    const after = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(after).toMatchObject({ status: "ended", usage_nano: 250_000_000 });
    expect(after.settled_at).not.toBeNull();
    const device = await sql((s) =>
      s.exec<{ nearai_key_id: string; credits_bought: number }>(
        "SELECT nearai_key_id, credits_bought FROM devices WHERE id = ?",
        deviceId,
      ).one(),
    );
    expect(device).toMatchObject({ nearai_key_id: "key-2", credits_bought: 470 });
    expect(harness.near.keys.get("key-2")?.limitNano).toBe(spendLimitNano(470, cfg));
    expect(harness.near.keys.has(row.nearai_key_id!)).toBe(false);
  });

  it("drops an end item for a session whose key was never made", async () => {
    await deviceWithKey();
    await sql((s) =>
      s.exec(
        "INSERT INTO queue (id, kind, ref, attempts, next_at, created_at) VALUES (?, 'end_session', ?, 0, ?, ?)",
        crypto.randomUUID(),
        crypto.randomUUID(),
        NOW,
        NOW,
      ),
    );
    const before = harness.near.count("patch");
    await tick(NOW);
    const endItems = await sql((s) =>
      s.exec<{ kind: string }>("SELECT kind FROM queue WHERE kind = 'end_session'").toArray(),
    );
    expect(endItems).toEqual([]);
    expect(harness.near.count("patch")).toBe(before);
  });

  it("sweeps an idle session while the app is ending it", async () => {
    const { deviceId, secret } = await deviceWithKey();
    const { body } = await create(secret, CAP);
    const id = body.sessionId!;
    await sql((s) => s.exec("UPDATE session_keys SET last_seen_at = ? WHERE id = ?", NOW - 25 * HOUR_MS, id));
    const [, ticked] = await Promise.all([end(secret, id), tick(NOW)]);
    void ticked;
    await tick(NOW + MINUTE_MS);
    const row = (await sql((s) => sessionRows(s, deviceId)))[0]!;
    expect(row.status).toBe("ended");
    const ends = await sql((s) =>
      s.exec<{ kind: string }>("SELECT kind FROM queue WHERE kind = 'end_session'").toArray(),
    );
    expect(ends).toEqual([]);
  });
});