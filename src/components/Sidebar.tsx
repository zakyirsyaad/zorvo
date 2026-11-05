import { useState, type ReactNode } from "react";
import { Search, Plus, FolderPlus, ChevronRight, PanelLeft } from "lucide-react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { TOP_BAR_TRAFFIC_LIGHT_INSET_PX } from "./TopBar";
import { isInUse, type EnabledSettings } from "../lib/enabled-agents";
import type { AgentProfile, Session, Workspace } from "../types";
import { FolderGroup } from "./sidebar/FolderGroup";
import { SessionTree, type SessionListContext } from "./sidebar/SessionList";
import { compareRuns } from "../lib/compare-run";
import {
  folderNameOf,
  groupSessionsByWorkspace,
  isArchived,
  isShownPinned,
  workspacePathOf,
  type SessionGroup,
  type SessionNode,
} from "../lib/session-helpers";

export interface SidebarProps {
  workspaces: Workspace[];
  activeWorkspacePath?: string;
  sessions: Session[];
  activeSessionId?: string;
  /** The compare run whose panel is open. */
  activeRunId?: string | null;
  agents: AgentProfile[];
  /** Decides which agents a folder's + offers; the defaults apply when absent. */
  settings?: EnabledSettings;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  /** Opens a compare run's panel. */
  onOpenRun?: (runId: string) => void;
  /** Opens a new session in that folder with that agent; each workspace's + button is hidden when absent. */
  onNewSessionIn?: (path: string, agentId: string) => void;
  /** The agent the + menu marks as the default. */
  defaultAgentId?: string;
  /** Opens the native folder dialog; the button is hidden when absent. */
  onOpenFolder?: () => void;
  /** True while a session's agent is working on a turn. */
  isSessionBusy?: (sessionId: string) => boolean;
  /** True while a session's agent waits for the user to answer a permission request. */
  isSessionWaiting?: (sessionId: string) => boolean;
  /** Stops the agent's current turn; offered only while it works. */
  onStopSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  /** Each is offered in a session's ⋯ menu when given. */
  onRenameSession?: (sessionId: string, name: string) => void;
  onPinSession?: (sessionId: string, isPinned: boolean) => void;
  onArchiveSession?: (sessionId: string, isArchived: boolean) => void;
  /** Bottom bar content, e.g. the user's profile. */
  footer?: ReactNode;
  /** Hidden, the sidebar stays mounted, so its folds and its search are there when it comes back. */
  isHidden?: boolean;
  /** Hides the sidebar; the button is absent without it. */
  onHide?: () => void;
}

const SECTION_HEADER_TEXT =
  "flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-fg-subtle px-1";
const SECTION_HEADER = `${SECTION_HEADER_TEXT} mb-1.5`;

function matches(query: string, ...values: string[]): boolean {
  return query === "" || values.some((v) => v.toLowerCase().includes(query));
}

/** Finds a profile id's agent name for the search. */
type AgentNameOf = (profileId: string) => string | undefined;

/**
 * True when the session or one of its forks matches the search. A run's rows are
 * named after their agent, so they match by that name too.
 */
function nodeMatches(node: SessionNode, query: string, agentNameOf: AgentNameOf, isRunRow = false): boolean {
  const { session } = node;
  const own = isRunRow
    ? matches(query, session.name, agentNameOf(session.profileId) ?? session.profileId)
    : matches(query, session.name);
  return own || node.children.some((child) => nodeMatches(child, query, agentNameOf, Boolean(node.run)));
}

/** Keeps the sessions that match, with the sources of matching forks so the tree stays readable. */
function filterNodes(nodes: SessionNode[], query: string, agentNameOf: AgentNameOf, isRunRow = false): SessionNode[] {
  return nodes
    .filter((node) => nodeMatches(node, query, agentNameOf, isRunRow))
    .map((node) => ({ ...node, children: filterNodes(node.children, query, agentNameOf, Boolean(node.run)) }));
}

/** The groups to show for a search: a folder that matches keeps all its sessions. */
function searchGroups(groups: SessionGroup[], query: string, agentNameOf: AgentNameOf): SessionGroup[] {
  if (query === "") return groups;
  return groups
    .map((group) =>
      matches(query, group.name, group.path)
        ? group
        : { ...group, sessions: filterNodes(group.sessions, query, agentNameOf) },
    )
    .filter((group) => group.sessions.length > 0 || matches(query, group.name, group.path));
}

