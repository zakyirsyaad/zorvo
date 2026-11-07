import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { randomSecret, sha256Hex } from "../src/crypto";
import { computeStock } from "../src/ledger/stock";

const ledgerEnv = env as unknown as Env;
const cfg = parseConfig(ledgerEnv);
const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const USD = 1_000_000_000n;

const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

/** A second stub to the same object, as a second request would get. */
const otherStub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

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

/** Stock of exactly `credits` sellable credits (a multiple of 100 at 120 credits per dollar). */
async function seedStock(credits: number): Promise<void> {
  // Remaining = buffer + the cost of `credits` + a sliver (under one credit) that the rounding drops.
  const nanoForCredits = (BigInt(credits) * USD) / 120n;
  await stub().setSnapshot(cfg.stockBufferNano + nanoForCredits + 1_000_000n, 0n, NOW);
}

beforeEach(async () => {
  await runInDurableObject(stub(), (_ledger, state) => {
    for (const table of ["snapshot", "reservations", "topups"]) state.storage.sql.exec(`DELETE FROM ${table}`);
  });
});

describe("computeStock", () => {
  it("subtracts outstanding, reservations and the buffer, then rounds down to 100 credits", () => {
    // 20 - 5 - 4.1666... - 2 = 8.8333... dollars = 1059.99... credits.
    const result = computeStock(
      { orgRemainingNano: 20n * USD, outstandingNano: 5n * USD, reservedCredits: 500, waitingCredits: 0, bufferNano: 2n * USD },
      cfg,
    );
    expect(result).toEqual({ availableCredits: 1000 });
  });

  it("counts paid top-ups waiting for stock like reservations", () => {
    const result = computeStock(
      { orgRemainingNano: 20n * USD, outstandingNano: 5n * USD, reservedCredits: 0, waitingCredits: 500, bufferNano: 2n * USD },
      cfg,
    );
    expect(result).toEqual({ availableCredits: 1000 });
  });

  it("is never negative", () => {
    const result = computeStock(
      { orgRemainingNano: 1n * USD, outstandingNano: 5n * USD, reservedCredits: 500, waitingCredits: 0, bufferNano: 2n * USD },
      cfg,
    );
    expect(result).toEqual({ availableCredits: 0 });
  });
});

describe("stockFor", () => {
  it("lists the configured packages with their credits and the snapshot time", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    const view = await stub().stockFor(deviceId, NOW);
    expect(view.availableCredits).toBe(10_000);
    expect(view.yourRoomCredits).toBe(5000);
    expect(view.packages).toEqual([
      { usd: 5, credits: 500, available: true },
      { usd: 10, credits: 1000, available: true },
      { usd: 25, credits: 2500, available: true },
    ]);
    expect(view.updatedAt).toBe(new Date(NOW).toISOString());
  });

  it("reports no stock and the epoch before any snapshot exists", async () => {
    const { deviceId } = await newDevice();
    const view = await stub().stockFor(deviceId, NOW);
    expect(view.availableCredits).toBe(0);
    expect(view.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(view.packages.every((p) => !p.available && p.reason === "stock")).toBe(true);
  });

  it("marks $25 as device_cap when the device already holds 3,000 credits", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice(3000);
    const view = await stub().stockFor(deviceId, NOW);
    expect(view.yourRoomCredits).toBe(2000);
    expect(view.packages.find((p) => p.usd === 25)).toEqual({ usd: 25, credits: 2500, available: false, reason: "device_cap" });
    expect(view.packages.find((p) => p.usd === 10)?.available).toBe(true);
  });

  it("marks a package that exceeds the stock as stock", async () => {
    await seedStock(1000);
    const { deviceId } = await newDevice();
    const view = await stub().stockFor(deviceId, NOW);
    expect(view.packages.map((p) => [p.usd, p.available, p.reason])).toEqual([
      [5, true, undefined],
      [10, true, undefined],
      [25, false, "stock"],
    ]);
  });

  it("names the device cap when both limits apply", async () => {
    await seedStock(1000);
    const { deviceId } = await newDevice(4500);
    const view = await stub().stockFor(deviceId, NOW);
    expect(view.packages.find((p) => p.usd === 25)?.reason).toBe("device_cap");
  });

  it("counts the device's active reservations against its room, but not expired ones", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    await stub().reserve(deviceId, 1000, 10, NOW);
    expect((await stub().stockFor(deviceId, NOW)).yourRoomCredits).toBe(4000);
    expect((await stub().stockFor(deviceId, NOW + 31 * MINUTE_MS)).yourRoomCredits).toBe(5000);
  });
});

