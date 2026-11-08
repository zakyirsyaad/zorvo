import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { hmacSha256Hex, randomSecret, sha256Hex } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { canMove, type TopupStatus } from "../src/ledger/status";
import { NEAR_USDC_ASSET_ID } from "../src/pingpay";
import { FakePingPay } from "./fakes";

const ledgerEnv = env as unknown as Env;
const cfg = parseConfig(ledgerEnv);
const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const USD = 1_000_000_000n;
const WEBHOOK_SECRET = "test-webhook-secret";

const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

let ping: FakePingPay;

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

/** Stock of exactly `credits` sellable credits. */
async function seedStock(credits: number, takenAt = NOW): Promise<void> {
  await stub().setSnapshot(cfg.stockBufferNano + (BigInt(credits) * USD) / 120n + 1_000_000n, 0n, takenAt);
}

function call(path: string, init: RequestInit & { secret?: string } = {}): Promise<Response> {
  const { secret, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (secret) headers.set("Authorization", `Bearer ${secret}`);
  return exports.default.fetch(new Request(`https://credits.test${path}`, { ...rest, headers }));
}

async function webhook(type: string, resourceId: string, id: string, secret = WEBHOOK_SECRET, at = Date.now()): Promise<Response> {
  const body = JSON.stringify({ id, type, resourceId, data: {}, createdAt: new Date(at).toISOString() });
  const timestamp = String(Math.floor(at / 1000));
  return call("/v1/webhooks/pingpay", {
    method: "POST",
    body,
    headers: { "x-ping-timestamp": timestamp, "x-ping-signature": await hmacSha256Hex(secret, `${timestamp}.${body}`) },
  });
}

/** A `payment.*` event, whose `data` may name the checkout session. */
async function paymentWebhook(type: string, resourceId: unknown, id: string, data: Record<string, unknown> = {}): Promise<Response> {
  const body = JSON.stringify({ id, type, resourceId, data, createdAt: new Date().toISOString() });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return call("/v1/webhooks/pingpay", {
    method: "POST",
    body,
    headers: { "x-ping-timestamp": timestamp, "x-ping-signature": await hmacSha256Hex(WEBHOOK_SECRET, `${timestamp}.${body}`) },
  });
}

type TopupRow = { id: string; status: TopupStatus; ping_session_id: string | null; ping_payment_id: string | null; reserved_until: number | null };

function rows() {
  return runInDurableObject(stub(), (_ledger, state) => ({
    topups: state.storage.sql.exec<TopupRow>("SELECT * FROM topups ORDER BY created_at, id").toArray(),
    reservations: state.storage.sql.exec<{ topup_id: string; expires_at: number }>("SELECT * FROM reservations").toArray(),
    queue: state.storage.sql.exec<{ kind: string; ref: string; attempts: number }>("SELECT * FROM queue").toArray(),
    events: state.storage.sql.exec<{ id: string }>("SELECT id FROM events").toArray(),
  }));
}

function topUp(secret: string, packageUsd: unknown): Promise<Response> {
  return call("/v1/topups", { method: "POST", secret, body: JSON.stringify({ packageUsd }) });
}

async function topUpOk(secret: string, packageUsd = 5): Promise<{ topupId: string; sessionUrl: string; expiresAt: string; sessionId: string }> {
  const res = await topUp(secret, packageUsd);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { topupId: string; sessionUrl: string; expiresAt: string };
  return { ...body, sessionId: body.sessionUrl.split("/").pop()! };
}

async function statusOf(secret: string, topupId: string): Promise<{ status: string; credits: number }> {
  const res = await call(`/v1/topups/${topupId}`, { secret });
  expect(res.status).toBe(200);
  return (await res.json()) as { status: string; credits: number };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // The Ledger logs PingPay failures; a test that expects one asserts on this spy, the rest stay quiet.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  ping = new FakePingPay();
  await runInDurableObject(stub(), (ledger: Ledger, state) => {
    for (const table of ["snapshot", "reservations", "topups", "queue", "events"]) state.storage.sql.exec(`DELETE FROM ${table}`);
    ledger.fetcher = ping.fetcher;
  });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("canMove", () => {
  const all: TopupStatus[] = ["created", "paid", "credited", "expired", "failed", "paid_waiting_stock"];
  const allowed = new Set([
    "created>paid",
    "created>expired",
    "created>failed",
    "created>paid_waiting_stock",
    "expired>paid",
    "expired>paid_waiting_stock",
    "paid_waiting_stock>paid",
    "paid>credited",
  ]);

  it("allows exactly the forward moves of spec 7.5", () => {
    for (const from of all) {
      for (const to of all) expect([from, to, canMove(from, to)]).toEqual([from, to, allowed.has(`${from}>${to}`)]);
    }
  });
});

describe("POST /v1/topups", () => {
  it("answers 401 without a device", async () => {
    expect((await call("/v1/topups", { method: "POST", body: JSON.stringify({ packageUsd: 5 }) })).status).toBe(401);
  });

  it.each([["an unknown package", 7], ["a string", "5"], ["nothing", undefined]])("answers 400 for %s", async (_name, packageUsd) => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const res = await topUp(secret, packageUsd);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(ping.calls).toHaveLength(0);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const { secret } = await newDevice();
    const res = await call("/v1/topups", { method: "POST", secret, body: "{" });
    expect(res.status).toBe(400);
  });

  it("answers 409 stock without creating a checkout", async () => {
    await seedStock(400, Date.now());
    const { secret } = await newDevice();
    const res = await topUp(secret, 5);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stock" });
    expect(ping.calls).toHaveLength(0);
  });

  it("answers 429 rate_limited to the 11th top-up of a device in an hour, and still cancels", async () => {
    await seedStock(100_000, Date.now());
    const { secret } = await newDevice();
    const first = await topUpOk(secret);
    for (let i = 1; i < 10; i += 1) await topUpOk(secret);
    const res = await topUp(secret, 5);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect((await call(`/v1/topups/${first.topupId}/cancel`, { method: "POST", secret })).status).toBe(200);
    expect(ping.calls.filter((c) => c.method === "POST")).toHaveLength(10);
  });

  it("answers 409 device_cap for a device at its cap", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice(4800);
    const res = await topUp(secret, 5);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "device_cap" });
  });

  it("creates a checkout for the operator and holds the stock until the session expires plus 10 minutes", async () => {
    await seedStock(10_000, Date.now());
    const { deviceId, secret } = await newDevice();
    const { topupId, sessionUrl, expiresAt, sessionId } = await topUpOk(secret, 5);
    expect(sessionUrl).toBe(`https://checkout.pingpay.test/session/${sessionId}`);

    const sent = ping.sessions.get(sessionId)?.body;
    expect(sent).toMatchObject({
      amount: "5000000",
      asset: { chain: "NEAR", symbol: "USDC" },
      customerReference: deviceId,
      metadata: { topupId },
    });
    expect(ping.calls[0]?.apiKey).toBe("test-pingpay-key");

    const until = Date.parse(expiresAt) + 10 * MINUTE_MS;
    const { topups, reservations } = await rows();
    expect(topups).toEqual([expect.objectContaining({ id: topupId, status: "created", ping_session_id: sessionId, reserved_until: until })]);
    expect(reservations).toEqual([expect.objectContaining({ topup_id: topupId, expires_at: until })]);
    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
  });

  it("holds the stock at most an hour plus the grace when PingPay's checkout lives longer", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice();
    ping.expiresAt = () => NOW + 30 * 24 * 60 * MINUTE_MS;
    const created = await stub().createTopup(deviceId, 5, NOW);
    if ("error" in created) throw new Error(`could not create a top-up: ${created.error}`);
    const { topups, reservations } = await rows();
    expect(topups).toEqual([expect.objectContaining({ id: created.topupId, reserved_until: NOW + 70 * MINUTE_MS })]);
    expect(reservations).toEqual([expect.objectContaining({ topup_id: created.topupId, expires_at: NOW + 70 * MINUTE_MS })]);
  });

  it("answers 502 upstream when PingPay's session charges another amount or asset, releasing the stock", async () => {
    await seedStock(500, Date.now());
    const { deviceId, secret } = await newDevice();
    ping.answerAmount = () => ({ assetId: NEAR_USDC_ASSET_ID, amount: "50000" });
    expect((await topUp(secret, 5)).status).toBe(502);
    ping.answerAmount = (requested) => ({ assetId: "nep141:wrap.near", amount: requested });
    expect((await topUp(secret, 5)).status).toBe(502);

    const { topups, reservations } = await rows();
    expect(topups.map((t) => t.status)).toEqual(["failed", "failed"]);
    expect(reservations).toEqual([]);
    expect((await stub().stockFor(deviceId)).availableCredits).toBe(500);
  });

  it("answers 502 upstream when PingPay fails, releasing the stock and failing the top-up", async () => {
    await seedStock(500, Date.now());
    const { deviceId, secret } = await newDevice();
    ping.failCreate = true;
    const res = await topUp(secret, 5);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream" });

    const { topups, reservations } = await rows();
    expect(topups).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(reservations).toEqual([]);
    expect((await stub().stockFor(deviceId)).availableCredits).toBe(500);
  });
});

