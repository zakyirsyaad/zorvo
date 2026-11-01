import { useRef, type KeyboardEvent } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import { MAX_COMPARE_AGENTS } from "../../lib/compare-run";
import type { AgentChoice } from "../../lib/composer-controls";

export interface AgentMultiPickerProps {
  options: readonly AgentChoice[];
  /** The ticked agents' ids. */
  selected: readonly string[];
  isOpen: boolean;
  onToggle: () => void;
  /** Ticks or unticks an agent. */
  onChange: (agentId: string) => void;
  /** Chooses this agent alone. */
  onPick: (agentId: string) => void;
}

const SET_UP_FIRST_REASON = "Set up the selected agent first.";
const LIMIT_REASON = `You can compare up to ${MAX_COMPARE_AGENTS} agents.`;

/** The chip's words: the agent's name, or how many are ticked. */
function chipLabel(options: readonly AgentChoice[], selected: readonly string[]): string {
  if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label ?? "";
  return `${selected.length} agents`;
}

/**
 * The Agent chip in a git repository: a name picks that agent alone, and a checkbox ticks it for
 * a compare run. Like `OptionDropdown`, plus the arrow keys to move between the buttons.
 */
export function AgentMultiPicker({ options, selected, isOpen, onToggle, onChange, onPick }: AgentMultiPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const label = chipLabel(options, selected);
  const isFull = selected.length >= MAX_COMPARE_AGENTS;
  // The only agent needs an install or a sign-in: its own panel comes before any compare.
  const onlyAgent = selected.length === 1 ? options.find((o) => o.value === selected[0]) : undefined;
  const isOnlyBlocked = onlyAgent?.disabledReason !== undefined;

  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
    e.preventDefault();
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Agent: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
        title={label}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-fg-secondary hover:bg-surface-hover hover:text-fg transition-colors cursor-pointer border border-border focus-ring"
      >
        <Bot size={12} className="text-fg-muted" />
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown size={11} className="text-fg-subtle" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Agent"
          aria-multiselectable="true"
          onKeyDown={moveFocus}
          className="absolute bottom-full left-0 mb-2 min-w-48 max-w-80 w-max rounded-lg border border-border bg-surface-3 p-1 shadow-popover z-50"
        >
          {options.map((option) => {
            const isTicked = selected.includes(option.value);
            const isOnly = isTicked && selected.length === 1;
            // The blocked agent's own row says what it needs; the other rows point to it rather than repeat it.
            const reason = option.disabledReason ?? (isTicked || isOnlyBlocked || !isFull ? undefined : LIMIT_REASON);
            const reasonId = `agent-reason-${option.value}`;
            const isHeldBack = !isTicked && isOnlyBlocked;
            return (
              <div key={option.value} role="presentation" className="rounded px-1 py-0.5">
                <div role="presentation" className="flex items-center gap-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isTicked}
                    onClick={() => onPick(option.value)}
                    className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs transition-colors cursor-pointer focus-ring ${
                      isTicked ? "text-fg font-medium" : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    {option.label}
                  </button>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isTicked}
                    aria-label={`Compare ${option.label}`}
                    aria-describedby={isHeldBack ? `agent-reason-${onlyAgent?.value}` : reason ? reasonId : undefined}
                    disabled={isOnly || isHeldBack || (!isTicked && reason !== undefined)}
                    title={isOnly ? "Keep at least one agent" : isHeldBack ? SET_UP_FIRST_REASON : undefined}
                    onClick={() => onChange(option.value)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong text-fg transition-colors cursor-pointer focus-ring disabled:cursor-default disabled:opacity-50"
                  >
                    {isTicked && <Check size={12} aria-hidden="true" />}
                  </button>
                </div>
                {reason && (
                  <p id={reasonId} className="px-1.5 pb-0.5 text-[11px] leading-snug text-fg-muted">
                    {reason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
