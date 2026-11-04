import { POPOVER_PANEL_STYLE } from "../ui/Popover";
import type { SlashCommand } from "../../types";

export interface SlashCommandMenuProps {
  commands: SlashCommand[];
  highlighted: number;
  onPick: (command: SlashCommand) => void;
  /** Whose commands these are, for the header. */
  agentName?: string;
}

/** The agent's commands matching what follows the `/`, above the prompt. */
export function SlashCommandMenu({ commands, highlighted, onPick, agentName }: SlashCommandMenuProps) {
  return (
    <div className={`absolute bottom-full left-0 z-50 mb-2 w-full ${POPOVER_PANEL_STYLE}`}>
      <p className="px-2 pb-1.5 pt-1 text-caption font-medium text-fg-muted">
        {agentName ? `Commands from ${agentName}` : "Commands"}
      </p>
      <ul role="listbox" aria-label="Slash commands" className="max-h-64 overflow-y-auto">
        {commands.map((command, index) => (
          <li
            key={command.name}
            role="option"
            aria-selected={index === highlighted}
            data-command={command.name}
            // mousedown, not click: the prompt must keep focus.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(command);
            }}
            className={`flex min-h-7.5 cursor-pointer items-center gap-3 rounded px-2 py-1 text-ui-sm ${
              index === highlighted ? "bg-surface-hover text-fg" : "text-fg-secondary hover:bg-surface-hover"
            }`}
          >
            <span className="shrink-0 font-mono text-fg">/{command.name}</span>
            <span className="truncate text-fg-muted">{command.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
