import { SWITCH_TEXT } from "../../lib/agent-switch";

export interface ContinuedFromView {
  /** The agent that took the conversation over: the session on screen's. */
  agentName: string;
  /** The session it came from, or null once that session is gone. */
  sourceName: string | null;
  onOpenSource?: () => void;
}

/** Where another agent took a conversation over: a line between hairlines above the new session's first message. */
export function ContinuedFromLine({ agentName, sourceName, onOpenSource }: ContinuedFromView) {
  return (
    <div role="note" className="flex w-full items-center gap-3 self-stretch text-caption text-fg-subtle">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="min-w-0 text-center">
        Continued with {agentName} from{" "}
        {sourceName !== null && onOpenSource ? (
          <button
            type="button"
            onClick={onOpenSource}
            className="rounded-sm text-fg-secondary underline underline-offset-2 focus-ring"
          >
            {sourceName}
          </button>
        ) : (
          (sourceName ?? SWITCH_TEXT.deletedSource)
        )}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
