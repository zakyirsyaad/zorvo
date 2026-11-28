import { useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverHeader, PopoverOption } from "../ui/Popover";
import { AgentTile } from "../ui/AgentTile";
import { useMenuFocus } from "../../hooks/useMenuFocus";
import { SWITCH_TEXT, type SwitchTarget } from "../../lib/agent-switch";

export interface ForkMenuProps {
  /** The session's agent first (`isSource`), then the other agents in use. */
  agents: readonly SwitchTarget[];
  /** No agent id: fork with the session's own agent. */
  onFork: (agentId?: string) => void;
}

/**
 * Fork from here under an agent reply. With other agents in use it opens a menu: the same agent first, focused so
 * Enter keeps today's fork one key away, then the agents the conversation can continue with from this message.
 */
export function ForkMenu({ agents, onFork }: ForkMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { ref, onKeyDown } = useMenuFocus(isOpen);
  const source = agents.find((agent) => agent.isSource);
  const others = agents.filter((agent) => !agent.isSource);

  if (others.length === 0) {
    return (
      <IconButton label="Fork from here" size="md" tone="secondary" onClick={() => onFork()}>
        <GitBranch size={14} />
      </IconButton>
    );
  }

  const pick = (agentId?: string) => {
    setIsOpen(false);
    if (agentId === undefined) onFork();
    else onFork(agentId);
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="Fork from here"
      role="menu"
      side="bottom"
      className="w-[268px]"
      trigger={
        <IconButton
          label="Fork from here"
          size="md"
          tone="secondary"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <GitBranch size={14} />
          <ChevronDown size={10} aria-hidden="true" className="text-fg-muted" />
        </IconButton>
      }
    >
      <div ref={ref} onKeyDown={onKeyDown}>
        <PopoverOption onSelect={() => pick()}>
          <span className="inline-flex items-center gap-2">
            <AgentTile profileId={source?.id ?? ""} size={16} />
            Fork with {source?.name ?? "this agent"}
          </span>
        </PopoverOption>
        <div aria-hidden="true" className="my-1 h-px bg-border" />
        <PopoverHeader>{SWITCH_TEXT.forkHeader}</PopoverHeader>
        {others.map((agent) => (
          <PopoverOption
            key={agent.id}
            disabled={agent.isDisabled}
            onSelect={() => pick(agent.id)}
            trailing={<span className="text-caption text-fg-subtle">{agent.word}</span>}
          >
            <span className="inline-flex items-center gap-2">
              <AgentTile profileId={agent.id} size={16} />
              {agent.name}
            </span>
          </PopoverOption>
        ))}
      </div>
    </Popover>
  );
}
