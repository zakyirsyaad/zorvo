import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import type { RecoveryRequest } from "../../hooks/usePrivateRecoveryDialog";
import { RecoveryCodeDialog } from "./RecoveryCodeDialog";

export interface RecoveryCodeLayerProps {
  credits: Pick<PrivateCredits, "revealCode" | "markRecovery" | "needsRecoveryDialog">;
  /** A dialog asked for from Settings: the note on the balance, or a restore's new code. */
  request: RecoveryRequest | null;
  /** A restore is under way or its new code is showing: the status must not open a second dialog. */
  suppressStatusPrompt: boolean;
  onClose: () => void;
}

/**
 * The one recovery-code dialog, drawn by the app so it shows wherever the user is: right after the
 * first top-up, when the balance's note asks for it, and after a restore. At most one is ever
 * mounted: a request wins, and the status-driven prompt waits while a restore is on screen.
 */
export function RecoveryCodeLayer({ credits, request, suppressStatusPrompt, onClose }: RecoveryCodeLayerProps) {
  if (request) {
    return (
      <RecoveryCodeDialog
        key={`request-${request.id}`}
        revealCode={credits.revealCode}
        markRecovery={credits.markRecovery}
        initialCode={request.code}
        onClose={onClose}
      />
    );
  }
  if (!credits.needsRecoveryDialog || suppressStatusPrompt) return null;
  return (
    <RecoveryCodeDialog
      key="status"
      revealCode={credits.revealCode}
      markRecovery={credits.markRecovery}
      onClose={onClose}
    />
  );
}
