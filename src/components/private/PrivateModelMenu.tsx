import { ChevronDown } from "lucide-react";
import { Popover, PopoverHeader, PopoverOption } from "../ui/Popover";
import { COMPOSER_CHIP } from "../composer/chip-style";
import { modelLabel, perTurnLabel, type ModelPrice } from "../../lib/private-credits";
import type { PrivateModelChoice } from "../../hooks/usePrivateDraft";

const MENU_LABEL = "Private models";

/** "$0.04 / $1.35": a model's price per million tokens in and out. */
function priceOf(model: ModelPrice): string {
  return `$${model.inputPerM.toFixed(2)} / $${model.outputPerM.toFixed(2)}`;
}

export interface PrivateModelMenuProps extends PrivateModelChoice {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/** The private models a draft can run, in the place of the agent's model chip while the Private chip is on. */
export function PrivateModelMenu({ models, selected, onSelect, isOpen, onToggle, onClose }: PrivateModelMenuProps) {
  const current = models.find((model) => model.id === selected) ?? models[0];
  const currentLabel = current ? modelLabel(current.id) : "";
  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label={MENU_LABEL}
      role="listbox"
      side="bottom"
      align="end"
      className="w-90 max-w-[calc(100vw-2rem)]"
      wrapperClassName="min-w-0 max-w-full"
      trigger={
        <button
          type="button"
          aria-label={`Private model: ${currentLabel}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={onToggle}
          className={COMPOSER_CHIP}
        >
          <span className="max-w-[160px] truncate">{currentLabel}</span>
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      <PopoverHeader aside="per 1M tokens in / out">Private models · run in a TEE</PopoverHeader>
      <div>
        {models.map((model) => (
          <PopoverOption
            key={model.id}
            selected={model.id === current?.id}
            onSelect={() => onSelect(model.id)}
            description={`${priceOf(model)} · ${perTurnLabel(model)}`}
            title={model.id}
          >
            {modelLabel(model.id)}
          </PopoverOption>
        ))}
      </div>
      <p className="mt-1 border-t border-border px-2 pt-2 pb-1 text-caption text-fg-subtle">
        Claude, GPT and Gemini aren't offered here: they don't run in a TEE. Turn estimates come from real coding
        tasks.
      </p>
    </Popover>
  );
}
