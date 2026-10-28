import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentLogo } from "../AgentLogo";
import { unavailableReasonText } from "../../lib/agent-catalog";
import type { UnavailableAgent } from "../../types";

export interface UnavailableAgentsProps {
  agents: readonly UnavailableAgent[];
  /** True while a search is typed: the matches show without a click. */
  isSearching: boolean;
}

/** The registry agents Zorvo cannot offer, collapsed by default, each with why. They have no buttons. */
export function UnavailableAgents({ agents, isSearching }: UnavailableAgentsProps) {
  const headingId = useId();
  const listId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  if (agents.length === 0) return null;
  const isOpen = isExpanded || isSearching;
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-disabled={isSearching}
          onClick={() => !isSearching && setIsExpanded(!isExpanded)}
          className="focus-ring flex items-center gap-1 rounded uppercase tracking-wider aria-disabled:cursor-default"
        >
          <Chevron size={12} aria-hidden="true" />
          {`Not available (${agents.length})`}
        </button>
      </h3>
      <ul id={listId} hidden={!isOpen} className="flex flex-col gap-1.5">
        {isOpen &&
          agents.map((agent) => (
            <li
              key={agent.id}
              aria-label={agent.name}
              className="flex gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs"
            >
              <AgentLogo profileId={agent.id} name="" size={20} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{agent.name}</span>
                <p className="mt-0.5 text-[11px] text-fg-muted">{unavailableReasonText(agent.reason)}</p>
                {agent.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-fg-subtle">{agent.description}</p>
                )}
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}
