import { useState } from "react";
import { X } from "lucide-react";
import { explainTurnError } from "../lib/turn-error";
import { Button } from "./ui/Button";

export interface FailedTurnBannerProps {
  /** Undefined when the agent is no longer known: the text then says "The agent". */
  agentName?: string;
  error: string;
  /** A turn runs in the session: sending the last prompt again would race it. */
  isBusy: boolean;
  /** Sends the session's last prompt again; absent when there is none to send. */
  onRetry?: () => void;
  onDismiss: () => void;
}

/** The banner for a turn the agent failed: what happened, what to do, and a way to try again. */
export function FailedTurnBanner({ agentName, error, isBusy, onRetry, onDismiss }: FailedTurnBannerProps) {
  const [isShowingDetails, setIsShowingDetails] = useState(false);
  const { summary, hint, details } = explainTurnError(agentName, error);

  return (
    <div role="alert" className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3 rounded-lg border border-danger bg-danger-surface px-3 py-2 text-ui-sm text-danger">
      <div className="min-w-0 flex-1">
        <p className="break-words">
          {summary}
          {hint && ` ${hint}`}
        </p>
        {details && isShowingDetails && (
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] text-fg-secondary">{details}</pre>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} disabled={isBusy} className="px-2 py-1">
              Try again
            </Button>
          )}
          {details && (
            <button
              type="button"
              onClick={() => setIsShowingDetails((isShown) => !isShown)}
              aria-expanded={isShowingDetails}
              className="rounded px-1 text-danger underline hover:text-fg focus-ring"
            >
              {isShowingDetails ? "Hide details" : "Details"}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="shrink-0 rounded p-0.5 text-danger hover:text-fg focus-ring"
      >
        <X size={13} />
      </button>
    </div>
  );
}