describe("GET /v1/topups/:id", () => {
  it("answers 404 for another device's top-up and for an unknown id", async () => {
    await seedStock(10_000, Date.now());
    const owner = await newDevice();
    const other = await newDevice();
    const { topupId } = await topUpOk(owner.secret);
    expect((await call(`/v1/topups/${topupId}`, { secret: other.secret })).status).toBe(404);
    expect((await call(`/v1/topups/${crypto.randomUUID()}`, { secret: owner.secret })).status).toBe(404);
    expect((await call(`/v1/topups/${topupId}`)).status).toBe(401);
  });
});

describe("POST /v1/webhooks/pingpay", () => {
  it("marks a completed, successful checkout paid and queues one credit", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);

    const res = await webhook("checkout.session.completed", sessionId, "evt_1");
    expect(res.status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });

    const { topups, queue } = await rows();
    expect(topups[0]?.ping_payment_id).toBe(`pay_${sessionId}`);
    expect(queue).toEqual([expect.objectContaining({ kind: "credit", ref: topupId, attempts: 0 })]);
  });

  it("keeps a paid top-up's stock held until it is credited", async () => {
    await seedStock(500, Date.now());
    const buyer = await newDevice();
    const { sessionId } = await topUpOk(buyer.secret);
    ping.pay(sessionId);
    await webhook("checkout.session.completed", sessionId, "evt_1");
    const later = Date.now() + 60 * MINUTE_MS;
    expect((await stub().stockFor(buyer.deviceId, later)).availableCredits).toBe(0);
  });

  it("race 4: the same event twice queues one credit, and a later expiry leaves it paid", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);

    const [first, second] = await Promise.all([
      webhook("checkout.session.completed", sessionId, "evt_dup"),
      webhook("checkout.session.completed", sessionId, "evt_dup"),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await webhook("checkout.session.completed", sessionId, "evt_dup")).status).toBe(200);

    ping.expire(sessionId);
    expect((await webhook("checkout.session.expired", sessionId, "evt_exp")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
    const { queue, events } = await rows();
    expect(queue).toHaveLength(1);
    expect(events.map((e) => e.id).sort()).toEqual(["evt_dup", "evt_exp"]);
  });

  it("expires a checkout that PingPay reports expired and gives its stock back", async () => {
    await seedStock(500, Date.now());
    const { deviceId, secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.expire(sessionId);
    expect((await webhook("checkout.session.expired", sessionId, "evt_1")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "expired", credits: 500 });
    expect((await rows()).reservations).toEqual([]);
    expect((await stub().stockFor(deviceId)).availableCredits).toBe(500);
  });

  it("a failed payment changes nothing, and a later success in the same session pays", async () => {
    await seedStock(500, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId, "FAILED");
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
    const afterFailure = await rows();
    expect(afterFailure.reservations).toHaveLength(1);
    expect(afterFailure.queue).toEqual([]);
    expect(afterFailure.events.map((e) => e.id)).toEqual(["evt_1"]);

    ping.pay(sessionId, "SUCCESS");
    expect((await webhook("checkout.session.completed", sessionId, "evt_2")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
    expect((await rows()).queue).toHaveLength(1);
  });

  it("a cancelled top-up whose payment failed stays expired and still ends paid on a later success", async () => {
    await seedStock(500, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    await call(`/v1/topups/${topupId}/cancel`, { method: "POST", secret });
    ping.pay(sessionId, "FAILED");
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "expired", credits: 500 });

    ping.pay(sessionId, "SUCCESS");
    expect((await webhook("checkout.session.completed", sessionId, "evt_2")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
  });

  it.each([
    ["is still processing", "PROCESSING"],
    ["is pending", "PENDING"],
    ["has an incomplete deposit", "INCOMPLETE_DEPOSIT"],
  ])("asks for a redelivery while the payment %s, then pays exactly once", async (_name, paymentStatus) => {
    await seedStock(500, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    await call(`/v1/topups/${topupId}/cancel`, { method: "POST", secret });
    ping.pay(sessionId, paymentStatus);
    const early = await webhook("checkout.session.completed", sessionId, "evt_1");
    expect(early.status).toBe(503);
    expect(await early.json()).toEqual({ error: "upstream" });
    expect(await statusOf(secret, topupId)).toEqual({ status: "expired", credits: 500 });
    expect((await rows()).events).toEqual([]);

    ping.pay(sessionId, "SUCCESS");
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(200);
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
    const { queue, events } = await rows();
    expect(queue).toEqual([expect.objectContaining({ kind: "credit", ref: topupId })]);
    expect(events.map((e) => e.id)).toEqual(["evt_1"]);
  });

  it("asks for a redelivery while a completed session has no payment yet", async () => {
    await seedStock(500, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.completeWithoutPayment(sessionId);
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(503);
    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
    expect((await rows()).events).toEqual([]);
  });

  it.each([
    ["another amount", { assetId: NEAR_USDC_ASSET_ID, amount: "1000000" }],
    ["another asset", { assetId: "nep141:wrap.near", amount: "5000000" }],
  ])("neither credits nor drops a successful payment of %s, and logs it", async (_name, amount) => {
    await seedStock(500, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);
    ping.restate(sessionId, amount);
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(503);
    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
    const { queue, events, reservations } = await rows();
    expect([queue, events]).toEqual([[], []]);
    expect(reservations).toHaveLength(1);
    const logged = consoleError.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
    expect(logged).toContain(topupId);
    expect(logged).toContain("5000000");
    expect(logged).toContain(String(amount.amount));
    expect(logged).not.toContain("test-pingpay-key");
  });

  it("answers 401 to a bad or stale signature and changes nothing", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);
    const readsBefore = ping.calls.length;

    const forged = await webhook("checkout.session.completed", sessionId, "evt_1", "wrong-secret");
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "unauthorized" });
    const stale = await webhook("checkout.session.completed", sessionId, "evt_2", WEBHOOK_SECRET, Date.now() - 6 * MINUTE_MS);
    expect(stale.status).toBe(401);
    const unsigned = await call("/v1/webhooks/pingpay", { method: "POST", body: "{" });
    expect(unsigned.status).toBe(401);

    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
    const { queue, events } = await rows();
    expect([queue, events]).toEqual([[], []]);
    expect(ping.calls).toHaveLength(readsBefore);
  });

  it("answers 200 to event types it does not act on", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);
    const readsBefore = ping.calls.length;
    expect((await webhook("invoice.paid", "in_1", "evt_1")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
    expect(ping.calls).toHaveLength(readsBefore);
  });

  it.each([
    { where: "resourceId", payload: (sessionId: string) => ({ resourceId: sessionId, data: {} }) },
    { where: "data.checkoutSessionId", payload: (sessionId: string) => ({ resourceId: "pay_1", data: { checkoutSessionId: sessionId } }) },
    { where: "data.sessionId", payload: (sessionId: string) => ({ resourceId: "pay_2", data: { sessionId } }) },
    { where: "data.checkoutSession.id", payload: (sessionId: string) => ({ resourceId: "pay_3", data: { checkoutSession: { id: sessionId } } }) },
  ])("credits a payment.success that names the session in $where", async ({ payload }) => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);
    const { resourceId, data } = payload(sessionId);

    expect((await paymentWebhook("payment.success", resourceId, "evt_pay", data)).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
    expect((await rows()).queue).toEqual([expect.objectContaining({ kind: "credit", ref: topupId })]);
  });

  it("answers 200 to a payment event that names no top-up and logs only data key names", async () => {
    const res = await paymentWebhook("payment.success", "pay_unknown", "evt_unknown", {
      checkoutSessionId: "cs_unknown",
      customerEmail: "buyer@example.test",
    });

    expect(res.status).toBe(200);
    expect((await rows()).events).toEqual([]);
    expect((await rows()).queue).toEqual([]);
    expect(ping.calls).toHaveLength(0);
    const logged = consoleError.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
    expect(logged).toContain("payment.success");
    expect(logged).toContain("checkoutSessionId");
    expect(logged).toContain("customerEmail");
    expect(logged).not.toContain("pay_unknown");
    expect(logged).not.toContain("cs_unknown");
    expect(logged).not.toContain("buyer@example.test");
  });

  it("records a payment event id once and does nothing on a duplicate", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);

    expect((await paymentWebhook("payment.success", sessionId, "evt_pay_dup", {})).status).toBe(200);
    expect((await paymentWebhook("payment.success", sessionId, "evt_pay_dup", {})).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
    const { queue, events } = await rows();
    expect(queue).toHaveLength(1);
    expect(events.map((e) => e.id)).toEqual(["evt_pay_dup"]);
  });

  it("answers 200 to payment.failed on an open checkout and leaves its expiry to polling", async () => {
    await seedStock(500, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);

    expect((await paymentWebhook("payment.failed", sessionId, "evt_fail", {})).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "created", credits: 500 });
    expect((await rows()).events).toEqual([]);
    expect((await rows()).queue).toEqual([]);
  });

  it("expires a top-up on payment.failed when PingPay reports the session expired", async () => {
    await seedStock(500, Date.now());
    const { deviceId, secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.expire(sessionId);

    expect((await paymentWebhook("payment.failed", sessionId, "evt_fail_exp", {})).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "expired", credits: 500 });
    expect((await rows()).reservations).toEqual([]);
    expect((await stub().stockFor(deviceId)).availableCredits).toBe(500);
  });

  it("answers 200 to a session that is not one of ours", async () => {
    expect((await webhook("checkout.session.completed", "cs_unknown", "evt_1")).status).toBe(200);
    expect(ping.calls).toHaveLength(0);
  });

  it("answers 400 to a signed body that is not an event", async () => {
    const at = Date.now();
    const body = JSON.stringify({ hello: "world" });
    const timestamp = String(Math.floor(at / 1000));
    const res = await call("/v1/webhooks/pingpay", {
      method: "POST",
      body,
      headers: { "x-ping-timestamp": timestamp, "x-ping-signature": await hmacSha256Hex(WEBHOOK_SECRET, `${timestamp}.${body}`) },
    });
    expect(res.status).toBe(400);
  });

  it("answers 502 when PingPay cannot be read, without recording the event, so a redelivery is handled", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);
    ping.failReads = true;
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(502);
    expect((await rows()).events).toEqual([]);
    const logged = consoleError.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
    expect(logged).toContain("PingPayError");
    expect(logged).toContain("503");
    expect(logged).not.toContain("test-pingpay-key");

    ping.failReads = false;
    expect((await webhook("checkout.session.completed", sessionId, "evt_1")).status).toBe(200);
    expect(await statusOf(secret, topupId)).toEqual({ status: "paid", credits: 500 });
  });
});

