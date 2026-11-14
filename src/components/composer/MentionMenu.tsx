import { FileText } from "lucide-react";
import type { MentionAgentStatus } from "../../lib/delegation";
import { AgentTile } from "../ui/AgentTile";
import { POPOVER_PANEL_STYLE } from "../ui/Popover";
import { Highlighted } from "../ui/Highlighted";
import { PROMPT_LIST_SIDES } from "./SlashCommandMenu";

/** One agent an @ at the start of the message can delegate to. */
export interface MentionAgent {
  id: string;
  name: string;
  status: MentionAgentStatus;
}

export interface MentionMenuProps {
  /** Paths relative to the workspace. */
  files: string[];
  highlighted: number;
  onPick: (path: string) => void;
  /** The workspace folder's name, for the header. */
  folderName: string;
  /** What follows the `@`; its match in a file's or agent's name shows in bold. */
  query: string;
  /** Agents to delegate to, above the files; absent turns the group off. */
  agents?: readonly MentionAgent[];
  onPickAgent?: (agent: MentionAgent) => void;
  /** Above the card in a session; under it in a draft, whose card sits near the top of its column. */
  side?: "top" | "bottom";
}

const STATUS_TEXT: Readonly<Record<MentionAgentStatus, string>> = {
  ready: "Ready",
  "not-checked": "Not checked",
  "needs-sign-in": "Needs sign-in",
  "not-installed": "Not installed",
};

const STATUS_CLASS: Readonly<Record<MentionAgentStatus, string>> = {
  ready: "text-fg-muted",
  "not-checked": "text-fg-subtle",
  // The dot beside the words carries the colour.
  "needs-sign-in": "text-fg-muted",
  "not-installed": "text-fg-subtle",
};

/** Whether an agent's row can be picked; the others say why and stay out of the keyboard list. */
export function isPickableAgent(agent: MentionAgent): boolean {
  return agent.status !== "not-installed" && agent.status !== "needs-sign-in";
}

/**
 * Workspace files matching what follows the `@`, and the agents a delegation can
 * go to when the `@` starts the message, above the prompt (under the card in a draft).
 * The highlight runs over the pickable agents, then the files, as Return does.
 */
export function MentionMenu({
  files,
  highlighted,
  onPick,
  folderName,
  query,
  agents = [],
  onPickAgent,
  side = "top",
}: MentionMenuProps) {
  const pickableAgents = agents.filter(isPickableAgent);
  return (
    <div className={`absolute ${PROMPT_LIST_SIDES[side]} left-0 z-50 w-full ${POPOVER_PANEL_STYLE}`}>
      {agents.length > 0 && (
        <>
          <p className="px-2 pb-1.5 pt-1 text-caption font-medium text-fg-muted">Delegate to an agent</p>
          <ul role="listbox" aria-label="Agents to delegate to" className="max-h-64 overflow-y-auto">
            {agents.map((agent) => {
              const index = pickableAgents.indexOf(agent);
              const isPickable = index !== -1;
              return (
                <li
                  key={agent.id}
                  role="option"
                  aria-selected={index === highlighted}
                  aria-disabled={isPickable ? undefined : "true"}
                  data-agent={agent.id}
                  title={agent.name}
                  // mousedown, not click: the prompt must keep focus.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (isPickable) onPickAgent?.(agent);
                  }}
                  className={`flex min-h-7 items-center gap-2 rounded-md px-2 ${
                    isPickable ? "cursor-pointer" : "cursor-default text-fg-secondary opacity-55"
                  } ${
                    index === highlighted
                      ? "bg-surface-hover text-fg"
                      : isPickable
                        ? "text-fg-secondary hover:bg-surface-hover"
                        : ""
                  }`}
                >
                  <AgentTile profileId={agent.id} name="" size={16} />
                  <span className="min-w-0 flex-1 truncate text-ui">
                    <Highlighted text={agent.name} query={query} />
                  </span>
                  <span
                    className={`ml-auto flex shrink-0 items-center gap-1.5 text-caption ${STATUS_CLASS[agent.status]}`}
                  >
                    {agent.status === "needs-sign-in" && (
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-status-attention" />
                    )}
                    {STATUS_TEXT[agent.status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {files.length > 0 && (
        <>
          {agents.length > 0 && <div aria-hidden="true" className="my-1 h-px bg-border" />}
          <p className="px-2 pb-1.5 pt-1 text-caption font-medium text-fg-muted">Files in {folderName}</p>
          <ul role="listbox" aria-label="Files to mention" className="max-h-64 overflow-y-auto">
            {files.map((path, index) => {
              const slash = path.lastIndexOf("/");
              const isHighlighted = pickableAgents.length + index === highlighted;
              return (
                <li
                  key={path}
                  role="option"
                  aria-selected={isHighlighted}
                  data-file={path}
                  title={path}
                  // mousedown, not click: the prompt must keep focus.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(path);
                  }}
                  className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 ${
                    isHighlighted ? "bg-surface-hover text-fg" : "text-fg-secondary hover:bg-surface-hover"
                  }`}
                >
                  <FileText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-subtle" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-ui-sm">
                      <Highlighted text={path.slice(slash + 1)} query={query} />
                    </span>
                    {slash > 0 && (
                      <span className="truncate font-mono text-caption leading-[15px] text-fg-subtle">
                        {path.slice(0, slash)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}