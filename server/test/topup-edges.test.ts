import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { hmacSha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { verifyWebhook } from "../src/pingpay";
import { call, checkout, ledgerEnv, MINUTE_MS, newDevice, NOW, seedStock, sql, statusOf, stub, tick, useLedger } from "./harness";

/** Top-ups at PingPay's edges: missing fields, conflicts, odd payment states and the hold's length. */

const h = useLedger();
const WEBHOOK_SECRET = "test-webhook-secret";
const DEFAULT_PAID_URL = "https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-paid";
const DEFAULT_CANCELLED_URL = "https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-cancelled";

async function webhook(type: string, resourceId: string, id: string): Promise<Response> {
  const body = JSON.stringify({ id, type, resourceId, data: {}, createdAt: new Date().toISOString() });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return call("/v1/webhooks/pingpay", {
    method: "POST",
    body,
    headers: { "x-ping-timestamp": timestamp, "x-ping-signature": await hmacSha256Hex(WEBHOOK_SECRET, `${timestamp}.${body}`) },
  });
}

function topUp(secret: string, packageUsd: unknown): Promise<Response> {
  return call("/v1/topups", { method: "POST", secret, body: JSON.stringify({ packageUsd }) });
}

const topupRow = (topupId: string) =>
  sql((s) =>
    s
      .exec<{ status: string; ping_session_id: string | null; reserved_until: number | null }>(
        "SELECT status, ping_session_id, reserved_until FROM topups WHERE id = ?",
        topupId,
      )
      .one(),
  );
const reservationOf = (topupId: string) =>
  sql((s) => s.exec<{ expires_at: number }>("SELECT expires_at FROM reservations WHERE topup_id = ?", topupId).toArray()[0]);
const eventIds = () => sql((s) => s.exec<{ id: string }>("SELECT id FROM events").toArray().map((row) => row.id));

function setLedgerEnv(change: Partial<Env>): Promise<void> {
  return runInDurableObject(stub(), (ledger: Ledger) => {
    const self = ledger as unknown as { env: Env; parsedConfig: unknown };
    self.env = { ...self.env, ...change };
    self.parsedConfig = undefined;
  });
}

describe("a checkout answer without an expiry", () => {
  it("opens the top-up with a 30-minute session assumed, held 10 minutes longer", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    h.ping.omitExpiry = true;
    const created = await stub().createTopup(deviceId, 5, NOW);
    if ("error" in created) throw new Error(`no top-up: ${created.error}`);
    expect(created.expiresAt).toBe(new Date(NOW + 30 * MINUTE_MS).toISOString());
    expect((await topupRow(created.topupId)).reserved_until).toBe(NOW + 40 * MINUTE_MS);
    expect((await reservationOf(created.topupId))?.expires_at).toBe(NOW + 40 * MINUTE_MS);
  });
});

describe("the hold of a long checkout", () => {
  it("lasts at most an hour plus the 10-minute grace", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    h.ping.expiresAt = () => NOW + 24 * 60 * MINUTE_MS;
    const { topupId } = await checkout(deviceId);
    expect((await topupRow(topupId)).reserved_until).toBe(NOW + 70 * MINUTE_MS);
  });
});

describe("a session PingPay answers without an amount", () => {
  it("still expires an EXPIRED or CANCELLED session, since only a paid one needs the amount", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    for (const status of ["EXPIRED", "CANCELLED"] as const) {
      const { topupId, sessionId } = await checkout(deviceId);
      h.ping.setStatus(sessionId, status);
      h.ping.dropAmount(sessionId);
      expect(await stub().onSessionEvent(sessionId, null, NOW)).toBe("expired");
      expect(await statusOf(topupId)).toBe("expired");
    }
  });

  it("still refuses a COMPLETED session without one", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    const { sessionId } = await checkout(deviceId);
    h.ping.pay(sessionId);
    h.ping.dropAmount(sessionId);
    await runInDurableObject(stub(), async (ledger: Ledger) => {
      await expect(ledger.onSessionEvent(sessionId, null, NOW)).rejects.toThrow(/amount/);
    });
  });
});

describe("POST /v1/topups failures", () => {
  it("answers 502 upstream, not a bare 500, when the Ledger throws", async () => {
    await seedStock(h, 10_000, Date.now());
    const { secret } = await newDevice();
    await setLedgerEnv({ PINGPAY_API_KEY: "" });
    const res = await topUp(secret, 5);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream" });
    expect(h.logged()).toMatch(/POST \/v1\/topups failed: Error: Missing secret PINGPAY_API_KEY/);
  });

  it("answers 502 when the checkout pays another recipient, and gives the stock back", async () => {
    await seedStock(h, 10_000, Date.now());
    const { secret } = await newDevice();
    h.ping.recipient = "someone-else.near";
    const res = await topUp(secret, 5);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream" });
    const rows = await sql((s) => s.exec<{ status: string }>("SELECT status FROM topups").toArray());
    expect(rows).toEqual([{ status: "failed" }]);
    expect(await sql((s) => s.exec("SELECT 1 FROM reservations").toArray())).toEqual([]);
  });

  it("fails a top-up whose session id is already another top-up's, and releases its hold", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    h.ping.fixedSessionId = "cs_same";
    const first = await checkout(deviceId);
    const second = await stub().createTopup(deviceId, 5, NOW);
    expect(second).toEqual({ error: "upstream" });
    const rows = await sql((s) => s.exec<{ id: string; status: string; ping_session_id: string | null }>("SELECT id, status, ping_session_id FROM topups ORDER BY created_at, id").toArray());
    expect(rows.find((row) => row.id === first.topupId)).toMatchObject({ status: "created", ping_session_id: "cs_same" });
    expect(rows.find((row) => row.id !== first.topupId)).toMatchObject({ status: "failed", ping_session_id: null });
    const holds = await sql((s) => s.exec<{ topup_id: string }>("SELECT topup_id FROM reservations").toArray());
    expect(holds).toEqual([{ topup_id: first.topupId }]);
    expect(h.logged()).toMatch(/already belongs to another top-up/);
  });

  it("does not count a malformed request against the device's 10 top-ups an hour", async () => {
    await seedStock(h, 10_000, Date.now());
    const { secret } = await newDevice();
    for (let i = 0; i < 11; i += 1) expect((await topUp(secret, 7)).status).toBe(400);
    expect((await topUp(secret, 5)).status).toBe(201);
  });
});