describe("POST /v1/topups/:id/cancel", () => {
  it("expires a created top-up, gives the stock back, and a payment that still arrives is not lost", async () => {
    await seedStock(500, Date.now());
    const { deviceId, secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);

    const res = await call(`/v1/topups/${topupId}/cancel`, { method: "POST", secret });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "expired", credits: 500 });
    expect((await rows()).reservations).toEqual([]);
    expect((await stub().stockFor(deviceId)).availableCredits).toBe(500);

    ping.pay(sessionId);
    await webhook("checkout.session.completed", sessionId, "evt_late");
    const { status } = await statusOf(secret, topupId);
    expect(["paid", "paid_waiting_stock"]).toContain(status);
    // The stock still covered it, so it is paid, held and queued.
    expect(status).toBe("paid");
    expect((await rows()).queue).toEqual([expect.objectContaining({ kind: "credit", ref: topupId })]);
    expect((await stub().stockFor(deviceId)).availableCredits).toBe(0);
  });

  it("answers 404 for another device's top-up and leaves it alone", async () => {
    await seedStock(10_000, Date.now());
    const owner = await newDevice();
    const other = await newDevice();
    const { topupId } = await topUpOk(owner.secret);
    expect((await call(`/v1/topups/${topupId}/cancel`, { method: "POST", secret: other.secret })).status).toBe(404);
    expect(await statusOf(owner.secret, topupId)).toEqual({ status: "created", credits: 500 });
  });

  it("leaves a top-up that is no longer created unchanged", async () => {
    await seedStock(10_000, Date.now());
    const { secret } = await newDevice();
    const { topupId, sessionId } = await topUpOk(secret);
    ping.pay(sessionId);
    await webhook("checkout.session.completed", sessionId, "evt_1");
    const res = await call(`/v1/topups/${topupId}/cancel`, { method: "POST", secret });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "paid", credits: 500 });
    expect((await rows()).reservations).toHaveLength(1);
  });
});

