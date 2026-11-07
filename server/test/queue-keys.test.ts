import { describe, expect, it } from "vitest";
import { randomSecret, sha256Hex } from "../src/crypto";
import { newDevice, NOW, paidTopup, seedStock, sql, statusOf, stub, tick, useLedger } from "./harness";

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
