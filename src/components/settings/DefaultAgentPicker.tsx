import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { readyAgents, type AgentSummary } from "../../lib/agent-readiness";
import { AgentTile } from "../ui/AgentTile";
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
          icon={current && <AgentTile profileId={current.id} name="" size={16} />}
        >
          <span className="text-fg">{current?.name ?? "Choose an agent"}</span>
          <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
        </Button>
      }
    >
      {ready.map((agent) => (
        <PopoverOption key={agent.id} selected={agent.id === defaultAgentId} onSelect={() => pick(agent.id)}>
          <AgentTile profileId={agent.id} name="" size={16} />
          <span className="truncate">{agent.name}</span>
        </PopoverOption>
      ))}
    </Popover>
  );
}
