import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { AgentProfile } from "../../types";
import type { SessionGroup } from "../../lib/session-helpers";
import { folderSummary, REVEAL_ON_ROW, sessionsIn, type FolderSummary } from "../../lib/sidebar-status";
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

const SUMMARY_STYLE: Record<FolderSummary["tone"], { dot?: string; text: string }> = {
  attention: { dot: "bg-status-attention", text: "text-status-attention" },
  running: { dot: "bg-status-running", text: "text-fg-muted" },
  muted: { text: "text-fg-subtle" },
};

/** A folded folder's summary on the right: a dot for who waits or works, none for a plain count. */
function Summary({ summary }: { summary: FolderSummary }) {
  const style = SUMMARY_STYLE[summary.tone];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-caption">
      {style.dot && <span aria-hidden="true" className={`size-1.5 rounded-full ${style.dot}`} />}
      <span className={style.text}>{summary.text}</span>
    </span>
  );
}

/** The heading's look: open, a small muted label; folded, a 13px row. */
function headingClass(isOpen: boolean, isActive: boolean): string {
  if (!isOpen) return "text-ui text-fg-secondary hover:text-fg";
  return `text-caption font-medium hover:text-fg-secondary ${isActive ? "text-fg-secondary" : "text-fg-muted"}`;
}

/**
 * A folder's heading and its sessions. Open, it is a small muted label with the folder icon,
 * then the + and a fold chevron on the right; folded, a 32px row led by its chevron, with a summary.
 * The heading stays one button in both states, so focus stays on it when it folds.
 */
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
      <div className={`group flex items-center rounded-md pr-1 ${isOpen ? "h-7 gap-0.5" : "h-8 gap-1.5"}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          title={group.path}
          className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left transition-colors focus-ring ${headingClass(isOpen, isActive)}`}
        >
          {isOpen ? (
            <Folder size={12} aria-hidden="true" className="shrink-0" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-fg-subtle" />
          )}
          <span className="truncate">{group.name}</span>
        </button>
        {summary && <Summary summary={summary} />}
        {isOpen && (
          <span className="shrink-0 pr-1 text-caption text-fg-subtle">{sessionsIn(group.sessions).length}</span>
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
        {isOpen && (
          // A second, mouse-only target for folding: the heading itself is the control.
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-chevron=""
            onClick={onToggle}
            className={`flex size-5.5 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg-secondary ${REVEAL_ON_ROW}`}
          >
            <ChevronDown size={12} />
          </button>
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
