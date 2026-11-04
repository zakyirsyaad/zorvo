import { useState } from "react";
import { GitBranch, Square } from "lucide-react";
import type { Session } from "../../types";
import { DOT_CLASS, REVEAL_ON_ROW, rowDetail, rowSubtitle, statusOf } from "../../lib/sidebar-status";
import { IconButton } from "../ui/IconButton";
import { RenameField } from "../ui/RenameField";
import type { SessionListContext } from "./SessionList";
import { SessionMenu } from "./SessionMenu";

const ACTIONS = `absolute inset-y-0 right-1 flex items-center gap-0.5 rounded-md bg-surface-hover pl-1 ${REVEAL_ON_ROW}`;

export interface SessionRowProps {
  session: Session;
  context: SessionListContext;
  /** A row of a run's group: it shows the agent's name, since every session of a run shares one title. */
  isInRun?: boolean;
}

/** A 44px, two-line session row: the title, then the agent and the status in words; its actions show on hover or focus. */
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

  if (isRenaming) {
    return (
      <div className="flex h-11 items-center">
        <RenameField
          value={session.name}
          label={`Rename ${session.name}`}
          className="mx-1"
          onDone={(name) => {
            setIsRenaming(false);
            const trimmed = name?.trim();
            if (trimmed && trimmed !== session.name) onRenameSession?.(session.id, trimmed);
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`session-row-${session.id}`}
      className={`group relative flex h-11 items-center rounded-md transition-colors ${
        isActive ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg-secondary"
      }`}
    >
      <button
        type="button"
        onClick={() => context.onSelectSession(session.id)}
        title={[session.name, rowSubtitle(agentName, status, session.createdAt), session.worktree?.branch]
          .filter(Boolean)
          .join(" · ")}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-ring"
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${status ? DOT_CLASS[status.tone] : ""} ${
            status?.pulse ? "motion-safe:animate-pulse" : ""
          }`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate text-ui ${isUnread ? "font-medium text-fg" : ""}`}>{label}</span>
          {/* fg-muted, not fg-subtle: the open and hovered rows fill surface-hover. The status words never truncate. */}
          <span className="flex min-w-0 text-caption text-fg-muted">
            {lineAgent && <span className="truncate">{lineAgent}</span>}
            <span className="shrink-0 whitespace-pre">{lineAgent ? ` · ${detail}` : detail}</span>
          </span>
        </span>
        {session.worktree && (
          <span role="img" aria-label="Runs in its own worktree" className="flex shrink-0 text-fg-subtle">
            <GitBranch size={12} aria-hidden="true" />
          </span>
        )}
      </button>
      <div data-testid="session-row-actions" className={ACTIONS}>
        {isBusy && onStopSession && (
          <IconButton label="Stop session" onClick={() => onStopSession(session.id)}>
            <Square size={11} />
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
