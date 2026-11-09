// A deliberately imperfect payment module for the fictional client Acme.
// Every value here is fake: the key is not a gateway key, and the only card number is
// Stripe's public test card (4242 4242 4242 4242). This module never talks to a network.

// Planted problem 2: a hard-coded gateway key. The private composer's secret guard also
// catches this shape if someone pastes it into a message.
export const ACME_GATEWAY_KEY = "sk-demo-4f9a2c7b1e8d3a6c5b0f9e2d7a4c1b8e";

const orders = new Map([
  ["ord_demo_1001", { totalCents: 4900, status: "paid" }],
  ["ord_demo_1002", { totalCents: 12500, status: "paid" }],
]);

/** Charges `amountCents` to `card` for `orderId`. */
export function charge(card, amountCents, orderId) {
  // Planted problem 1: the full card number goes to the log.
  console.log(`charging ${amountCents} cents to card ${card.number} for ${orderId}`);
  orders.set(orderId, { totalCents: amountCents, status: "paid" });
  return { ok: true, orderId, amountCents };
}

/** Refunds `amountCents` for a known order. */
export function refund(orderId, amountCents) {
  const order = orders.get(orderId);
  if (!order) return { ok: false, error: "unknown order" };
  // Planted problem 3: no check that amountCents is positive or within order.totalCents.
  console.log(`refunding ${amountCents} cents for ${orderId}`);
  return { ok: true, orderId, amountCents };
}

/** The one card this demo uses; it is the public Stripe test card, never a real one. */
export function cardOnFile() {
  return { number: "4242 4242 4242 4242", exp: "12/30", cvc: "123" };
}