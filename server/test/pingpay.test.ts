import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../src/crypto";
import { PingPayClient, PingPayError, verifyWebhook } from "../src/pingpay";

const BASE = "https://ping.test/api";
const KEY = "pk-test-secret";
const SECRET = "whsec-test";
const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;

type Call = { url: string; method: string; headers: Headers; body: unknown };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(route: (call: Call) => Response): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

const sessionInput = {
  amountUsdc: "5000000",
  recipient: "operator.near",
  customerReference: "device-1",
  topupId: "topup-1",
  successUrl: "https://example.test/paid",
  cancelUrl: "https://example.test/cancelled",
};

function createdSession(recipient = "operator.near") {
  return json({
    session: {
      sessionId: "cs_1",
      status: "CREATED",
      paymentId: null,
      amount: { assetId: "nep141:usdc.near", amount: "5000000" },
      recipient: { address: recipient },
      createdAt: "2027-01-15T08:00:00.000Z",
      expiresAt: "2027-01-15T08:15:00.000Z",
    },
    sessionUrl: "https://checkout.pingpay.test/session/cs_1",
  });
}

describe("PingPayClient", () => {
  it("creates a USDC on NEAR checkout session with the API key, the device and the top-up", async () => {
    const { fetcher, calls } = stubFetch(() => createdSession());
    const result = await new PingPayClient(`${BASE}/`, KEY, fetcher).createSession(sessionInput);
    expect(result).toEqual({
      sessionId: "cs_1",
      sessionUrl: "https://checkout.pingpay.test/session/cs_1",
      expiresAt: "2027-01-15T08:15:00.000Z",
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call).toMatchObject({ url: `${BASE}/checkout/sessions`, method: "POST" });
    expect(call.headers.get("x-api-key")).toBe(KEY);
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({
      amount: "5000000",
      asset: { chain: "NEAR", symbol: "USDC" },
      customerReference: "device-1",
      metadata: { topupId: "topup-1" },
      successUrl: "https://example.test/paid",
      cancelUrl: "https://example.test/cancelled",
    });
  });

  it("refuses a session that would pay another recipient", async () => {
    const { fetcher } = stubFetch(() => createdSession("someone-else.near"));
    await expect(new PingPayClient(BASE, KEY, fetcher).createSession(sessionInput)).rejects.toThrow(/recipient/);
  });

  it("refuses a session answer without a usable expiry", async () => {
    const { fetcher } = stubFetch(() =>
      json({ session: { sessionId: "cs_1", status: "CREATED", recipient: { address: "operator.near" } }, sessionUrl: "https://c.test/s" }),
    );
    await expect(new PingPayClient(BASE, KEY, fetcher).createSession(sessionInput)).rejects.toThrow(/expiresAt/);
  });

  it("reads a session's status and payment id", async () => {
    const { fetcher, calls } = stubFetch(() =>
      json({ session: { sessionId: "cs_1", status: "COMPLETED", paymentId: "pay_1", recipient: { address: "operator.near" } } }),
    );
    expect(await new PingPayClient(BASE, KEY, fetcher).getSession("cs_1")).toEqual({ status: "COMPLETED", paymentId: "pay_1" });
    expect(calls[0]).toMatchObject({ url: `${BASE}/checkout/sessions/cs_1`, method: "GET" });
    expect(calls[0]?.headers.get("x-api-key")).toBe(KEY);
  });

  it("reads a session without a payment yet", async () => {
    const { fetcher } = stubFetch(() => json({ session: { sessionId: "cs_1", status: "CREATED", paymentId: null } }));
    expect(await new PingPayClient(BASE, KEY, fetcher).getSession("cs_1")).toEqual({ status: "CREATED", paymentId: null });
  });

  it("rejects a session status it does not know", async () => {
    const { fetcher } = stubFetch(() => json({ session: { sessionId: "cs_1", status: "PAID", paymentId: null } }));
    await expect(new PingPayClient(BASE, KEY, fetcher).getSession("cs_1")).rejects.toThrow(/session/);
  });

  it("escapes the id in the path", async () => {
    const { fetcher, calls } = stubFetch(() => json({ payment: { paymentId: "x", status: "SUCCESS" } }));
    await new PingPayClient(BASE, KEY, fetcher).getPayment("../admin?x=1");
    expect(calls[0]?.url).toBe(`${BASE}/payments/..%2Fadmin%3Fx%3D1`);
  });

  it("reads a payment's status", async () => {
    const { fetcher, calls } = stubFetch(() => json({ payment: { paymentId: "pay_1", status: "SUCCESS" } }));
    expect(await new PingPayClient(BASE, KEY, fetcher).getPayment("pay_1")).toEqual({ status: "SUCCESS" });
    expect(calls[0]).toMatchObject({ url: `${BASE}/payments/pay_1`, method: "GET" });
  });

  it("throws a PingPayError with the status on a non-2xx answer, never naming the key", async () => {
    const { fetcher } = stubFetch(() => json({ code: "UNAUTHENTICATED", message: "Invalid key" }, 401));
    const failure = await new PingPayClient(BASE, KEY, fetcher).getSession("cs_1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PingPayError);
    expect(failure).toMatchObject({ status: 401 });
    expect(String((failure as Error).message)).not.toContain(KEY);
  });
});

describe("verifyWebhook", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", resourceId: "cs_1", data: {}, createdAt: "x" });

  async function signed(rawBody: string, at: number, secret = SECRET, unit: "s" | "ms" = "s"): Promise<Headers> {
    const timestamp = unit === "s" ? String(Math.floor(at / 1000)) : String(at);
    return new Headers({ "x-ping-timestamp": timestamp, "x-ping-signature": await hmacSha256Hex(secret, `${timestamp}.${rawBody}`) });
  }

  it("accepts a valid signature", async () => {
    expect(await verifyWebhook(body, await signed(body, NOW), SECRET, NOW)).toBe(true);
  });

  it("accepts a timestamp 4 minutes ahead", async () => {
    expect(await verifyWebhook(body, await signed(body, NOW + 4 * MINUTE_MS), SECRET, NOW)).toBe(true);
  });

  it("rejects a timestamp 6 minutes old", async () => {
    expect(await verifyWebhook(body, await signed(body, NOW - 6 * MINUTE_MS), SECRET, NOW)).toBe(false);
  });

  it("rejects a timestamp 6 minutes ahead", async () => {
    expect(await verifyWebhook(body, await signed(body, NOW + 6 * MINUTE_MS), SECRET, NOW)).toBe(false);
  });

  it("rejects a changed body", async () => {
    const headers = await signed(body, NOW);
    expect(await verifyWebhook(body.replace("cs_1", "cs_2"), headers, SECRET, NOW)).toBe(false);
  });

  it("rejects another secret's signature", async () => {
    expect(await verifyWebhook(body, await signed(body, NOW, "other"), SECRET, NOW)).toBe(false);
  });

  it("accepts a timestamp in milliseconds", async () => {
    expect(await verifyWebhook(body, await signed(body, NOW, SECRET, "ms"), SECRET, NOW)).toBe(true);
  });

  it("rejects missing headers, a non-numeric timestamp and an empty secret", async () => {
    expect(await verifyWebhook(body, new Headers(), SECRET, NOW)).toBe(false);
    const headers = await signed(body, NOW);
    headers.set("x-ping-timestamp", "soon");
    expect(await verifyWebhook(body, headers, SECRET, NOW)).toBe(false);
    expect(await verifyWebhook(body, await signed(body, NOW), "", NOW)).toBe(false);
  });
});
