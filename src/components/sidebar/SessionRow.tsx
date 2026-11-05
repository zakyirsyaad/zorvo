import { useState } from "react";
import { GitBranch, Square } from "lucide-react";
import type { Session } from "../../types";
import { DOT_CLASS, SHOW_IN_ROW, rowDetail, rowSubtitle, statusOf } from "../../lib/sidebar-status";
import { AgentLogo } from "../AgentLogo";
import { IconButton } from "../ui/IconButton";
import { RenameField } from "../ui/RenameField";
import type { SessionListContext } from "./SessionList";
import { SessionMenu } from "./SessionMenu";

const ACTIONS = `${SHOW_IN_ROW} shrink-0 items-center gap-0.5 self-center pr-1.5`;

export interface SessionRowProps {
  session: Session;
  context: SessionListContext;
  /** A row of a run's group: it shows the agent's name, since every session of a run shares one title. */
  isInRun?: boolean;
}

/** The title's colour and weight: the open row in fg at 500, an unread one at 500, the rest fg-secondary. */
function titleClass(isActive: boolean, isUnread: boolean): string {
  if (isActive) return "font-medium text-fg";
  return isUnread ? "font-medium text-fg-secondary" : "text-fg-secondary";
}

/**
 * A two-line session row, top-aligned: the title, then the worktree mark, the agent's logo and
 * name, and the status in words. Its actions join the row on hover or focus, and the title gives way.
 */
export function SessionRow({ session, context, isInRun = false }: SessionRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const { onStopSession, onRenameSession } = context;
  const isActive = session.id === context.activeSessionId;
  const isBusy = context.isSessionBusy(session.id);
  const isWaiting = context.isSessionWaiting(session.id);
  const agentName = context.agentNameOf(session.profileId);
  const status = statusOf(isWaiting, isBusy, Boolean(session.hasUnread));
  const label = isInRun ? (agentName ?? session.profileId) : session.name;
  // A run member's title already names the agent.
  const lineAgent = isInRun ? undefined : agentName;
  const detail = rowDetail(status, session.createdAt);
  const isUnread = Boolean(session.hasUnread) && !isBusy;
  const words = `${lineAgent ? " · " : ""}${detail}${session.forkedFrom ? " · fork" : ""}`;

  if (isRenaming) {
    // The row keeps its fill and its dot, so it is plain which session the field renames.
    return (
      <div data-testid={`session-row-${session.id}`} className="flex items-start gap-2.5 rounded-md bg-surface-hover p-2">
        <span
          aria-hidden="true"
          className={`mt-2.5 size-1.5 shrink-0 rounded-full ${status ? DOT_CLASS[status.tone] : ""}`}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {/* A row of its own: the field's flex-1 is for its width, not its height. */}
          <span className="flex">
            <RenameField
              value={session.name}
              label={`Rename ${session.name}`}
              onDone={(name) => {
                setIsRenaming(false);
                const trimmed = name?.trim();
                if (trimmed && trimmed !== session.name) onRenameSession?.(session.id, trimmed);
              }}
            />
          </span>
          <span className="text-caption text-fg-subtle">Return saves, Esc cancels</span>
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid={`session-row-${session.id}`}
      className={`group relative flex items-start rounded-md transition-colors ${
        isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
      }`}
    >
      <button
        type="button"
        onClick={() => context.onSelectSession(session.id)}
        title={[session.name, rowSubtitle(agentName, status, session.createdAt), session.worktree?.branch]
          .filter(Boolean)
          .join(" · ")}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md p-2 text-left focus-ring"
      >
        <span
          aria-hidden="true"
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${status ? DOT_CLASS[status.tone] : ""}`}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`truncate text-ui ${titleClass(isActive, isUnread)}`}>{label}</span>
          {/* fg-subtle at rest, fg-muted on the surface-hover fill. The status words never truncate. */}
          <span
            className={`flex min-w-0 items-center gap-1 text-caption ${
              isActive ? "text-fg-muted" : "text-fg-subtle group-hover:text-fg-muted"
            }`}
          >
            {session.worktree && (
              <span role="img" aria-label="Runs in its own worktree" className="flex shrink-0">
                <GitBranch size={11} aria-hidden="true" />
              </span>
            )}
            {lineAgent && <AgentLogo profileId={session.profileId} name="" size={14} />}
            {lineAgent && <span className="truncate">{lineAgent}</span>}
            <span className="shrink-0 whitespace-pre">{words}</span>
          </span>
        </span>
      </button>
      <div data-testid="session-row-actions" className={ACTIONS}>
        {isBusy && onStopSession && (
          <IconButton label="Stop session" size="sm" tone="secondary" onClick={() => onStopSession(session.id)}>
            <Square size={12} />
          </IconButton>
        )}
        <SessionMenu
          session={session}
          label={label}
          isBusy={isBusy}
          isInRun={isInRun}
          context={context}
          onRename={() => setIsRenaming(true)}
        />
      </div>
    </div>
  );
}
