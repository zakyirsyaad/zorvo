import { useRef, useState } from "react";
import { creditsOutText, type CreditsOutReason } from "../../lib/private-session";
import { BlockerCard } from "../ui/BlockerCard";
import { Button } from "../ui/Button";
import { PrivateDialog } from "./PrivateDialog";

export interface ContinueChoice {
  id: string;
  name: string;
}

export interface PrivateCreditsOutProps {
  reason: CreditsOutReason;
  /** The agents the conversation can go on with, outside the TEE; none hides Continue with another agent. */
  agents: readonly ContinueChoice[];
  /** Opens Settings on Private mode, to top up or to restore the key. */
  onOpenSettings: () => void;
  /** Continues in a new, ordinary session of the agent picked; called only after the user confirmed it. */
  onContinue: (agentId: string) => void;
}

/**
 * A private session out of credits, or with a key that stopped working: above the composer, the way
 * past it. Continuing with another agent asks first, since the conversation leaves the TEE.
 */
export function PrivateCreditsOut({ reason, agents, onOpenSettings, onContinue }: PrivateCreditsOutProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const canContinue = reason === "empty" && agents.length > 0;

  const actions =
    reason === "empty" ? (
      <>
        {canContinue && (
          <Button variant="ghost" tone="secondary" onClick={() => setIsConfirming(true)}>
            Continue with another agent
          </Button>
        )}
        <Button variant="primary" onClick={onOpenSettings}>
          Top up
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onOpenSettings}>
        Open Settings
      </Button>
    );

  return (
    <>
      <BlockerCard label="Private credits" title={creditsOutText(reason)} actions={actions} />
      {isConfirming && (
        <ContinueDialog
          agents={agents}
          onCancel={() => setIsConfirming(false)}
          onConfirm={(agentId) => {
            setIsConfirming(false);
            onContinue(agentId);
          }}
        />
      )}
    </>
  );
}

interface ContinueDialogProps {
  agents: readonly ContinueChoice[];
  onCancel: () => void;
  onConfirm: (agentId: string) => void;
}

function ContinueDialog({ agents, onCancel, onConfirm }: ContinueDialogProps) {
  const [picked, setPicked] = useState(agents[0]?.id ?? "");
  const firstRef = useRef<HTMLInputElement>(null);
  return (
    <PrivateDialog
      title="Continue with another agent?"
      initialFocusRef={firstRef}
      onEscape={onCancel}
      footer={
        <>
          <Button variant="ghost" tone="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={picked === ""} onClick={() => onConfirm(picked)}>
            Continue
          </Button>
        </>
      }
    >
      <p className="text-ui text-fg-muted">The conversation so far goes to the agent you pick, outside the TEE.</p>
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
    </PrivateDialog>
  );
}
