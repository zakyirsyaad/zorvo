import { useState } from "react";
import { Plus } from "lucide-react";
import { AgentLogo } from "../AgentLogo";
import type { AgentProfile } from "../../types";
import { Popover, PopoverHeader, PopoverOption } from "../ui/Popover";

export interface NewSessionMenuProps {
  folderName: string;
  /** Installed agents only; the default comes first. */
  agents: readonly AgentProfile[];
  defaultAgentId?: string;
  onPick: (agentId: string) => void;
}

/** The default agent first, then the rest in their usual order. */
function defaultFirst(agents: readonly AgentProfile[], defaultAgentId?: string): AgentProfile[] {
  const fallback = agents.find((agent) => agent.id === defaultAgentId);
  return fallback ? [fallback, ...agents.filter((agent) => agent !== fallback)] : [...agents];
}

/** A folder's + button: it asks which agent the new session runs. */
export function NewSessionMenu({ folderName, agents, defaultAgentId, onPick }: NewSessionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const choices = defaultFirst(agents, defaultAgentId);

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label={`Agent for the new session in ${folderName}`}
      align="end"
      className="w-52"
      trigger={
        <button
          type="button"
          aria-label={`New session in ${folderName}`}
          title={`New session in ${folderName}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="flex size-6 items-center justify-center rounded-md text-fg-subtle transition-colors hover:text-fg-secondary focus-ring"
        >
          <Plus size={13} />
        </button>
      }
    >
      <PopoverHeader>New session with</PopoverHeader>
      {choices.length === 0 && <p className="px-2 py-1.5 text-ui text-fg-subtle">No agent is installed.</p>}
      {choices.map((agent) => (
        <PopoverOption
          key={agent.id}
          onSelect={() => {
            setIsOpen(false);
            onPick(agent.id);
          }}
          trailing={agent.id === defaultAgentId ? "Default" : undefined}
        >
          <span className="flex min-w-0 items-center gap-2">
            <AgentLogo profileId={agent.id} name="" size={12} />
            <span className="truncate">{agent.name}</span>
          </span>
        </PopoverOption>
      ))}
    </Popover>
  );
}
