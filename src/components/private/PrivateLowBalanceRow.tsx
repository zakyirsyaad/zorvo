import { lowBalanceNote, type ModelPrice } from "../../lib/private-credits";
import { Button } from "../ui/Button";

export interface PrivateLowBalanceRowProps {
  credits: number;
  model?: ModelPrice | null;
  onTopUp: () => void;
}

/** The s1 row above the composer when a private session's live balance is below 50. */
export function PrivateLowBalanceRow({ credits, model, onTopUp }: PrivateLowBalanceRowProps) {
  const note = lowBalanceNote(credits, model);
  if (note === undefined) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-lg border border-border bg-chip px-3 py-2"
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-attention" />
      <span className="flex-1 text-ui-sm text-fg-secondary">{note}</span>
      <Button variant="outline" size="row" className="shrink-0" onClick={onTopUp}>
        Top up
      </Button>
    </div>
  );
}