describe("Ledger.onSessionEvent", () => {
  it("race 3: a payment after the hold expired and the stock was sold waits for stock, with no credit queued", async () => {
    await seedStock(500);
    const late = await newDevice();
    const quick = await newDevice();
    ping.expiresAt = () => NOW + 15 * MINUTE_MS;
    const first = await stub().createTopup(late.deviceId, 5, NOW);
    if (!("topupId" in first)) throw new Error("expected a top-up");
    const sessionId = first.sessionUrl.split("/").pop()!;

    // The hold ends at NOW + 25 min; the stock then goes to another device. The same snapshot is
    // taken again then, since a top-up is not sold from a snapshot older than 10 minutes.
    const afterHold = NOW + 26 * MINUTE_MS;
    ping.expiresAt = () => afterHold + 15 * MINUTE_MS;
    await seedStock(500, afterHold);
    expect(await stub().createTopup(quick.deviceId, 5, afterHold)).toEqual(expect.objectContaining({ topupId: expect.any(String) }));

    ping.pay(sessionId);
    await stub().onSessionEvent(sessionId, "evt_late", afterHold + MINUTE_MS);
    const { topups, queue } = await rows();
    expect(topups.find((t) => t.id === first.topupId)?.status).toBe("paid_waiting_stock");
    expect(queue).toEqual([]);
  });

  it("leaves a top-up waiting for stock to the FIFO promotion, even when stock returns before a redelivery", async () => {
    await seedStock(500);
    const late = await newDevice();
    const quick = await newDevice();
    ping.expiresAt = () => NOW + 15 * MINUTE_MS;
    const first = await stub().createTopup(late.deviceId, 5, NOW);
    if (!("topupId" in first)) throw new Error("expected a top-up");
    const sessionId = first.sessionUrl.split("/").pop()!;
    const afterHold = NOW + 26 * MINUTE_MS;
    ping.expiresAt = () => afterHold + 15 * MINUTE_MS;
    await seedStock(500, afterHold);
    await stub().createTopup(quick.deviceId, 5, afterHold);
    ping.pay(sessionId);
    await stub().onSessionEvent(sessionId, "evt_1", afterHold);

    await seedStock(5000, afterHold);
    await stub().onSessionEvent(sessionId, "evt_2", afterHold);
    const { topups, queue } = await rows();
    expect(topups.find((t) => t.id === first.topupId)?.status).toBe("paid_waiting_stock");
    expect(queue).toEqual([]);
  });

  it("does not record an event whose session could not be read", async () => {
    await seedStock(500);
    const { deviceId } = await newDevice();
    const created = await stub().createTopup(deviceId, 5, NOW);
    if (!("topupId" in created)) throw new Error("expected a top-up");
    ping.failReads = true;
    // Called inside the object: a throw over RPC is also reported as an unhandled rejection by the test pool.
    await runInDurableObject(stub(), async (ledger: Ledger) => {
      await expect(ledger.onSessionEvent(created.sessionUrl.split("/").pop()!, "evt_1", NOW)).rejects.toThrow();
    });
    expect((await rows()).events).toEqual([]);
  });

  it("re-reads the session from PingPay when there is no event id", async () => {
    await seedStock(500);
    const { deviceId } = await newDevice();
    const created = await stub().createTopup(deviceId, 5, NOW);
    if (!("topupId" in created)) throw new Error("expected a top-up");
    const sessionId = created.sessionUrl.split("/").pop()!;
    ping.pay(sessionId);
    await stub().onSessionEvent(sessionId, null, NOW + MINUTE_MS);
    const { topups, events } = await rows();
    expect(topups[0]?.status).toBe("paid");
    expect(events).toEqual([]);
  });
});

