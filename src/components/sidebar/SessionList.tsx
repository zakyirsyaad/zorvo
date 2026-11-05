import type { SessionNode } from "../../lib/session-helpers";
import { RunGroupRow } from "./RunGroupRow";
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
      // A fork sits margin-left 11px, padding-left 10px behind its guide line, as drawn.
      className={isNested ? "ml-[11px] mt-0.5 space-y-0.5 border-l border-border pl-2.5" : "space-y-0.5"}
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
