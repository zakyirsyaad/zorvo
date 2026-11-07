import { useId } from "react";
import { ShieldCheck } from "lucide-react";
import { DRAFT_CHIP } from "../composer/chip-style";
import type { PrivateChipControl } from "../../hooks/usePrivateDraft";

/** An on chip is filled and edged stronger, as an open draft chip is; a disabled one reads subtle. */
const PRIVATE_CHIP = `${DRAFT_CHIP} aria-pressed:border-border-strong aria-pressed:bg-surface-hover aria-pressed:text-fg aria-disabled:cursor-not-allowed aria-disabled:text-fg-subtle aria-disabled:hover:bg-surface-1`;

/**
 * The draft's Private chip: a toggle that makes the next session a Zorvo Private one. A disabled chip
 * stays focusable, so its reason is read with it.
 */
export function PrivateChip({ kind, reason, onToggle }: PrivateChipControl) {
  const reasonId = useId();
  const isDisabled = kind === "disabled";
  return (
    <>
      <button
        type="button"
        aria-pressed={kind === "on"}
        aria-disabled={isDisabled || undefined}
        aria-describedby={isDisabled && reason ? reasonId : undefined}
        title={isDisabled ? reason : undefined}
        onClick={isDisabled ? undefined : onToggle}
        className={PRIVATE_CHIP}
      >
        <ShieldCheck size={12} aria-hidden="true" className="shrink-0" />
        Private · TEE
      </button>
      {isDisabled && reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}
