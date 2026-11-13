import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { unavailableReasonText } from "../../lib/agent-catalog";
import type { UnavailableAgent } from "../../types";

export interface UnavailableAgentsProps {
  agents: readonly UnavailableAgent[];
  /** True while a search is typed: the matches show without a click. */
  isSearching: boolean;
}

/** The registry agents Zorvo cannot offer, folded under a quiet toggle, each with why. They have no buttons. */
export function UnavailableAgents({ agents, isSearching }: UnavailableAgentsProps) {
  const headingId = useId();
  const listId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  if (agents.length === 0) return null;
  const isOpen = isExpanded || isSearching;
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="self-start">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-disabled={isSearching}
          onClick={() => !isSearching && setIsExpanded(!isExpanded)}
          className="flex h-7 items-center gap-1.5 rounded px-1 text-ui-sm text-fg-muted focus-ring aria-disabled:cursor-default"
        >
          <Chevron size={12} aria-hidden="true" />
          {`Not available (${agents.length})`}
        </button>
      </h2>
      <ul id={listId} hidden={!isOpen} className="flex flex-col rounded-xl border border-border bg-surface-2">
        {isOpen &&
          agents.map((agent) => (
            <li
              key={agent.id}
              aria-label={agent.name}
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <AgentTile profileId={agent.id} name="" size={28} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-ui font-medium text-fg">{agent.name}</span>
                <span className="text-ui-sm text-fg-muted">{unavailableReasonText(agent.reason)}</span>
                {agent.description && <span className="line-clamp-2 text-ui-sm text-fg-muted">{agent.description}</span>}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
