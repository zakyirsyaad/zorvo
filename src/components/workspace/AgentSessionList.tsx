import { Button } from '../ui/Button';
import { formatRelativeTime } from '../../lib/relative-time';
import type { SessionListState } from '../../hooks/useAgentSessionList';
import type { ListedSession } from '../../lib/session-list';

export interface AgentSessionListProps {
  /** The agent the draft would start, named in every line. */
  agentName: string;
  state: SessionListState;
  /** Why the last import failed; kept apart from the list's own state. */
  importError: string | null;
  onLoad: () => void;
  onImport: (listed: ListedSession) => void;
}

/** A session's `updatedAt` as how long ago it was; nothing when it has no readable date. */
function relativeTime(updatedAt: string | undefined): string | null {
  if (!updatedAt) return null;
  const time = Date.parse(updatedAt);
  return Number.isNaN(time) ? null : formatRelativeTime(time);
}

/**
 * One of the agent's sessions, as the canvas draws it: a plain 44px row with its title and time, and Continue
 * on the hovered or focused row. The row is the one button; Continue only says what it does.
 */
function SessionRow({ listed, onImport }: { listed: ListedSession; onImport: (listed: ListedSession) => void }) {
  const time = relativeTime(listed.updatedAt);
  return (
    <button
      type="button"
      onClick={() => onImport(listed)}
      className="group focus-ring flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-ui text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
    >
      <span className="min-w-0 flex-1 truncate">{listed.title ?? 'Untitled session'}</span>
      {time && <span className="shrink-0 text-caption text-fg-subtle group-hover:text-fg-muted">{time}</span>}
      <span
        aria-hidden="true"
        className="hidden h-6.5 shrink-0 items-center rounded-md border border-border-strong px-2.5 text-ui-sm text-fg group-hover:inline-flex group-focus-visible:inline-flex"
      >
        Continue
      </span>
    </button>
  );
}

/**
 * The new-session draft's list of the agent's other sessions in the folder:
 * the button that asks for them, the states while it does, and one row per
 * session that opens it.
 */
export function AgentSessionList({ agentName, state, importError, onLoad, onImport }: AgentSessionListProps) {
  return (
    <div className="space-y-2">
      {state.kind === 'idle' && <Button onClick={onLoad}>Continue a session from {agentName}</Button>}

      {state.kind === 'loading' && (
        <p role="status" className="text-ui text-fg-muted">
          Asking {agentName} for its sessions…
        </p>
      )}

      {state.kind === 'loaded' && (
        <>
          {state.sessions.length === 0 ? (
            <p className="text-ui text-fg-muted">{agentName} has no other sessions in this folder.</p>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-3 pb-1.5">
                <span className="flex-1 text-caption font-medium text-fg-muted">Continue a session from {agentName}</span>
                <span className="text-caption text-fg-subtle">{state.sessions.length} in this folder</span>
              </div>
              <ul className="flex flex-col gap-1">
                {state.sessions.map((listed) => (
                  <li key={listed.acpSessionId}>
                    <SessionRow listed={listed} onImport={onImport} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.truncated && <p className="text-caption text-fg-muted">Showing the 200 most recent sessions.</p>}
          {state.incomplete && <p className="text-caption text-fg-muted">Some sessions could not be listed.</p>}
        </>
      )}

      {state.kind === 'failed' && (
        <div className="space-y-2">
          <p role="alert" className="text-ui text-danger">
            {state.message}
          </p>
          <Button onClick={onLoad}>Try again</Button>
        </div>
      )}

      {importError && (
        <p role="alert" className="text-ui text-danger">
          {importError}
        </p>
      )}
    </div>
  );
}