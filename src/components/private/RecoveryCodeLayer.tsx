import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import { RecoveryCodeDialog } from "./RecoveryCodeDialog";

export interface RecoveryCodeLayerProps {
  credits: Pick<PrivateCredits, "revealCode" | "markRecovery" | "needsRecoveryDialog">;
  /** A dialog asked for from Settings: the note on the balance, or a restore's new code. */
  request: { code?: string } | null;
  onClose: () => void;
}

/**
 * The one recovery-code dialog, drawn by the app so it shows wherever the user is: right after the
 * first top-up, when the balance's note asks for it, and after a restore. One layer means two
 * of these reasons can never stack two dialogs.
 */
export function RecoveryCodeLayer({ credits, request, onClose }: RecoveryCodeLayerProps) {
  if (!request && !credits.needsRecoveryDialog) return null;
  const initialCode = request?.code;
  return (
    <RecoveryCodeDialog
      // A restore's code replaces a dialog that is already open for the stored one.
      key={initialCode ?? "stored"}
      revealCode={credits.revealCode}
      markRecovery={credits.markRecovery}
      initialCode={initialCode}
      onClose={onClose}
    />
  );
}
