import { POPOVER_PANEL_STYLE } from "../ui/Popover";
import type { SlashCommand } from "../../types";

export interface SlashCommandMenuProps {
  commands: SlashCommand[];
  highlighted: number;
  onPick: (command: SlashCommand) => void;
  /** Whose commands these are, for the header. */
  agentName?: string;
  /** Above the card in a session; under it in a draft, whose card sits near the top of its column. */
  side?: "top" | "bottom";
}

/** Where the `/` and `@` lists open against the composer's card. */
export const PROMPT_LIST_SIDES = { top: "bottom-full mb-2", bottom: "top-full mt-2" } as const;

/** The agent's commands matching what follows the `/`, above the prompt (under the card in a draft). */
export function SlashCommandMenu({ commands, highlighted, onPick, agentName, side = "top" }: SlashCommandMenuProps) {
  return (
    <div className={`absolute ${PROMPT_LIST_SIDES[side]} left-0 z-50 w-full ${POPOVER_PANEL_STYLE}`}>
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
            // The command over what it does, as the canvas draws the `/` menu.
            className={`flex cursor-pointer flex-col rounded-md px-2 py-[5px] ${
              index === highlighted ? "bg-surface-hover" : "hover:bg-surface-hover"
            }`}
          >
            <span className={`truncate font-mono text-ui-sm ${index === highlighted ? "text-fg" : "text-fg-secondary"}`}>/{command.name}</span>
            {command.description && (
              <span className="truncate text-caption leading-[15px] text-fg-subtle">{command.description}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
