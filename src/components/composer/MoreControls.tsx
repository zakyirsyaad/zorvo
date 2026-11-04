import { MoreHorizontal } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverHeader, PopoverOption } from "../ui/Popover";
import type { ComposerControl } from "../../lib/composer-controls";

/** One of the agent's controls that did not fit in the composer's row. */
export interface OverflowControl {
  id: string;
  label: string;
  control: ComposerControl;
}

export interface MoreControlsProps {
  controls: readonly OverflowControl[];
  isOpen: boolean;
  onToggle: () => void;
  /** Closes the menu on Escape or a click outside, without toggling it. */
  onClose: () => void;
  /** After a pick has been sent: the menu closes. */
  onPicked: () => void;
}

/** What the hidden controls are set to, so a Plan or Fast mode behind ⋯ is not invisible: "Fast mode: On, Agent: Default". */
function currentValues(controls: readonly OverflowControl[]): string {
  return controls
    .map(({ label, control }) => {
      const current = control.options.find((option) => option.value === control.selected) ?? control.options[0];
      return current ? `${label}: ${current.label}` : label;
    })
    .join(", ");
}

/** The composer's ⋯ menu: each control that did not fit, as a group of choices with the current one checked. */
export function MoreControls({ controls, isOpen, onToggle, onClose, onPicked }: MoreControlsProps) {
  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label="More options"
      role="menu"
      side="top"
      align="start"
      className="w-max min-w-48 max-w-80"
      trigger={
        // The tooltip, read as the button's description, says what the hidden controls are set to.
        <IconButton
          label="More options"
          title={currentValues(controls)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {controls.map(({ id, label, control }) => (
          <div key={id} role="group" aria-label={label} className="not-first:mt-1 not-first:border-t not-first:border-border not-first:pt-1">
            <PopoverHeader>{label}</PopoverHeader>
            {control.options.map((option) => (
              <PopoverOption
                key={option.value ?? "__default"}
                isRadio
                selected={option.value === control.selected}
                description={option.description}
                onSelect={() => {
                  control.onChange(option.value);
                  onPicked();
                }}
              >
                {option.label}
              </PopoverOption>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  );
}
