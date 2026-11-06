import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { readyAgents, type AgentSummary } from "../../lib/agent-readiness";
import { AgentLogo } from "../AgentLogo";
import { Button } from "../ui/Button";
import { Popover, PopoverOption } from "../ui/Popover";

export interface DefaultAgentPickerProps {
  /** The agents in use; only the ready ones can be picked. */
  agents: readonly AgentSummary[];
  defaultAgentId: string | null;
  onChange: (agentId: string) => void;
}

/** General's Default agent: a button with the agent's logo and name that opens a list of ready agents. */
export function DefaultAgentPicker({ agents, defaultAgentId, onChange }: DefaultAgentPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ready = readyAgents(agents);
  if (ready.length === 0) return <span className="text-ui-sm text-fg-subtle">No agents are installed yet.</span>;

  // Named even when it is not ready now: it is still the setting, and the list says what can replace it.
  const current = agents.find((agent) => agent.id === defaultAgentId);
  const pick = (agentId: string) => {
    onChange(agentId);
    setIsOpen(false);
  };
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="Default agent"
      role="listbox"
      align="end"
      className="w-56"
      trigger={
        <Button
          size="md"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          icon={
            current && (
              <span aria-hidden="true" className="flex size-4 items-center justify-center rounded bg-surface-hover">
                <AgentLogo profileId={current.id} name="" size={12} />
              </span>
            )
          }
        >
          <span className="text-fg">{current?.name ?? "Choose an agent"}</span>
          <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
        </Button>
      }
    >
      {ready.map((agent) => (
        <PopoverOption key={agent.id} selected={agent.id === defaultAgentId} onSelect={() => pick(agent.id)}>
          <AgentLogo profileId={agent.id} name="" size={12} />
          <span className="truncate">{agent.name}</span>
        </PopoverOption>
      ))}
    </Popover>
  );
}
