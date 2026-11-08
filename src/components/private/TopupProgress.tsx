import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { ActionResult, OpenCheckoutResult, TopupFlow } from "../../hooks/usePrivateCredits";
import { mayStillBePaid, topupErrorText } from "../../lib/private-flow";
import { formatCredits } from "../../lib/private-credits";
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
  status?: { text: string; tone?: "run" | "attn"; spinner?: boolean };
  footer?: string;
  primaryLabel?: string;
}

function StatusLine({ status }: { status: NonNullable<View["status"]> }) {
  return (
    <span className="flex items-center gap-2 text-ui-sm text-fg-secondary">
      {status.spinner ? (
        <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin" />
      ) : (
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${
            status.tone === "attn" ? "bg-status-attention" : "bg-status-running"
          }`}
        />
      )}
      {status.text}
    </span>
  );
}

/** The words for a flow state. `cannotReopen`: opening the checkout again found no address to open. */
function viewOf(flow: TopupFlow, balanceCredits: number | null, cannotReopen: boolean): View | null {
  switch (flow.kind) {
    case "idle":
      return null;
    case "opening":
      return {
        title: "Opening checkout in your browser",
        body: `Your ${formatCredits(flow.usd * 100)} are held for 25 minutes while you pay.`,
        status: { text: "Waiting for your payment", spinner: true },
        footer: "Browser didn't open? Open checkout again.",
      };
    case "waiting":
      if (cannotReopen) return { title: "Waiting for your payment", body: CANNOT_REOPEN };
      if (flow.openFailed) {
        return {
          title: "Couldn't open checkout",
          body: "PingPay didn't answer. Nothing was held or charged.",
          status: { text: "Waiting for your payment", tone: "attn" },
        };
      }
      return {
        title: "Waiting for your payment",
        body: `Your ${formatCredits(flow.topup.credits)} are held for 25 minutes while you pay.`,
        status: {
          text: `Checking with PingPay · ${formatCredits(flow.topup.credits)} held for you for 25 min`,
          spinner: true,
        },
      };
    case "paid":
      return {
        title: "Payment received",
        body: `Adding ${formatCredits(flow.topup.credits)} to this Mac. You don't need to do anything.`,
        status: { text: "Paid · adding credits" },
        footer:
          "You can close the browser tab. Zorvo hears about the payment from PingPay, and checks again every 2 minutes in case that message is late.",
      };
    case "credited":
      return {
        title: `+${formatCredits(flow.credits)}`,
        body: balanceCredits === null ? undefined : `Balance ${formatCredits(balanceCredits)}`,
        footer:
          "Private sessions use the new credits at once. A notification says so if Zorvo is in the background.",
        primaryLabel: "Start a private session",
      };
    case "failed":
      return {
        title: "Your payment didn't go through",
        body: "No credits were added. If PingPay received part of it, PingPay handles the refund. You can try again, with another chain or a card.",
      };
    case "expired":
      return {
        title: "Checkout closed without paying",
        body: "Nothing was charged. Cancel releases the held credits at once; otherwise they're released after 25 minutes.",
      };
    case "waiting-stock":
      return {
        title: "Paid. Credits come with the next restock",
        body: "The 25-minute hold ran out and the stock sold out meanwhile. Your payment counts, and you're first in line when stock comes back.",
        status: { text: "Payment received · first in line" },
      };
    case "error":
      if (flow.code === "stock") {
        return {
          title: "Top-ups are paused for now",
          body: `Zorvo has sold the credits it has right now. New stock comes in soon, and nobody is charged in the meantime.${
            balanceCredits === null ? "" : ` Your ${formatCredits(balanceCredits)} still work.`
          }`,
        };
      }
      if (flow.code === "open_failed") {
        return {
          title: "Couldn't open checkout",
          body: "PingPay didn't answer. Nothing was held or charged.",
        };
      }
      return {
        title: "Your top-up stopped",
        body: (
          <>
            {topupErrorText(flow.code)}
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
  const [isReopening, setIsReopening] = useState(false);
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
    // One open at a time: a second press while the first is on its way would open a second tab.
    if (isReopening) return;
    setIsReopening(true);
    try {
      const result = await onOpenCheckout();
      // Only a missing address cannot be fixed by pressing again.
      if (!result.ok && result.code === "not_found") setCannotReopen(true);
    } finally {
      setIsReopening(false);
    }
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
            {view.status && <StatusLine status={view.status} />}
          </>
        )}
      </div>
      {view?.footer && <p className="text-ui-sm text-fg-subtle">{view.footer}</p>}
      {cancelError && (
        <p role="alert" className="text-ui-sm text-danger">
          {cancelError}
        </p>
      )}
      {view && (canCancel || isEnded) && (
        <div className="flex justify-end gap-2">
          {canCancel && (
            <Button
              variant="ghost"
              tone="secondary"
              disabled={flow.kind === "opening" || isCancelling}
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          )}
          {canReopen && (
            <Button disabled={isReopening} onClick={() => void reopen()}>
              Open checkout again
            </Button>
          )}
          {isEnded && (
            <Button variant="primary" onClick={onDismiss}>
              {flow.kind === "credited" ? view?.primaryLabel ?? "Done" : "Try again"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
