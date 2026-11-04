import { GitCompare } from "lucide-react";
import type { SessionNode } from "../../lib/session-helpers";
import { DOT_CLASS, statusOf } from "../../lib/sidebar-status";
import { SessionRow } from "./SessionRow";

/** What every session row needs besides its own session. */
export interface SessionListContext {
  activeSessionId?: string;
  /** The compare run whose panel is open. */
  activeRunId?: string;
  agentNameOf: (profileId: string) => string | undefined;
  isSessionBusy: (sessionId: string) => boolean;
  isSessionWaiting: (sessionId: string) => boolean;
  onSelectSession: (sessionId: string) => void;
  /** Opens a compare run's panel; a run's group is a plain label when absent. */
  onOpenRun?: (runId: string) => void;
  onStopSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, name: string) => void;
  onPinSession?: (sessionId: string, isPinned: boolean) => void;
  onArchiveSession?: (sessionId: string, isArchived: boolean) => void;
}

/** A run's heading: opens the run's panel, and shows the run's busiest state. */
function RunGroupRow({ node, context }: { node: SessionNode; context: SessionListContext }) {
  const run = node.run;
  if (!run) return null;
  const members = node.children.map((child) => child.session);
  const status = statusOf(
    members.some((member) => context.isSessionWaiting(member.id)),
    members.some((member) => context.isSessionBusy(member.id)),
    members.some((member) => member.hasUnread),
  );
  const isActive = context.activeRunId === run.id;
  // Counted from the run, not from the rows a search leaves.
  const countLabel = `${run.sessions.length} agents`;
  return (
    <div
      data-testid={`run-group-${run.id}`}
      className={`relative flex items-center rounded-md transition-colors ${
        isActive
          ? "bg-surface-hover text-fg font-medium"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg-secondary"
      }`}
    >
      <button
        type="button"
        onClick={() => context.onOpenRun?.(run.id)}
        aria-current={isActive ? "true" : undefined}
        title={[run.name, countLabel, status?.label].filter(Boolean).join(" · ")}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 pr-6 text-left focus-ring"
      >
        <GitCompare size={12} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{run.name}</span>
        <span className="shrink-0 text-[10px] text-fg-subtle">{countLabel}</span>
      </button>
      {status && (
        <span
          role="status"
          aria-label={status.label}
          className={`pointer-events-none absolute right-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[status.tone]} ${
            status.pulse ? "animate-pulse motion-reduce:animate-none" : ""
          }`}
        />
      )}
    </div>
  );
}

/** Sessions with their forks nested beneath them, joined by a guide line. */
export function SessionTree({ nodes, label, context, isNested = false, isInRun = false }: {
  nodes: SessionNode[];
  label: string;
  context: SessionListContext;
  isNested?: boolean;
  /** The nodes are a run's sessions: their rows name the agent. */
  isInRun?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      className={isNested ? "ml-3 mt-0.5 space-y-0.5 border-l border-border pl-1.5" : "space-y-0.5"}
    >
      {nodes.map((node) => {
        const { session, children, run } = node;
        if (run) {
          return (
            <li key={`run-${run.id}`}>
              <RunGroupRow node={node} context={context} />
              {children.length > 0 && (
                <SessionTree nodes={children} label={`Agents in ${run.name}`} context={context} isNested isInRun />
              )}
            </li>
          );
        }
        return (
          <li key={session.id}>
            <SessionRow session={session} context={context} isInRun={isInRun} />
            {children.length > 0 && (
              <SessionTree nodes={children} label={`Forks of ${session.name}`} context={context} isNested />
            )}
          </li>
        );
      })}
    </ul>
  );
}
