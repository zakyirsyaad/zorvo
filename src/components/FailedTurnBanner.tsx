import { useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { explainTurnError } from "../lib/turn-error";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

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

/**
 * A turn the agent failed, as one row under its last message: what happened in fg, Try again
 * on the right, then Details and Dismiss. The details open under the row.
 */
export function FailedTurnBanner({ agentName, error, isBusy, onRetry, onDismiss }: FailedTurnBannerProps) {
  const [isShowingDetails, setIsShowingDetails] = useState(false);
  const { summary, hint, details } = explainTurnError(agentName, error);

  return (
    <div role="alert" className="mx-auto w-full max-w-chat rounded-lg border border-danger bg-danger-surface px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1 break-words text-ui text-fg">
          {summary}
          {hint && ` ${hint}`}
        </p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} disabled={isBusy} className="shrink-0">
            <span className="text-fg">Try again</span>
          </Button>
        )}
        {details && (
          <button
            type="button"
            onClick={() => setIsShowingDetails((isShown) => !isShown)}
            aria-expanded={isShowingDetails}
            className="shrink-0 rounded px-1 text-ui-sm text-fg-secondary underline hover:text-fg focus-ring"
          >
            {isShowingDetails ? "Hide details" : "Details"}
          </button>
        )}
        <IconButton label="Dismiss notice" size="sm" onClick={onDismiss}>
          <X size={12} />
        </IconButton>
      </div>
      {details && isShowingDetails && (
        <pre className="mt-2 whitespace-pre-wrap break-words pl-6 font-mono text-caption text-fg-secondary">{details}</pre>
      )}
    </div>
  );
}
