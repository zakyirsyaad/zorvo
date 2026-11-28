import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { PrivateDialog } from "./PrivateDialog";

export interface ContinueChoice {
  id: string;
  name: string;
}

export interface ContinueOutsideTeeDialogProps {
  /** The agents the conversation may go on with. */
  agents: readonly ContinueChoice[];
  /** The agent was already picked (the composer's agent menu, the Fork menu): ask only to confirm it. */
  isPicked?: boolean;
  onCancel: () => void;
  onConfirm: (agentId: string) => void;
}

/**
 * Asks before a private session's conversation goes to another agent, outside the TEE: from the credits-out
 * card (a pick among the agents in use), the composer's agent menu or the Fork menu (one agent already picked).
 */
export function ContinueOutsideTeeDialog({ agents, isPicked = false, onCancel, onConfirm }: ContinueOutsideTeeDialogProps) {
  const [picked, setPicked] = useState(agents[0]?.id ?? "");
  const firstRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const warningId = useId();
  const only = isPicked && agents.length === 1 ? agents[0] : undefined;
  return (
    <PrivateDialog
      title="Continue with another agent?"
      initialFocusRef={only ? continueRef : firstRef}
      describedBy={warningId}
      onEscape={onCancel}
      footer={
        <>
          <Button variant="ghost" tone="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={continueRef} variant="primary" disabled={picked === ""} onClick={() => onConfirm(picked)}>
            Continue
          </Button>
        </>
      }
    >
      {only ? (
        <p id={warningId} className="text-ui text-fg-muted">
          {only.name} gets the conversation so far, outside the TEE.
        </p>
      ) : (
        <>
          <p id={warningId} className="text-ui text-fg-muted">
            The conversation so far goes to the agent you pick, outside the TEE.
          </p>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1.5 text-ui-sm font-medium text-fg-secondary">Agent</legend>
            {agents.map((agent, index) => (
              <label
                key={agent.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-ui text-fg-secondary has-[:checked]:border-border-strong has-[:checked]:bg-surface-hover"
              >
                <input
                  ref={index === 0 ? firstRef : undefined}
                  type="radio"
                  name="continue-agent"
                  className="focus-ring size-3.5 shrink-0"
                  checked={picked === agent.id}
                  onChange={() => setPicked(agent.id)}
                />
                {agent.name}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </PrivateDialog>
  );
}
