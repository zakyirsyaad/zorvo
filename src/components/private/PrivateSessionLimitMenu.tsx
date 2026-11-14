import { useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { Popover, PopoverHeader, PopoverList, PopoverOption } from "../ui/Popover";
import { COMPOSER_CHIP } from "../composer/chip-style";
import { modelLabel, turnsFor, type ModelPrice } from "../../lib/private-credits";
import type { PrivateSessionLimit } from "../../hooks/usePrivateDraft";

const MENU_LABEL = "Session limit";
const CAPS = [100, 200, 500] as const;
const AT_LEAST_ONE = CAPS[0];

/** Why the limit chip cannot be used, or undefined when it can. */
export function sessionLimitDisabledReason({ ownKey, credits }: Pick<PrivateSessionLimit, "ownKey" | "credits">): string | undefined {
  if (ownKey) return "With your own key, set spending limits on the key in your NEAR AI dashboard.";
  if (credits < AT_LEAST_ONE) return "You need at least 100 credits to set a session limit.";
  return undefined;
}

function optionLabel(cap: number, model: ModelPrice | undefined): string {
  const turns = model ? turnsFor(cap, model) : 0;
  return turns > 0 ? `${cap} credits ≈ ${turns} turns` : `${cap} credits`;
}

/**
 * The draft's Session limit chip and listbox, as the canvas draws them: No limit by default, then
 * 100, 200 or 500 credits. NEAR AI enforces the cap on the session's own key.
 */
export function PrivateSessionLimitMenu({ cap, model, credits, ownKey, onChange }: PrivateSessionLimit) {
  const [isOpen, setIsOpen] = useState(false);
  const reason = sessionLimitDisabledReason({ ownKey, credits });
  const label = cap === undefined ? "No session limit" : `${cap} credits`;

  if (reason !== undefined) {
    return (
      <span className="contents">
        <button
          type="button"
          disabled
          aria-describedby="session-limit-off"
          className={`${COMPOSER_CHIP} disabled:text-fg-muted disabled:hover:bg-chip disabled:hover:text-fg-muted`}
        >
          <Clock size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
          Session limit
        </button>
        <span id="session-limit-off" className="basis-full text-ui-sm text-fg-subtle">
          {reason}
        </span>
      </span>
    );
  }

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label={MENU_LABEL}
      role="dialog"
      side="bottom"
      align="start"
      className="w-80 max-w-[calc(100vw-2rem)]"
      trigger={
        <button
          type="button"
          aria-label={`Session limit: ${label}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          title="Set a credit limit for this session. NEAR AI stops it at the limit."
          onClick={() => setIsOpen((open) => !open)}
          className={COMPOSER_CHIP}
        >
          <Clock size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <span className="max-w-[150px] truncate">{label}</span>
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      <PopoverHeader>{MENU_LABEL}</PopoverHeader>
      <PopoverList label={MENU_LABEL}>
        <PopoverOption
          selected={cap === undefined}
          onSelect={() => {
            onChange(undefined);
            setIsOpen(false);
          }}
        >
          No limit
        </PopoverOption>
        {CAPS.map((value) => {
          const tooLarge = value > credits;
          return (
            <PopoverOption
              key={value}
              selected={cap === value}
              disabled={tooLarge}
              onSelect={() => {
                onChange(value);
                setIsOpen(false);
              }}
              description={tooLarge ? "Not enough credits left." : undefined}
            >
              {optionLabel(value, model)}
            </PopoverOption>
          );
        })}
      </PopoverList>
      <p className="mt-1 border-t border-border px-2 pt-2 pb-1 text-caption text-fg-subtle">
        NEAR AI stops the session at the limit, even if Zorvo is closed. Turns are for{" "}
        {model ? modelLabel(model.id) : "the model you pick"}.
      </p>
    </Popover>
  );
}