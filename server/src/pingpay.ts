import { hmacSha256Hex, timingSafeEqual } from "./crypto";
import { UPSTREAM_TIMEOUT_MS } from "./http";

/**
 * The part of the PingPay API the credits server uses (hosted checkout and webhooks).
 *
 * Read on 2026-11-07 from the OpenAPI document at https://pay.pingpay.io/api/spec.json and the docs
 * at https://pingpay.gitbook.io/docs (Create Checkout, Webhooks):
 * - `POST /checkout/sessions` takes `amount` (base units, digits only) and `asset: { chain, symbol }`
 *   (both required), plus optional `successUrl`, `cancelUrl`, `metadata`, `customerReference`
 *   (`[a-zA-Z0-9_.:-]{1,128}`) and others. The request schema has **no `recipient` field**: the payee is
 *   the organization's Default Recipient Address set in the PingPay dashboard. (The docs' prose still
 *   lists `recipient` as required, and an older example sends `recipient: { address, chainId }`; the
 *   schema and PingPay's own example app, updated 2026-10-26, send none.) The answer is
 *   `{ session: { sessionId, status, paymentId, recipient: { address }, expiresAt?, ... }, sessionUrl }`,
 *   so the client checks `session.recipient.address` against the operator account instead of sending it.
 * - Requests carry the key in `x-api-key` (the Quick Start page names `x-publishable-key`; the
 *   Create Checkout page and the example app use `x-api-key`).
 * - A webhook body is `{ id, type, resourceId, data, createdAt }`; for `checkout.session.*` events
 *   `resourceId` is the checkout session id. It is signed with HMAC-SHA256 hex over
 *   `${x-ping-timestamp}.${rawBody}` in `x-ping-signature`. The docs do not give the timestamp's unit.
 */

const SESSION_STATUSES = ["CREATED", "PENDING", "COMPLETED", "EXPIRED", "CANCELLED"] as const;

/**
 * NEAR's native USDC as PingPay names a NEP-141 asset: `nep141:<token contract>`, the form PingPay's
 * docs show for wNEAR (`nep141:wrap.near`). The docs (read 2026-11-07) name no id for USDC; the
 * contract is Circle's native USDC on NEAR mainnet. Confirm it on the first live checkout.
 */
export const NEAR_USDC_ASSET_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_DECIMALS = 6;

/** What a session charges: `amount` base units of `assetId`. */
export type SessionAmount = { assetId: string; amount: string };
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** How far a webhook's timestamp may be from now, either way. */
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;
/** A timestamp below this is in seconds, above it in milliseconds (10^11 s is the year 5138). */
const SECONDS_LIMIT = 100_000_000_000;

/** A non-2xx answer from PingPay, or none in time (`status` 0). The message names the request, never the key. */
export class PingPayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PingPayError";
  }
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpected(what: string): never {
  throw new Error(`Unexpected PingPay response: ${what}`);
}

function sessionOf(body: unknown): Json {
  if (!isRecord(body) || !isRecord(body.session) || typeof body.session.sessionId !== "string") return unexpected("session");
  return body.session;
}

function amountOf(session: Json): SessionAmount {
  const { amount } = session;
  if (!isRecord(amount) || typeof amount.assetId !== "string" || typeof amount.amount !== "string" || !/^[0-9]+$/.test(amount.amount)) {
    return unexpected("session amount");
  }
  // `decimals` is optional in the schema; when given for NEAR USDC it must be USDC's.
  if (amount.assetId === NEAR_USDC_ASSET_ID && amount.decimals !== undefined && amount.decimals !== USDC_DECIMALS) {
    return unexpected("session amount decimals");
  }
  return { assetId: amount.assetId, amount: amount.amount };
}

/** Whether a session charges exactly `amountUsdc` base units of NEAR USDC. */
export function chargesUsdc(amount: SessionAmount, amountUsdc: string): boolean {
  return amount.assetId === NEAR_USDC_ASSET_ID && amount.amount === amountUsdc;
}

