import { chargesUsdc, type PingPayClient } from "../pingpay";
import { MINUTE_MS } from "../time";
import type { SessionOutcome } from "./status";

/**
 * A top-up's PingPay checkout as the Ledger sees it (spec 7.5): how long its stock is held, and what
 * a session read back from PingPay comes to.
 */

/** How long `reserve` holds credits until `createTopup` sets the hold from the checkout's expiry. */
export const RESERVATION_MS = 30 * MINUTE_MS;
/** A reservation outlives its checkout session by this much, for a payment that lands at the last moment. */
export const RESERVATION_GRACE_MS = 10 * MINUTE_MS;
/** A checkout counts as open at most this long, whatever expiry PingPay states; the grace comes on top. */
const CHECKOUT_MAX_MS = 60 * MINUTE_MS;
/** The session lifetime assumed when PingPay's answer states no usable expiry (its docs give none). */
const ASSUMED_CHECKOUT_MS = 30 * MINUTE_MS;
/** Payment statuses that are final without the money arriving. They change nothing: the payer may retry in the same session. */
const FINAL_UNPAID = new Set(["FAILED", "REFUNDED"]);

/**
 * The expiry the app is told and the hold that goes with it: the session's own expiry, or 30
 * minutes from now when PingPay stated none; never more than an hour away; plus the grace.
 */
export function checkoutWindow(expiresAt: string | null, now: number): { expiresAt: string; reservedUntil: number } {
  const stated = expiresAt === null ? Number.NaN : Date.parse(expiresAt);
  const until = Number.isFinite(stated) ? Math.min(stated, now + CHECKOUT_MAX_MS) : now + ASSUMED_CHECKOUT_MS;
  return {
    expiresAt: expiresAt !== null && Number.isFinite(stated) ? expiresAt : new Date(until).toISOString(),
    reservedUntil: until + RESERVATION_GRACE_MS,
  };
}

/** Reads a session and its payment from PingPay and says what they come to for this top-up. */
export async function readSession(
  client: PingPayClient,
  topupId: string,
  amountUsdc: string,
  sessionId: string,
): Promise<{ kind: "paid"; paymentId: string } | { kind: Exclude<SessionOutcome, "paid"> }> {
  const session = await client.getSession(sessionId);
  if (session.status === "EXPIRED" || session.status === "CANCELLED") return { kind: "expired" };
  if (session.status !== "COMPLETED" || session.paymentId === null || session.amount === null) return { kind: "retry" };

  const payment = await client.getPayment(session.paymentId);
  if (FINAL_UNPAID.has(payment.status)) return { kind: "nothing" };
  if (payment.status !== "SUCCESS") return { kind: "retry" };
  if (!chargesUsdc(session.amount, amountUsdc)) {
    console.error(
      `PingPay session for top-up ${topupId} charged ${session.amount.amount} of ${session.amount.assetId}, expected ${amountUsdc} USDC; not credited`,
    );
    return { kind: "mismatch" };
  }
  return { kind: "paid", paymentId: session.paymentId };
}
