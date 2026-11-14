/** Where a top-up is (spec 7.5). Status only ever moves forward; `credited` is final. */
export type TopupStatus = "created" | "paid" | "credited" | "expired" | "failed" | "paid_waiting_stock";

const MOVES: Record<TopupStatus, readonly TopupStatus[]> = {
  created: ["paid", "expired", "failed", "paid_waiting_stock"],
  // A late payment for an expired or cancelled checkout is never lost.
  expired: ["paid", "paid_waiting_stock"],
  paid_waiting_stock: ["paid"],
  paid: ["credited"],
  credited: [],
  failed: [],
};

export function canMove(from: TopupStatus, to: TopupStatus): boolean {
  return MOVES[from].includes(to);
}

/** What a PingPay session comes to; `retry` and `mismatch` change nothing and are tried again later. */
export type SessionOutcome = "paid" | "expired" | "nothing" | "retry" | "mismatch";
