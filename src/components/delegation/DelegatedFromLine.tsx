import { Split } from "lucide-react";
import type { DelegationView } from "../../hooks/useDelegation";

export interface DelegatedFromLineProps {
  /** B's view of its source: the session that delegated it, and that session's agent. */
  view: DelegationView;
  onOpen: (sessionId: string) => void;
  /** False in popouts, whose lines have no Open. */
  canAct: boolean;
}

const LINE = "flex items-center gap-2 text-ui-sm text-fg-muted";

/** The delegate glyph, as the More menu's Delegate item has it. */
function DelegateIcon() {
  return <Split size={12} aria-hidden="true" className="shrink-0" />;
}

/**
 * B's one quiet line above its first message, as an imported session says where
 * its earlier messages are: who delegated it, with Open, or that the source
 * ended or is gone.
 */
export function DelegatedFromLine({ view, onOpen, canAct }: DelegatedFromLineProps) {
  if (view.state === "source-gone") {
    return (
      <p role="note" className={LINE}>
        <DelegateIcon />
        The session that delegated this is gone.
      </p>
    );
  }

  if (view.state === "ended") {
    return (
      <p role="note" className={LINE}>
        <DelegateIcon />
        <span>
          Delegated from {view.otherName} · ended
        </span>
      </p>
    );
  }

  const sessionId = view.otherSessionId;
  return (
    <p role="note" className={LINE}>
      <DelegateIcon />
      <span>
        Delegated from {view.otherName} · {view.agentName}
      </span>
      {canAct && sessionId !== null && (
        <button
          type="button"
          onClick={() => onOpen(sessionId)}
          className="rounded text-ui-sm text-fg-secondary underline underline-offset-2 hover:text-fg focus-ring"
        >
          Open
        </button>
      )}
    </p>
  );
}
