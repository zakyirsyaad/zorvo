import { useRef, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AgentLogo } from "../AgentLogo";
import { Popover } from "../ui/Popover";
import { DRAFT_CHIP } from "./chip-style";
import { MAX_COMPARE_AGENTS } from "../../lib/compare-run";
import { SIGN_IN_LABELS } from "../../lib/agent-sign-in";
import type { AgentChoice } from "../../lib/composer-controls";

export interface AgentMultiPickerProps {
  options: readonly AgentChoice[];
  /** The ticked agents' ids. */
  selected: readonly string[];
  isOpen: boolean;
  onToggle: () => void;
  /** Closes the list on Escape or a click outside, without toggling it; defaults to `onToggle`. */
  onClose?: () => void;
  /** Ticks or unticks an agent. */
  onChange: (agentId: string) => void;
  /** Chooses this agent alone. */
  onPick: (agentId: string) => void;
}

const LIMIT_REASON = `You can compare up to ${MAX_COMPARE_AGENTS} agents.`;

/** The ticked agents, in the order they were ticked: each one's id and plain name. */
function tickedAgents(options: readonly AgentChoice[], selected: readonly string[]): { id: string; name: string }[] {
  return selected.map((id) => ({ id, name: options.find((o) => o.value === id)?.name ?? id }));
}

/**
 * The draft's Agent chip in a git repository: a name picks that agent alone, and a checkbox ticks it for
 * a compare run. Each row shows the agent's logo and whether it is ready; the arrow keys move between the buttons.
 */
export function AgentMultiPicker({ options, selected, isOpen, onToggle, onClose = onToggle, onChange, onPick }: AgentMultiPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const ticked = tickedAgents(options, selected);
  const names = ticked.map((agent) => agent.name).join(", ");
  const isCompare = ticked.length >= 2;
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
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label="Choose agents"
      role="dialog"
      side="bottom"
      align="start"
      className="w-72"
      trigger={
        <button
          type="button"
          aria-label={`Agent: ${names}${isCompare ? ", compare" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={onToggle}
          title={names}
          className={DRAFT_CHIP}
        >
          {/* Each ticked agent's logo, overlapping, as the canvas draws a compare run's chip. */}
          <span data-agent-logos="" aria-hidden="true" className="flex shrink-0">
            {ticked.map((agent, index) => (
              <AgentLogo key={agent.id} profileId={agent.id} name="" size={16} className={index > 0 ? "-ml-1" : ""} />
            ))}
          </span>
          <span className="min-w-0 truncate">{names}</span>
          {isCompare && <span className="shrink-0 text-fg-subtle"> · compare</span>}
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      <p className="px-2 pb-1.5 pt-1 text-caption text-fg-muted">Pick more than one to compare them in a run.</p>
      <div
        ref={menuRef}
        role="listbox"
        aria-label="Agent"
        aria-multiselectable="true"
        onKeyDown={moveFocus}
        className="max-h-72 overflow-y-auto"
      >
        {options.map((option) => {
          const isTicked = selected.includes(option.value);
          const isOnly = isTicked && selected.length === 1;
          const isHeldBack = !isTicked && isOnlyBlocked;
          const reason =
            option.disabledReason ??
            (isHeldBack ? `Set up ${onlyAgent?.name} first.` : !isTicked && isFull ? LIMIT_REASON : undefined);
          const reasonId = `agent-reason-${option.value}`;
          const readiness = !option.disabledReason && option.signIn ? SIGN_IN_LABELS[option.signIn] : undefined;
          return (
            <div key={option.value} role="presentation" className="rounded">
              <div role="presentation" className="flex min-h-7.5 items-center gap-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={isTicked}
                  onClick={() => onPick(option.value)}
                  className={`focus-ring flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-ui transition-colors hover:bg-surface-hover ${
                    option.disabledReason ? "text-fg-muted" : isTicked ? "font-medium text-fg" : "text-fg-secondary hover:text-fg"
                  }`}
                >
                  <AgentLogo profileId={option.value} name="" size={14} />
                  <span className="truncate">{option.label}</span>
                </button>
                {readiness && <span className="shrink-0 text-caption text-fg-muted">{readiness}</span>}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isTicked}
                  aria-label={`Compare ${option.label}`}
                  aria-describedby={reason ? reasonId : undefined}
                  disabled={isOnly || isHeldBack || (!isTicked && reason !== undefined)}
                  title={isOnly ? "Keep at least one agent" : undefined}
                  onClick={() => onChange(option.value)}
                  className="focus-ring mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong text-fg transition-colors disabled:cursor-default disabled:opacity-50"
                >
                  {isTicked && <Check size={12} aria-hidden="true" />}
                </button>
              </div>
              {reason && (
                <p id={reasonId} className="px-2 pb-1 text-caption text-fg-muted">
                  {reason}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 border-t border-border px-2 pb-1 pt-2 text-caption text-fg-muted">
        Each agent runs in its own worktree, in its safest mode.
      </p>
    </Popover>
  );
}
