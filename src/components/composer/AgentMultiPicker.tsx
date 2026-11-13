import { useRef, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { Popover, PopoverHeader } from "../ui/Popover";
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
  /** False where there is no repository: no checkboxes, a name picks the one agent. */
  canTick?: boolean;
}

const LIMIT_REASON = `You can compare up to ${MAX_COMPARE_AGENTS} agents.`;

type StatusTone = "muted" | "subtle" | "attention";

const STATUS_TONES: Readonly<Record<StatusTone, string>> = {
  muted: "text-fg-muted",
  subtle: "text-fg-subtle",
  attention: "text-status-attention",
};

/** The dot before a status word: ready and needs-sign-in are worth a glance, the rest are words only. */
const STATUS_DOTS: Readonly<Partial<Record<StatusTone, string>>> = {
  muted: "bg-status-running",
  attention: "bg-status-attention",
};

/** Runnable agents first, then the ones that need a sign-in, then the ones not installed; otherwise as given. */
const BLOCK_ORDER = { none: 0, "sign-in": 1, install: 2 } as const;
function inPickOrder(options: readonly AgentChoice[]): AgentChoice[] {
  return [...options].sort((a, b) => BLOCK_ORDER[a.blockedBy ?? "none"] - BLOCK_ORDER[b.blockedBy ?? "none"]);
}

/** The word on an agent's row, as the canvas draws it: what keeps it out first, else whether it was seen ready. */
function statusOf(option: AgentChoice): { word: string; tone: StatusTone } | undefined {
  if (option.blockedBy === "install") return { word: "Not installed", tone: "subtle" };
  if (option.blockedBy === "sign-in") return { word: "Needs sign-in", tone: "attention" };
  if (option.signIn === "ready") return { word: SIGN_IN_LABELS.ready, tone: "muted" };
  if (option.signIn === "unchecked") return { word: SIGN_IN_LABELS.unchecked, tone: "subtle" };
  return undefined;
}

/**
 * Every agent in use, behind the draft's "All agents" button: a name picks that agent alone, and in a repository
 * a checkbox ticks it for a compare run. Each row shows the agent's tile and whether it is ready; the arrow keys
 * move between the buttons.
 */
export function AgentMultiPicker({ options, selected, isOpen, onToggle, onClose = onToggle, onChange, onPick, canTick = true }: AgentMultiPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
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
      align="end"
      className="w-95"
      wrapperClassName="min-w-0 max-w-full"
      trigger={
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={onToggle}
          className="focus-ring flex h-6 items-center gap-1 rounded-md px-1.5 text-ui-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg"
        >
          All agents
          <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
        </button>
      }
    >
      <PopoverHeader aside={canTick ? "Pick more than one to compare" : undefined}>Agents</PopoverHeader>
      <div
        ref={menuRef}
        role="listbox"
        aria-label="Agent"
        aria-multiselectable={canTick || undefined}
        onKeyDown={moveFocus}
        className="max-h-72 overflow-y-auto"
      >
        {inPickOrder(options).map((option) => {
          const isTicked = selected.includes(option.value);
          const isOnly = isTicked && selected.length === 1;
          const isHeldBack = !isTicked && isOnlyBlocked;
          const isBlocked = option.blockedBy !== undefined;
          // A blocked agent's status word says why; the hold-backs below are sentences of their own.
          const holdBack = isHeldBack ? `Set up ${onlyAgent?.name} first.` : !isTicked && isFull ? LIMIT_REASON : undefined;
          const reason = isBlocked ? undefined : (option.disabledReason ?? holdBack);
          const reasonId = `agent-reason-${option.value}`;
          const statusId = `agent-status-${option.value}`;
          const status = statusOf(option);
          const describedBy = isBlocked ? statusId : reason ? reasonId : undefined;
          return (
            <div key={option.value} role="presentation">
              <div
                role="presentation"
                data-agent-row=""
                className={`flex h-7 items-center gap-2 rounded-md px-2 transition-colors hover:bg-surface-hover ${isBlocked ? "opacity-55" : ""}`}
              >
                {canTick && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isTicked}
                  aria-label={`Compare ${option.name}`}
                  aria-describedby={describedBy}
                  disabled={isOnly || isHeldBack || isBlocked || (!isTicked && reason !== undefined)}
                  title={isOnly ? "Keep at least one agent" : option.disabledReason}
                  onClick={() => onChange(option.value)}
                  className={`focus-ring -ml-0.75 flex size-5 shrink-0 items-center justify-center rounded disabled:cursor-default ${isBlocked ? "" : "disabled:opacity-50"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-3.5 items-center justify-center rounded-[3px] border-[1.5px] ${
                      isTicked ? "border-fg bg-fg text-surface-3" : "border-border-strong"
                    }`}
                  >
                    {isTicked && <Check size={10} strokeWidth={3} />}
                  </span>
                </button>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isTicked}
                  onClick={() => onPick(option.value)}
                  className={`focus-ring flex min-w-0 flex-1 items-center gap-2 rounded text-left text-ui ${isTicked ? "text-fg" : "text-fg-secondary"}`}
                >
                  <AgentTile profileId={option.value} name="" size={16} />
                  <span className="truncate">{option.name}</span>
                </button>
                {status && (
                  <span id={statusId} className="flex shrink-0 items-center gap-1.25">
                    {STATUS_DOTS[status.tone] && (
                      <span aria-hidden="true" className={`size-1.5 rounded-full ${STATUS_DOTS[status.tone]}`} />
                    )}
                    <span className={`text-caption ${STATUS_TONES[status.tone]}`}>{status.word}</span>
                  </span>
                )}
              </div>
              {canTick && reason && (
                <p id={reasonId} className="px-2 pb-1 text-caption text-fg-muted">
                  {reason}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {canTick && (
        <>
          <div aria-hidden="true" className="my-1.5 h-px bg-border" />
          <p className="px-2 pt-1 pb-1.5 text-caption text-fg-subtle">
            With two or more agents, each runs in its own worktree in its safest mode.
          </p>
        </>
      )}
    </Popover>
  );
}
