import { useState, type ReactNode } from "react";
import { ChevronRight, PanelLeft, Pin } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import { TOP_BAR_TRAFFIC_LIGHT_INSET_PX } from "./TopBar";
import { isInUse, type EnabledSettings } from "../lib/enabled-agents";
import type { AgentProfile, Session, Workspace } from "../types";
import { FolderGroup } from "./sidebar/FolderGroup";
import { SessionTree, type SessionListContext } from "./sidebar/SessionList";
import { SidebarFilter } from "./sidebar/SidebarFilter";
import { SidebarSearch } from "./sidebar/SidebarSearch";
import { filterCounts, matchesFilter, type SidebarFilter as FilterId } from "../lib/sidebar-status";
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

/** A list heading as the canvas draws it: sentence case, 11px, weight 500, muted. */
const HEADING = "flex items-center gap-1.5 px-1 text-caption font-medium text-fg-muted";

function matches(query: string, ...values: string[]): boolean {
  return query === "" || values.some((v) => v.toLowerCase().includes(query));
}

/** Finds a profile id's agent name for the search. */
type AgentNameOf = (profileId: string) => string | undefined;

/** A test of one node, with whether the node is a row of a run (named after its agent). */
type NodeTest = (node: SessionNode, isRunRow: boolean) => boolean;

/** True when the node or one of its forks passes the test. */
function nodeMatches(node: SessionNode, test: NodeTest, isRunRow = false): boolean {
  return test(node, isRunRow) || node.children.some((child) => nodeMatches(child, test, Boolean(node.run)));
}

/** Keeps the sessions that pass, with the sources of passing forks so the tree stays readable. */
function filterNodes(nodes: SessionNode[], test: NodeTest, isRunRow = false): SessionNode[] {
  return nodes
    .filter((node) => nodeMatches(node, test, isRunRow))
    .map((node) => ({ ...node, children: filterNodes(node.children, test, Boolean(node.run)) }));
}

/** The search as a node test: a run's rows are named after their agent, so they match by that name too. */
function searchTest(query: string, agentNameOf: AgentNameOf): NodeTest {
  return ({ session }, isRunRow) =>
    isRunRow ? matches(query, session.name, agentNameOf(session.profileId) ?? session.profileId) : matches(query, session.name);
}

/** The groups to show for a search: a folder that matches keeps all its sessions. */
function searchGroups(groups: SessionGroup[], query: string, agentNameOf: AgentNameOf): SessionGroup[] {
  if (query === "") return groups;
  const test = searchTest(query, agentNameOf);
  return groups
    .map((group) =>
      matches(query, group.name, group.path) ? group : { ...group, sessions: filterNodes(group.sessions, test) },
    )
    .filter((group) => group.sessions.length > 0 || matches(query, group.name, group.path));
}

/** The groups to show for a filter: only the sessions it keeps, and no folder left empty. */
function filterGroups(groups: SessionGroup[], filter: FilterId, test: NodeTest): SessionGroup[] {
  if (filter === "all") return groups;
  return groups
    .map((group) => ({ ...group, sessions: filterNodes(group.sessions, test) }))
    .filter((group) => group.sessions.length > 0);
}

