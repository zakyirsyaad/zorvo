import { useState, type ReactNode } from "react";
import type { ActionResult, OpenCheckoutResult, TopupFlow } from "../../hooks/usePrivateCredits";
import { mayStillBePaid } from "../../lib/private-flow";
import { formatCredits, privateErrorText } from "../../lib/private-credits";
import { Button } from "../ui/Button";

export interface TopupProgressProps {
  flow: TopupFlow;
  /** The balance after a credit, when known. */
  balanceCredits: number | null;
  onOpenCheckout: () => Promise<OpenCheckoutResult>;
  onCancel: () => Promise<ActionResult>;
  onDismiss: () => void;
}

const CANNOT_REOPEN =
  "Your checkout can't be reopened here. If its browser tab is still open, finish paying there, or cancel.";
const MAY_STILL_GO_THROUGH = "If you started a payment, it may still go through.";

interface View {
  title: string;
  body?: ReactNode;
}

/** The words for a flow state. `cannotReopen`: opening the checkout again found no address to open. */
function viewOf(flow: TopupFlow, balanceCredits: number | null, cannotReopen: boolean): View | null {
  switch (flow.kind) {
    case "idle":
      return null;
    case "opening":
      return { title: "Opening checkout in your browser", body: "Your credits are held for 25 minutes while you pay." };
    case "waiting":
      if (cannotReopen) return { title: "Waiting for your payment", body: CANNOT_REOPEN };
      if (flow.openFailed) return { title: "Checkout is ready", body: privateErrorText("open_failed") };
      return {
        title: "Waiting for your payment",
        body: `Your ${formatCredits(flow.topup.credits)} are held for 25 minutes while you pay.`,
      };
    case "paid":
      return {
        title: "Payment received",
        body: `Adding ${formatCredits(flow.topup.credits)} to this Mac. You don't need to do anything.`,
      };
    case "credited":
      return {
        title: `+${formatCredits(flow.credits)}`,
        body: balanceCredits === null ? undefined : `Balance ${formatCredits(balanceCredits)}`,
      };
    case "failed":
      return {
        title: "Your payment didn't go through",
        body: "No credits were added. If PingPay received part of it, PingPay handles the refund. You can try again, with another chain or a card.",
      };
    case "expired":
      return { title: "Checkout closed without paying", body: "Nothing was charged." };
    case "waiting-stock":
      return {
        title: "Paid. Credits come with the next restock",
        body: "The 25-minute hold ran out and the stock sold out meanwhile. Your payment counts, and you're first in line when stock comes back.",
      };
    case "error":
      return {
        title: "Your top-up stopped",
        body: (
          <>
            {privateErrorText(flow.code)}
            {mayStillBePaid(flow.code) && <span className="mt-1 block">{MAY_STILL_GO_THROUGH}</span>}
          </>
        ),
      };
  }
}

/**
 * Where a top-up stands, in place of the packages while one is created or followed. Its one
 * status region is always mounted, so each step is announced.
 */
export function TopupProgress({ flow, balanceCredits, onOpenCheckout, onCancel, onDismiss }: TopupProgressProps) {
  const [cannotReopen, setCannotReopen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [lastTopupId, setLastTopupId] = useState<string | null>(null);

  // A new top-up starts with a clean slate: what was true of the last one does not carry over.
  const topupId = "topup" in flow ? flow.topup.topupId : null;
  if (topupId !== lastTopupId) {
    setLastTopupId(topupId);
    setCannotReopen(false);
    setCancelError(null);
  }

  const view = viewOf(flow, balanceCredits, cannotReopen);

  const reopen = async () => {
    const result = await onOpenCheckout();
    // Only a missing address cannot be fixed by pressing again.
    if (!result.ok && result.code === "not_found") setCannotReopen(true);
  };

  const cancel = async () => {
    setIsCancelling(true);
    setCancelError(null);
    const result = await onCancel();
    setIsCancelling(false);
    if (!result.ok) setCancelError(result.text);
  };

  const isEnded = flow.kind === "credited" || flow.kind === "failed" || flow.kind === "expired" || flow.kind === "error";
  const canReopen = flow.kind === "waiting" && !cannotReopen;
  const canCancel = flow.kind === "opening" || flow.kind === "waiting";

  return (
    <div
      className={
        view ? "flex flex-col gap-3.5 rounded-xl border border-border bg-surface-1 p-4" : undefined
      }
    >
      <div role="status" className={view ? "flex flex-col gap-1" : "sr-only"}>
        {view && (
          <>
            <span className="text-ui font-semibold text-fg">{view.title}</span>
            {view.body && <span className="text-ui text-fg-muted">{view.body}</span>}
          </>
        )}
      </div>
      {cancelError && (
        <p role="alert" className="text-ui-sm text-danger">
          {cancelError}
        </p>
      )}
      {view && (canCancel || isEnded) && (
        <div className="flex justify-end gap-2">
          {canCancel && (
            <Button disabled={flow.kind === "opening" || isCancelling} onClick={() => void cancel()}>
              Cancel
            </Button>
          )}
          {canReopen && <Button onClick={() => void reopen()}>Open checkout again</Button>}
          {isEnded && (
            <Button variant="primary" onClick={onDismiss}>
              {flow.kind === "credited" ? "Done" : "Try again"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