describe("checkout pages", () => {
  it("sends the payer to the README sections by default", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    const { sessionId } = await checkout(deviceId);
    expect(h.ping.sessions.get(sessionId)?.body).toMatchObject({ successUrl: DEFAULT_PAID_URL, cancelUrl: DEFAULT_CANCELLED_URL });
  });

  it("sends the payer to the pages the variables name", async () => {
    await seedStock(h, 10_000);
    const { deviceId } = await newDevice();
    await setLedgerEnv({ CHECKOUT_PAID_URL: "https://zorvohub.xyz/paid", CHECKOUT_CANCELLED_URL: "https://zorvohub.xyz/cancelled" });
    const { sessionId } = await checkout(deviceId);
    expect(h.ping.sessions.get(sessionId)?.body).toMatchObject({
      successUrl: "https://zorvohub.xyz/paid",
      cancelUrl: "https://zorvohub.xyz/cancelled",
    });
  });

  it("refuses a page that is not https", () => {
    expect(() => parseConfig({ ...ledgerEnv, CHECKOUT_PAID_URL: "http://zorvohub.xyz/paid" })).toThrow("CHECKOUT_PAID_URL");
    expect(() => parseConfig({ ...ledgerEnv, CHECKOUT_CANCELLED_URL: "not a url" })).toThrow("CHECKOUT_CANCELLED_URL");
  });
});

describe("created top-ups that never got a checkout", () => {
  it("are failed by the sweep once their hold has passed, and a younger one is left", async () => {
    const { deviceId } = await newDevice();
    await sql((s) => {
      for (const [id, at] of [["t-old", NOW - 41 * MINUTE_MS], ["t-young", NOW - 5 * MINUTE_MS]] as const) {
        s.exec(
          `INSERT INTO topups (id, device_id, package_usd, credits, status, reserved_until, created_at, updated_at)
           VALUES (?, ?, 5, 500, 'created', ?, ?, ?)`,
          id,
          deviceId,
          at + 30 * MINUTE_MS,
          at,
          at,
        );
        s.exec("INSERT INTO reservations (topup_id, device_id, credits, expires_at) VALUES (?, ?, 500, ?)", id, deviceId, at + 30 * MINUTE_MS);
      }
    });
    await tick(NOW);
    expect(await statusOf("t-old")).toBe("failed");
    expect(await statusOf("t-young")).toBe("created");
  });
});

describe("webhooks for unusual payment states", () => {
  it("records a REFUNDED payment and changes nothing", async () => {
    await seedStock(h, 10_000, Date.now());
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId, Date.now());
    h.ping.pay(sessionId, "REFUNDED");
    expect((await webhook("checkout.session.completed", sessionId, "evt_refund")).status).toBe(200);
    expect(await statusOf(topupId)).toBe("created");
    expect(await eventIds()).toEqual(["evt_refund"]);
    expect(await sql((s) => s.exec("SELECT 1 FROM queue").toArray())).toEqual([]);
  });

  it.each(["CREATED", "PENDING"] as const)("asks for a redelivery of an expired event while the session still reads %s", async (status) => {
    await seedStock(h, 10_000, Date.now());
    const { deviceId } = await newDevice();
    const { topupId, sessionId } = await checkout(deviceId, Date.now());
    h.ping.setStatus(sessionId, status);
    const res = await webhook("checkout.session.expired", sessionId, "evt_early");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream" });
    expect(await statusOf(topupId)).toBe("created");
    expect(await eventIds()).toEqual([]);
  });
});

describe("webhook timestamps", () => {
  it("accepts one exactly 5 minutes old and refuses one a second older", async () => {
    const body = "{}";
    const secret = "s";
    const headersAt = async (at: number) => {
      const timestamp = String(at);
      return new Headers({ "x-ping-timestamp": timestamp, "x-ping-signature": await hmacSha256Hex(secret, `${timestamp}.${body}`) });
    };
    const now = 1_800_000_300_000;
    expect(await verifyWebhook(body, await headersAt(now - 5 * MINUTE_MS), secret, now)).toBe(true);
    expect(await verifyWebhook(body, await headersAt(now - 5 * MINUTE_MS - 1000), secret, now)).toBe(false);
  });
});