describe("device cap with a waiting top-up", () => {
  it("counts the device's own paid_waiting_stock credits against its room", async () => {
    await seedStock(10_000);
    const { deviceId } = await newDevice(2500);
    await runInDurableObject(stub(), (_ledger, state) => {
      state.storage.sql.exec(
        `INSERT INTO topups (id, device_id, package_usd, credits, status, created_at, updated_at)
         VALUES (?, ?, 25, 2500, 'paid_waiting_stock', ?, ?)`,
        crypto.randomUUID(),
        deviceId,
        NOW,
        NOW,
      );
    });
    const view = await stub().stockFor(deviceId, NOW);
    expect(view.yourRoomCredits).toBe(0);
    expect(view.packages.every((p) => p.reason === "device_cap")).toBe(true);
    expect(await stub().reserve(deviceId, 500, 5, NOW)).toEqual({ error: "device_cap" });
  });
});

describe("schema indexes", () => {
  it("refuses a second top-up with the same PingPay session but allows many without one", async () => {
    await runInDurableObject(stub(), (_ledger, state) => {
      const insert = (id: string, session: string | null) =>
        state.storage.sql.exec(
          `INSERT INTO topups (id, device_id, package_usd, credits, status, ping_session_id, created_at, updated_at)
           VALUES (?, 'd-1', 5, 500, 'created', ?, ?, ?)`,
          id,
          session,
          NOW,
          NOW,
        );
      insert("t-1", "cs_same");
      expect(() => insert("t-2", "cs_same")).toThrow();
      insert("t-3", null);
      insert("t-4", null);
      const indexes = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('topups_session', 'queue_kind_ref') ORDER BY name")
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual(["queue_kind_ref", "topups_session"]);
    });
  });
});
