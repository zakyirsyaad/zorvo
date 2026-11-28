import { useState, type ReactNode } from "react";
import { ContinueOutsideTeeDialog, type ContinueChoice } from "../components/private/ContinueOutsideTeeDialog";

interface Pending {
  agent: ContinueChoice;
  onConfirm: () => void;
}

/**
 * Asks before a private session's conversation goes to an agent the user already picked, outside the TEE.
 * `ask` shows the dialog; `dialog` is what the host renders (nothing while no question is open).
 */
export function useOutsideTeeConfirm(): { ask: (agent: ContinueChoice, onConfirm: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = pending ? (
    <ContinueOutsideTeeDialog
      agents={[pending.agent]}
      isPicked
      onCancel={() => setPending(null)}
      onConfirm={() => {
        setPending(null);
        pending.onConfirm();
      }}
    />
  ) : null;
  return { ask: (agent, onConfirm) => setPending({ agent, onConfirm }), dialog };
}
