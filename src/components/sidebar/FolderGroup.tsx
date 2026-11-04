import { ChevronRight, Folder } from "lucide-react";
import type { AgentProfile } from "../../types";
import type { SessionGroup } from "../../lib/session-helpers";
import { folderSummary, REVEAL_ON_ROW, sessionsIn } from "../../lib/sidebar-status";
import { NewSessionMenu } from "./NewSessionMenu";
import { SessionTree, type SessionListContext } from "./SessionList";

export interface FolderGroupProps {
  group: SessionGroup;
  /** The folder of the session on screen. */
  isActive: boolean;
  isFolded: boolean;
  /** A search shows every match, folded or not. */
  isForcedOpen: boolean;
  onToggle: () => void;
  context: SessionListContext;
  /** The agents the + menu offers. */
  agents: readonly AgentProfile[];
  defaultAgentId?: string;
  /** Opens a new session in this folder; the + is hidden when absent. */
  onNewSessionIn?: (path: string, agentId: string) => void;
}

/** A folder's heading, which folds its sessions away and says what they are doing while folded, and its sessions. */
export function FolderGroup({
  group,
  isActive,
  isFolded,
  isForcedOpen,
  onToggle,
  context,
  agents,
  defaultAgentId,
  onNewSessionIn,
}: FolderGroupProps) {
  const isOpen = isForcedOpen || !isFolded;
  const summary = isOpen
    ? null
    : folderSummary(sessionsIn(group.sessions), context.isSessionWaiting, context.isSessionBusy);
  return (
    <li>
      <div className="group flex h-8 items-center gap-1 rounded-md pr-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          title={group.path}
          className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-ui-sm transition-colors hover:text-fg-secondary focus-ring ${
            isActive ? "text-fg-secondary" : "text-fg-subtle"
          }`}
        >
          <Folder size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{group.name}</span>
          <ChevronRight
            size={12}
            aria-hidden="true"
            data-chevron=""
            className={`shrink-0 transition-transform ${
              isOpen ? "rotate-90 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : ""
            }`}
          />
        </button>
        {summary && (
          <span
            className={`shrink-0 text-caption ${summary.tone === "attention" ? "text-status-attention" : "text-fg-subtle"}`}
          >
            {summary.text}
          </span>
        )}
        {onNewSessionIn && (
          <span data-testid="folder-actions" className={`flex shrink-0 ${REVEAL_ON_ROW}`}>
            <NewSessionMenu
              folderName={group.name}
              agents={agents}
              defaultAgentId={defaultAgentId}
              onPick={(agentId) => onNewSessionIn(group.path, agentId)}
            />
          </span>
        )}
      </div>
      {isOpen && group.sessions.length > 0 && (
        <div className="mt-0.5">
          <SessionTree nodes={group.sessions} label={`Sessions in ${group.name}`} context={context} />
        </div>
      )}
    </li>
  );
}