describe("reserve", () => {
  it("holds the credits for 30 minutes and takes them out of the stock", async () => {
    await seedStock(2000);
    const { deviceId } = await newDevice();
    const result = await stub().reserve(deviceId, 500, 5, NOW);
    expect(result).toEqual({ topupId: expect.any(String) });
    expect((await stub().stockFor(deviceId, NOW)).availableCredits).toBe(1500);

    const rows = await runInDurableObject(stub(), (_ledger, state) => ({
      topup: state.storage.sql.exec("SELECT * FROM topups").toArray(),
      reservation: state.storage.sql.exec("SELECT * FROM reservations").toArray(),
    }));
    expect(rows.topup).toEqual([
      expect.objectContaining({ device_id: deviceId, package_usd: 5, credits: 500, status: "created", reserved_until: NOW + 30 * MINUTE_MS }),
    ]);
    expect(rows.reservation).toEqual([
      expect.objectContaining({ device_id: deviceId, credits: 500, expires_at: NOW + 30 * MINUTE_MS }),
    ]);
  });

  it("gives the stock back once the hold has expired", async () => {
    await seedStock(500);
    const { deviceId } = await newDevice();
    expect(await stub().reserve(deviceId, 500, 5, NOW)).toEqual({ topupId: expect.any(String) });
    expect(await stub().reserve(deviceId, 500, 5, NOW + MINUTE_MS)).toEqual({ error: "stock" });
    expect(await stub().reserve(deviceId, 500, 5, NOW + 31 * MINUTE_MS)).toEqual({ topupId: expect.any(String) });
  });

  it("refuses without changing anything when there is not enough stock", async () => {
    await seedStock(400);
    const { deviceId } = await newDevice();
    expect(await stub().reserve(deviceId, 500, 5, NOW)).toEqual({ error: "stock" });
    const counts = await runInDurableObject(stub(), (_ledger, state) => [
      state.storage.sql.exec("SELECT 1 FROM topups").toArray().length,
      state.storage.sql.exec("SELECT 1 FROM reservations").toArray().length,
    ]);
    expect(counts).toEqual([0, 0]);
  });

  it("rejects a credit amount that is not a positive whole number", async () => {
    const { deviceId } = await newDevice();
    // Called inside the object: a throw over RPC is also reported as an unhandled rejection by the test pool.
    await runInDurableObject(stub(), (ledger) => {
      expect(() => ledger.reserve(deviceId, 0, 5, NOW)).toThrow(RangeError);
      expect(() => ledger.reserve(deviceId, 1.5, 5, NOW)).toThrow(RangeError);
    });
  });

  it("race 1: two devices reserving the last 500 credits get one reservation and one stock error", async () => {
    await seedStock(500);
    const [a, b] = await Promise.all([newDevice(), newDevice()]);
    const results = await Promise.all([stub().reserve(a.deviceId, 500, 5, NOW), otherStub().reserve(b.deviceId, 500, 5, NOW)]);
    expect(results.filter((r) => "topupId" in r)).toHaveLength(1);
    expect(results.filter((r) => "error" in r)).toEqual([{ error: "stock" }]);
  });

  it("race 2: a device with room for 2,600 credits cannot reserve 2,500 twice", async () => {
    await seedStock(20_000);
    const { deviceId } = await newDevice(2400);
    const results = await Promise.all([stub().reserve(deviceId, 2500, 25, NOW), otherStub().reserve(deviceId, 2500, 25, NOW)]);
    expect(results.filter((r) => "topupId" in r)).toHaveLength(1);
    expect(results.filter((r) => "error" in r)).toEqual([{ error: "device_cap" }]);
  });
});

describe("releaseReservation", () => {
  it("returns the credits to the stock and to the device's room", async () => {
    await seedStock(500);
    const { deviceId } = await newDevice();
    const reserved = await stub().reserve(deviceId, 500, 5, NOW);
    if (!("topupId" in reserved)) throw new Error("expected a reservation");
    const during = await stub().stockFor(deviceId, NOW);
    expect([during.availableCredits, during.yourRoomCredits]).toEqual([0, 4500]);

    await stub().releaseReservation(reserved.topupId);
    const after = await stub().stockFor(deviceId, NOW);
    expect([after.availableCredits, after.yourRoomCredits]).toEqual([500, 5000]);
  });
});

describe("GET /v1/stock", () => {
  const get = (secret?: string) =>
    exports.default.fetch(
      new Request("https://credits.test/v1/stock", { headers: secret ? { Authorization: `Bearer ${secret}` } : {} }),
    );

  it("answers 401 without a device", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns the caller's stock view, including what the caller has reserved", async () => {
    // The Worker reads the clock itself, so seed a snapshot taken now.
    await runInDurableObject(stub(), (ledger) => ledger.setSnapshot(cfg.stockBufferNano + 5n * USD, 0n, Date.now()));
    const { deviceId, secret } = await newDevice();
    expect(await stub().reserve(deviceId, 100, 1, Date.now())).toEqual({ topupId: expect.any(String) });

    const res = await get(secret);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { availableCredits: number; yourRoomCredits: number; packages: unknown[]; updatedAt: string };
    expect(body.availableCredits).toBe(500);
    expect(body.yourRoomCredits).toBe(4900);
    expect(body.packages).toHaveLength(3);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);
  });
});
