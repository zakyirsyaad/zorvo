import { useRef, useState } from "react";
import { GitBranch, Square } from "lucide-react";
import type { Session } from "../../types";
import { DOT_CLASS, rowSubtitle, statusOf } from "../../lib/sidebar-status";
import { IconButton } from "../ui/IconButton";
import type { SessionListContext } from "./SessionList";
import { SessionMenu } from "./SessionMenu";

const ACTIONS =
  "absolute inset-y-0 right-1 flex items-center gap-0.5 rounded-md bg-surface-hover pl-1 opacity-0 pointer-events-none transition-opacity " +
  "group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto";

/** The name field a session's row turns into while it is renamed. */
function RenameField({ session, onDone }: { session: Session; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(session.name);
  // Enter, Escape and the blur that follows them finish once.
  const isDoneRef = useRef(false);
  const finish = (value: string | null) => {
    if (isDoneRef.current) return;
    isDoneRef.current = true;
    onDone(value);
  };
  return (
    <input
      autoFocus
      onFocus={(e) => e.target.select()}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(name);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(name)}
      aria-label={`Rename ${session.name}`}
      className="mx-1 min-w-0 flex-1 rounded border border-border-strong bg-surface-2 px-1.5 py-1 text-ui text-fg focus-ring"
    />
  );
}

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
  const subtitle = rowSubtitle(isInRun ? undefined : agentName, status, session.createdAt);
  const isUnread = Boolean(session.hasUnread) && !isBusy;

  if (isRenaming) {
    return (
      <div className="flex h-11 items-center">
        <RenameField
          session={session}
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
        title={[session.name, agentName, session.worktree?.branch, status?.label].filter(Boolean).join(" · ")}
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
          <span className="truncate text-caption text-fg-subtle">{subtitle}</span>
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
