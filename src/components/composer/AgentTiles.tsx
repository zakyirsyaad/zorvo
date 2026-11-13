import { Check, ChevronRight } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { AgentMultiPicker, type AgentMultiPickerProps } from "./AgentMultiPicker";
import { SIGN_IN_LABELS } from "../../lib/agent-sign-in";
import { shownTiles } from "../../lib/agent-tiles";
import type { AgentChoice } from "../../lib/composer-controls";

export interface AgentTilesProps extends AgentMultiPickerProps {
  /** In a repository several agents can be ticked for a compare run; elsewhere a press picks one. */
  canTick: boolean;
}

const HINT = "Tick two or more to compare them.";

/** The line under a tile's name: a word, and a dot only for a state worth a glance. */
function statusOf(option: AgentChoice): { word: string; dot?: string; tone: string } | undefined {
  if (option.blockedBy === "install") return { word: "Not installed", tone: "text-fg-subtle" };
  if (option.blockedBy === "sign-in") return { word: SIGN_IN_LABELS.needed, dot: "bg-status-attention", tone: "text-fg-muted" };
  if (option.signIn === "ready") return { word: SIGN_IN_LABELS.ready, dot: "bg-status-running", tone: "text-fg-muted" };
  if (option.signIn === "unchecked") return { word: SIGN_IN_LABELS.unchecked, tone: "text-fg-subtle" };
  return undefined;
}

const TILE =
  "focus-ring flex min-h-12 min-w-0 items-center gap-2.5 rounded-panel border px-3 py-2 text-left transition-colors";

/**
 * The draft's agents as tiles: the first four in use, each with its logo, name and whether it is ready. A press
 * ticks an agent for a compare run (or picks it alone where there is no repository), and a tile that needs an
 * install or a sign-in picks that agent alone, which shows what it needs. Every agent is under "All agents".
 */
export function AgentTiles({ options, selected, canTick, isOpen, onToggle, onClose, onChange, onPick }: AgentTilesProps) {
  const tiles = shownTiles(options, selected);
  // The only agent needs an install or a sign-in: its own panel comes before any compare.
  const onlyAgent = selected.length === 1 ? options.find((option) => option.value === selected[0]) : undefined;
  const isOnlyBlocked = onlyAgent?.blockedBy !== undefined;

  return (
    <section aria-label="Agents" data-agent-tiles="" className="mb-5 flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-ui-sm font-medium text-fg-secondary">Agents</h2>
        {canTick && <p className="min-w-0 flex-1 truncate text-caption text-fg-subtle">{HINT}</p>}
        <span className="ml-auto shrink-0">
          <AgentMultiPicker
            options={options}
            selected={selected}
            canTick={canTick}
            isOpen={isOpen}
            onToggle={onToggle}
            onClose={onClose}
            onChange={onChange}
            // Picking one agent is an answer: the list closes.
            onPick={(agentId) => {
              onPick(agentId);
              (onClose ?? onToggle)();
            }}
          />
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-2">
        {tiles.map((option) => {
          const isChosen = selected.includes(option.value);
          const isBlocked = option.blockedBy !== undefined;
          // A full run leaves no unticked tile to press: the chosen agents hold all four, and the list says the limit.
          const picksAlone = isBlocked || !canTick || (isOnlyBlocked && !isChosen);
          const status = statusOf(option);
          const statusId = `agent-tile-status-${option.value}`;
          const blockedLabel = option.blockedBy === "install" ? `${option.name}, install first` : `${option.name}, sign in first`;
          return (
            <button
              key={option.value}
              type="button"
              data-agent-tile={option.value}
              aria-label={isBlocked ? blockedLabel : option.name}
              // A blocked agent is never ticked: pressing it shows what it needs.
              aria-pressed={isBlocked ? undefined : isChosen}
              aria-describedby={status ? statusId : undefined}
              onClick={() => (picksAlone ? onPick(option.value) : onChange(option.value))}
              className={`${TILE} ${
                isChosen ? "border-border-strong bg-surface-2 text-fg" : "border-border text-fg-secondary hover:bg-surface-hover"
              }`}
            >
              <AgentTile profileId={option.value} name="" size={22} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate text-ui ${isChosen && !isBlocked ? "font-medium" : ""}`}>{option.name}</span>
                {status && (
                  <span id={statusId} className={`flex items-center gap-1.25 text-caption leading-4 ${status.tone}`}>
                    {status.dot && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${status.dot}`} />}
                    <span className="truncate">{status.word}</span>
                  </span>
                )}
              </span>
              {isBlocked ? (
                <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
              ) : (
                isChosen && <Check size={14} aria-hidden="true" className="shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
