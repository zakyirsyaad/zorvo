import { SquarePlus } from "lucide-react";

export interface OpenedByLineProps {
  /** The agent of the session that opened this one. */
  agentName: string;
  /** That session's name. */
  sessionName: string;
  /** null when that session is gone. */
  openerSessionId: string | null;
  onOpen: (sessionId: string) => void;
  /** False in popouts, whose lines have no Open. */
  canAct: boolean;
}

const LINE = "flex items-center gap-2 text-ui-sm text-fg-muted";

/**
 * One quiet line above the first message of a session an agent opened, in the
 * place and look of a delegated session's line: who opened it, with Open, or
 * that the session which did is gone. It reports to nobody, so the line says
 * no more.
 */
export function OpenedByLine({ agentName, sessionName, openerSessionId, onOpen, canAct }: OpenedByLineProps) {
  const icon = <SquarePlus size={12} aria-hidden="true" className="shrink-0" />;
  if (openerSessionId === null) {
    return (
      <p role="note" className={LINE}>
        {icon}
        The session that opened this is gone.
      </p>
    );
  }
  return (
    <p role="note" className={LINE}>
      {icon}
      <span>
        Opened by {agentName} from {sessionName}
      </span>
      {canAct && (
        <button
          type="button"
          onClick={() => onOpen(openerSessionId)}
          className="rounded text-ui-sm text-fg-secondary underline underline-offset-2 hover:text-fg focus-ring"
        >
          Open
        </button>
      )}
    </p>
  );
}