export class PingPayClient {
  private readonly base: string;

  constructor(
    base: string,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch,
    private readonly timeoutMs: number = UPSTREAM_TIMEOUT_MS,
  ) {
    this.base = base.replace(/\/+$/, "");
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "x-api-key": this.apiKey };
    if (body !== undefined) headers["content-type"] = "application/json";
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      text = await response.text();
    } catch (error) {
      if (signal.aborted) throw new PingPayError(0, `PingPay ${method} ${path} timed out after ${this.timeoutMs} ms`);
      throw error;
    }
    if (!response.ok) throw new PingPayError(response.status, `PingPay ${method} ${path} failed with ${response.status}`);
    try {
      return text === "" ? undefined : JSON.parse(text);
    } catch {
      return unexpected("body is not JSON");
    }
  }

  /**
   * A hosted checkout for `amountUsdc` USDC base units on NEAR. `recipient` is the account the money
   * must reach: PingPay takes the payee from the dashboard, so a session paying anyone else is refused,
   * as is one that charges another amount or asset.
   */
  async createSession(input: {
    amountUsdc: string;
    recipient: string;
    customerReference: string;
    topupId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; sessionUrl: string; expiresAt: string }> {
    const body = await this.request("POST", "/checkout/sessions", {
      amount: input.amountUsdc,
      asset: { chain: "NEAR", symbol: "USDC" },
      customerReference: input.customerReference,
      metadata: { topupId: input.topupId },
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    const session = sessionOf(body);
    const sessionUrl = isRecord(body) ? body.sessionUrl : undefined;
    if (typeof sessionUrl !== "string") return unexpected("sessionUrl");
    if (!isRecord(session.recipient) || session.recipient.address !== input.recipient) {
      return unexpected("session pays another recipient than the operator account");
    }
    if (!chargesUsdc(amountOf(session), input.amountUsdc)) return unexpected("session amount is not the requested USDC amount");
    const { expiresAt } = session;
    if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return unexpected("session expiresAt");
    return { sessionId: session.sessionId as string, sessionUrl, expiresAt };
  }

  async getSession(id: string): Promise<{ status: SessionStatus; paymentId: string | null; amount: SessionAmount }> {
    const session = sessionOf(await this.request("GET", `/checkout/sessions/${encodeURIComponent(id)}`));
    const status = SESSION_STATUSES.find((known) => known === session.status);
    if (status === undefined) return unexpected("session status");
    const { paymentId } = session;
    if (paymentId != null && typeof paymentId !== "string") return unexpected("session paymentId");
    return { status, paymentId: paymentId ?? null, amount: amountOf(session) };
  }

  /** A payment's status; it is final when `SUCCESS` or `FAILED`. */
  async getPayment(id: string): Promise<{ status: string }> {
    const body = await this.request("GET", `/payments/${encodeURIComponent(id)}`);
    if (!isRecord(body) || !isRecord(body.payment) || typeof body.payment.status !== "string") return unexpected("payment");
    return { status: body.payment.status };
  }
}

/** The timestamp header as epoch milliseconds; whole seconds and milliseconds are both read. */
function timestampMs(raw: string): number | null {
  if (!/^[0-9]{1,16}$/.test(raw)) return null;
  const value = Number(raw);
  return value < SECONDS_LIMIT ? value * 1000 : value;
}

/**
 * Whether a webhook was signed by PingPay with `secret` within 5 minutes of `now`. Run on the raw
 * body, before it is parsed. The signatures are compared in constant time.
 */
export async function verifyWebhook(rawBody: string, headers: Headers, secret: string, now: number): Promise<boolean> {
  const timestamp = headers.get("x-ping-timestamp");
  const signature = headers.get("x-ping-signature");
  if (secret === "" || timestamp === null || signature === null) return false;
  const at = timestampMs(timestamp);
  if (at === null || Math.abs(now - at) > WEBHOOK_TOLERANCE_MS) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(signature.toLowerCase(), expected);
}