const EMPTY_FILTER_TEXT: Record<Exclude<FilterId, "all">, string> = {
  "needs-you": "No sessions need you.",
  working: "No sessions are working.",
};

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
  const [filter, setFilter] = useState<FilterId>("all");
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const query = searchQuery.trim().toLowerCase();

  // Pinned sessions sit on top and archived ones at the bottom, out of their workspace.
  // A pinned session of a run stays in the run's group instead, so it is not listed twice.
  const runs = compareRuns(sessions);
  const runMemberIds = new Set(runs.flatMap((run) => run.sessions.map((s) => s.id)));
  const listed = sessions.filter((s) => !isArchived(s) && (!isShownPinned(s) || runMemberIds.has(s.id)));
  const agentNameOf: AgentNameOf = (profileId) => agents.find((agent) => agent.id === profileId)?.name;
  // The filter narrows first, then the search; neither changes which session is open.
  const filterTest: NodeTest = ({ session }) => matchesFilter(session, filter, isSessionWaiting, isSessionBusy);
  const groups = searchGroups(
    filterGroups(groupSessionsByWorkspace(workspaces, listed, runs), filter, filterTest),
    query,
    agentNameOf,
  );
  const counts = filterCounts(sessions, isSessionWaiting, isSessionBusy);
  const asNodes = (list: Session[]) => list.map((session) => ({ session, children: [] }));
  // Like a listed session, one is found by its own name or its project's.
  const isFound = (s: Session) => matches(query, s.name, folderNameOf(workspacePathOf(s)), workspacePathOf(s));
  const pinned = sessions
    .filter(
      (s) =>
        isShownPinned(s) &&
        !runMemberIds.has(s.id) &&
        matchesFilter(s, filter, isSessionWaiting, isSessionBusy) &&
        isFound(s),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  // Archived shows only under All.
  const archived = sessions
    .filter((s) => filter === "all" && isArchived(s) && isFound(s))
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const detectedAgents = agents.filter((agent) => agent.detected && isInUse(agent, settings));
  const isArchiveShown = isArchiveOpen || query !== "";
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
      className="w-66 shrink-0 flex flex-col justify-between select-none text-ui text-fg-secondary"
    >
      {/* The window's own buttons float in this header's inset; the rest of it drags the window. */}
      <div
        data-tauri-drag-region
        style={{ paddingLeft: TOP_BAR_TRAFFIC_LIGHT_INSET_PX }}
        className="mt-2 flex h-12 shrink-0 items-center justify-end pr-3"
      >
        {onHide && (
          <IconButton label="Hide sidebar" onClick={onHide}>
            <PanelLeft size={14} />
          </IconButton>
        )}
      </div>
      <div className="px-3 pb-2">
        <SidebarSearch query={searchQuery} onQueryChange={setSearchQuery} onNewSession={onNewSession} />
      </div>
      <div className="px-3 pb-2">
        <SidebarFilter value={filter} counts={counts} onChange={setFilter} />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-3">
        {pinned.length > 0 && (
          <section className="mb-4">
            <div className={`${HEADING} mb-1.5`}>
              <Pin size={12} aria-hidden="true" />
              <span>Pinned</span>
            </div>
            <SessionTree nodes={asNodes(pinned)} label="Pinned sessions" context={context} />
          </section>
        )}
        {groups.length === 0 && pinned.length === 0 && archived.length === 0 && (
          <p className="px-2 py-1 text-caption text-fg-subtle">
            {query
              ? "Nothing matches your search."
              : filter !== "all"
                ? EMPTY_FILTER_TEXT[filter]
                : "No folders yet. Open one to start."}
          </p>
        )}
        <ul aria-label="Workspaces" className="space-y-3">
          {groups.map((group) => (
            <FolderGroup
              key={group.path}
              group={group}
              isActive={group.path === activeWorkspacePath}
              isFolded={collapsedPaths.has(group.path)}
              isForcedOpen={query !== "" || filter !== "all"}
              onToggle={() => toggle(group.path)}
              context={context}
              agents={detectedAgents}
              defaultAgentId={defaultAgentId}
              onNewSessionIn={onNewSessionIn}
            />
          ))}
        </ul>
        {archived.length > 0 && (
          <>
            {/* Pushes Archived to the bottom of the list while the list is short. */}
            <div aria-hidden="true" className="min-h-4 flex-1" />
            <section>
              <button
                type="button"
                onClick={() => setIsArchiveOpen((open) => !open)}
                // A search shows its matches whether the section is folded or not.
                disabled={query !== ""}
                aria-expanded={isArchiveShown}
                aria-label={`Archived (${archived.length})`}
                className={`${HEADING} w-full rounded hover:text-fg-secondary focus-ring`}
              >
                <ChevronRight
                  size={11}
                  aria-hidden="true"
                  className={`transition-transform ${isArchiveShown ? "rotate-90" : ""}`}
                />
                <span>Archived</span>
                <span className="font-normal text-fg-subtle">{archived.length}</span>
              </button>
              {isArchiveShown && (
                <div className="mt-1.5">
                  <SessionTree nodes={asNodes(archived)} label="Archived sessions" context={context} />
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* The footer draws its own top border and surface; a wrapper here would double them. */}
      {footer}
    </aside>
  );
}