export function Sidebar({
  workspaces,
  activeWorkspacePath,
  sessions,
  activeSessionId,
  activeRunId,
  agents,
  settings = {},
  onNewSession,
  onSelectSession,
  onOpenRun,
  onNewSessionIn,
  defaultAgentId,
  onOpenFolder,
  isSessionBusy = () => false,
  isSessionWaiting = () => false,
  onStopSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  onArchiveSession,
  footer,
  isHidden = false,
  onHide,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const query = searchQuery.trim().toLowerCase();

  // Pinned sessions sit on top and archived ones at the bottom, out of their workspace.
  // A pinned session of a run stays in the run's group instead, so it is not listed twice.
  const runs = compareRuns(sessions);
  const runMemberIds = new Set(runs.flatMap((run) => run.sessions.map((s) => s.id)));
  const listed = sessions.filter((s) => !isArchived(s) && (!isShownPinned(s) || runMemberIds.has(s.id)));
  const agentNameOf: AgentNameOf = (profileId) => agents.find((agent) => agent.id === profileId)?.name;
  const groups = searchGroups(groupSessionsByWorkspace(workspaces, listed, runs), query, agentNameOf);
  const asNodes = (list: Session[]) => list.map((session) => ({ session, children: [] }));
  // Like a listed session, one is found by its own name or its project's.
  const isFound = (s: Session) => matches(query, s.name, folderNameOf(workspacePathOf(s)), workspacePathOf(s));
  const pinned = sessions
    .filter((s) => isShownPinned(s) && !runMemberIds.has(s.id) && isFound(s))
    .sort((a, b) => b.createdAt - a.createdAt);
  const archived = sessions
    .filter((s) => isArchived(s) && isFound(s))
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const detectedAgents = agents.filter((agent) => agent.detected && isInUse(agent, settings));
  const toggle = (path: string) =>
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const context: SessionListContext = {
    activeSessionId,
    activeRunId: activeRunId ?? undefined,
    agentNameOf,
    isSessionBusy,
    isSessionWaiting,
    onSelectSession,
    onOpenRun,
    onStopSession,
    onDeleteSession,
    onRenameSession,
    onPinSession,
    onArchiveSession,
  };

  return (
    <aside
      hidden={isHidden}
      className="w-64 shrink-0 flex flex-col justify-between border-r border-border bg-surface-1 select-none text-xs text-fg-secondary"
    >
      {/* The window's own buttons float in this header's inset; the rest of it drags the window. */}
      <div
        data-tauri-drag-region
        style={{ paddingLeft: TOP_BAR_TRAFFIC_LIGHT_INSET_PX }}
        className="flex h-12 shrink-0 items-center justify-end pr-3"
      >
        {onHide && (
          <IconButton label="Hide sidebar" onClick={onHide}>
            <PanelLeft size={14} />
          </IconButton>
        )}
      </div>
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <Button variant="outline" icon={<Plus size={13} />} onClick={onNewSession}>
          New session
        </Button>
        <div className="relative">
          <Search
            size={13}
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
            className="w-full rounded-md bg-surface-2 border border-border-strong py-1.5 pl-8 pr-3 text-ui text-fg-secondary placeholder-fg-subtle focus-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {pinned.length > 0 && (
          <section className="mb-4">
            <div className={SECTION_HEADER}>
              <span>Pinned</span>
            </div>
            <SessionTree nodes={asNodes(pinned)} label="Pinned sessions" context={context} />
          </section>
        )}
        <div className={SECTION_HEADER}>
          <span>Workspaces</span>
          {onOpenFolder && (
            <button
              type="button"
              aria-label="Open folder"
              title="Open a project folder"
              onClick={onOpenFolder}
              className="rounded p-0.5 text-fg-subtle hover:text-fg-secondary focus-ring"
            >
              <FolderPlus size={13} />
            </button>
          )}
        </div>
        {groups.length === 0 && pinned.length === 0 && archived.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-fg-subtle">
            {query ? "Nothing matches your search." : "No folders yet. Open one to start."}
          </p>
        )}
        <ul aria-label="Workspaces" className="space-y-3">
          {groups.map((group) => (
            <FolderGroup
              key={group.path}
              group={group}
              isActive={group.path === activeWorkspacePath}
              isFolded={collapsedPaths.has(group.path)}
              isForcedOpen={query !== ""}
              onToggle={() => toggle(group.path)}
              context={context}
              agents={detectedAgents}
              defaultAgentId={defaultAgentId}
              onNewSessionIn={onNewSessionIn}
            />
          ))}
        </ul>
        {archived.length > 0 && (
          <section className="mt-4">
            <button
              type="button"
              onClick={() => setIsArchiveOpen((open) => !open)}
              // A search shows its matches whether the section is folded or not.
              disabled={query !== ""}
              aria-expanded={isArchiveOpen || query !== ""}
              className="flex w-full items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg-secondary"
            >
              <ChevronRight
                size={11}
                aria-hidden="true"
                className={`transition-transform ${isArchiveOpen || query !== "" ? "rotate-90" : ""}`}
              />
              {`Archived (${archived.length})`}
            </button>
            {(isArchiveOpen || query !== "") && (
              <div className="mt-1.5">
                <SessionTree nodes={asNodes(archived)} label="Archived sessions" context={context} />
              </div>
            )}
          </section>
        )}
      </div>

      {footer && <div className="border-t border-border bg-bg">{footer}</div>}
    </aside>
  );
}
