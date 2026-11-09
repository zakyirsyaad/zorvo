import {
  formatCredits,
  modelLabel,
  turnsFor,
  type ModelPrice,
} from "../../lib/private-credits";
import { escapeVisible } from "../../lib/visible-text";
import type { PrivateTopupRequest } from "../../lib/private-topup-request";
import { BlockerCard } from "../ui/BlockerCard";
import { Button } from "../ui/Button";

export interface PrivateTopupRequestCardProps {
  request: PrivateTopupRequest;
  /** The session's model, when its price is known: draws the approximate turns. */
  model?: ModelPrice;
  /** The answer command or the checkout is on its way. */
  isBusy?: boolean;
  /** Another top-up is already open; this card can wait but not start a second one. */
  canTopUp?: boolean;
  onTopUp: () => void;
  onNotNow: () => void;
}

/**
 * An agent's ask, above the composer. It only asks: the user's click starts the existing PingPay
 * top-up; the card never opens checkout by itself and the agent never sees a key.
 */
export function PrivateTopupRequestCard({
  request,
  model,
  isBusy = false,
  canTopUp = true,
  onTopUp,
  onNotNow,
}: PrivateTopupRequestCardProps) {
  const turns = model ? turnsFor(request.credits, model) : 0;
  const line = `${formatCredits(request.credits)}${
    model && turns > 0 ? ` · about ${turns.toLocaleString("en-US")} turns on ${modelLabel(model.id)}` : ""
  }`;
  return (
    <BlockerCard
      label="Top-up request"
      profileId="qwen-code"
      title={`Qwen Code asks to top up $${request.usd}`}
      actions={
        <>
          <Button variant="ghost" tone="secondary" disabled={isBusy} onClick={onNotNow}>
            Not now
          </Button>
          <Button variant="primary" disabled={isBusy || !canTopUp} onClick={onTopUp}>
            {isBusy ? "Opening…" : `Top up $${request.usd}`}
          </Button>
        </>
      }
    >
      <p>{line}</p>
      <p className="text-ui-sm text-fg-subtle">
        <span className="font-medium text-fg-muted">Qwen Code says:</span>{" "}
        <span className="whitespace-pre-wrap break-words">“{escapeVisible(request.reason)}”</span>
      </p>
    </BlockerCard>
  );
}