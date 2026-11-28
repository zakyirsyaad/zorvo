import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { Popover, PopoverHeader, PopoverOption } from "../ui/Popover";
import { COMPOSER_CHIP } from "./chip-style";
import { useMenuFocus } from "../../hooks/useMenuFocus";
import { SWITCH_TEXT, type SwitchTarget } from "../../lib/agent-switch";

export interface SessionAgentPickerProps {
  /** The session's agent first (`isSource`), then the other agents in use. */
  targets: readonly SwitchTarget[];
  /** The agent the next message goes to: the session's own, or one picked to continue with. */
  pickedId: string;
  isPrivate: boolean;
  /** Why the pick cannot change now; the trigger is then disabled and described by it. */
  disabledReason?: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (agentId: string) => void;
}

/**
 * A running session's agent, first in the composer's row: a menu that offers the other agents in use, so the next
 * message starts a new session with the conversation so far. Picking only marks the choice; Send starts it.
 */
export function SessionAgentPicker({ targets, pickedId, isPrivate, disabledReason, isOpen, onToggle, onClose, onPick }: SessionAgentPickerProps) {
  const { ref, onKeyDown } = useMenuFocus(isOpen);
  const reasonId = useId();
  const picked = targets.find((target) => target.id === pickedId) ?? targets[0];
  const source = targets.filter((target) => target.isSource);
  const others = targets.filter((target) => !target.isSource);
  const isDisabled = disabledReason !== undefined;

  const pick = (agentId: string) => {
    onClose();
    onPick(agentId);
  };
  const rowOf = (target: SwitchTarget) => (
    <PopoverOption
      key={target.id}
      isRadio
      selected={target.id === pickedId}
      disabled={target.isDisabled}
      onSelect={() => pick(target.id)}
      trailing={<span className="text-caption text-fg-subtle">{target.word}</span>}
    >
      <span className="inline-flex items-center gap-2">
        <AgentTile profileId={target.id} size={16} />
        {isPrivate && !target.isSource ? `${target.name}…` : target.name}
      </span>
    </PopoverOption>
  );

  return (
    <>
      <Popover
        isOpen={isOpen && !isDisabled}
        onClose={onClose}
        label="Agent"
        role="menu"
        side="top"
        className="w-[300px]"
        wrapperClassName="min-w-0 max-w-full"
        trigger={
          <button
            type="button"
            aria-label={`Agent: ${picked?.name ?? ""}`}
            aria-haspopup="menu"
            aria-expanded={isOpen && !isDisabled}
            aria-disabled={isDisabled || undefined}
            aria-describedby={isDisabled ? reasonId : undefined}
            onClick={() => {
              if (!isDisabled) onToggle();
            }}
            data-agent-picker=""
            className={`${COMPOSER_CHIP} pl-0.5 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
          >
            <AgentTile profileId={picked?.id ?? ""} size={16} />
            <span className="truncate">{picked?.name}</span>
            <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
          </button>
        }
      >
        <div ref={ref} onKeyDown={onKeyDown}>
          {source.map(rowOf)}
          <div aria-hidden="true" className="my-1 h-px bg-border" />
          <PopoverHeader>{isPrivate ? SWITCH_TEXT.privateHeader : SWITCH_TEXT.menuHeader}</PopoverHeader>
          {others.map(rowOf)}
          <div aria-hidden="true" className="my-1 h-px bg-border" />
          <p className="px-2 pb-1 text-caption text-fg-subtle">{SWITCH_TEXT.footer}</p>
        </div>
      </Popover>
      {isDisabled && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
    </>
  );
}
