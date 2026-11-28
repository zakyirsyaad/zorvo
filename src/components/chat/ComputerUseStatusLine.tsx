import { MousePointer2 } from "lucide-react";
import { STOP_COMPUTER_USE, usingLine, type ComputerUseGrant } from "../../lib/computer-use-card";
import { Button } from "../ui/Button";

export interface ComputerUseStatusLineProps {
  /** What the session may use; undefined while it holds no grant: the region stays mounted, empty. */
  grant: ComputerUseGrant | undefined;
  /** Ends the session's grants. Absent in a popout, whose line has no Stop. */
  onStop?: () => void;
}

/**
 * Under a session's messages while its agent may use apps on this Mac: which
 * apps, and the way to end it. The region is always mounted, so the line is
 * announced when it appears.
 */
export function ComputerUseStatusLine({ grant, onStop }: ComputerUseStatusLineProps) {
  if (!grant) return <div role="status" className="sr-only" />;
  return (
    <div role="status" className="mx-auto flex w-full max-w-chat items-center gap-2 py-1">
      <MousePointer2
        size={14}
        aria-hidden="true"
        className={`shrink-0 ${grant.fullScreen ? "text-status-attention" : "text-fg-muted"}`}
      />
      <span className="min-w-0 truncate text-ui text-fg-muted">{usingLine(grant)}</span>
      {onStop && (
        <Button variant="ghost" size="sm" tone="secondary" onClick={onStop}>
          {STOP_COMPUTER_USE}
        </Button>
      )}
    </div>
  );
}
