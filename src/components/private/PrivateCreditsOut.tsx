import { useId, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { creditsOutText, ownKeyOutText, ownKeyOutTitle, type CreditsOutReason } from "../../lib/private-session";
import type { PaymentSource } from "../../lib/private-credits";
import { BlockerCard } from "../ui/BlockerCard";
import { Button } from "../ui/Button";
import { PrivateDialog } from "./PrivateDialog";

export interface ContinueChoice {
  id: string;
  name: string;
}

export interface PrivateCreditsOutProps {
  reason: CreditsOutReason;
  /** The capped session's limit, for the cap card's title and its doubled raise. */
  sessionCap?: number;
  /** The agents the conversation can go on with, outside the TEE; none hides Continue with another agent. */
  agents: readonly ContinueChoice[];
  /** Opens Settings on Private mode, to top up or to restore the key. */
  onOpenSettings: () => void;
  /** Continues in a new, ordinary session of the agent picked; called only after the user confirmed it. */
  onContinue: (agentId: string) => void;
  /** Starts a fresh, uncapped private session from this one. */
  onNewSession?: () => void;
  /** Doubles the cap at the Worker; the button waits while this is in flight. */
  onRaise?: () => void;
  isRaising?: boolean;
  paymentSource?: PaymentSource;
  /** Whether the user's own key is still in the Keychain; false makes a key refusal read as removed. */
  ownKeySaved?: boolean;
  onSwitchToCredits?: () => void;
  onOpenDashboard?: () => void;
}

/**
 * Announces a session's refusal for credits or a key. Mounted before the panel and kept mounted, since a
 * live region that is already there announces what it is given and a new one does not.
 */
export function PrivateCreditsOutStatus({
  reason,
  paymentSource = "credits",
  ownKeySaved = true,
}: {
  reason: CreditsOutReason | undefined;
  paymentSource?: PaymentSource;
  ownKeySaved?: boolean;
}) {
  return (
    <p role="status" className="sr-only">
      {reason
        ? paymentSource === "ownKey"
          ? ownKeyOutText(reason, ownKeySaved)
          : creditsOutText(reason)
        : ""}
    </p>
  );
}

/**
 * A private session out of credits, or with a key that stopped working: above the composer, the way
 * past it. Continuing with another agent asks first, since the conversation leaves the TEE.
 */
export function PrivateCreditsOut({
  reason,
  sessionCap,
  agents,
  onOpenSettings,
  onContinue,
  onNewSession,
  onRaise,
  isRaising = false,
  paymentSource = "credits",
  ownKeySaved = true,
  onSwitchToCredits,
  onOpenDashboard,
}: PrivateCreditsOutProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const canContinue = reason === "empty" && agents.length > 0;

  if (reason === "session_limit") {
    const nextCap = sessionCap !== undefined ? sessionCap * 2 : undefined;
    return (
      <BlockerCard
        label="Private session limit"
        title={sessionCap !== undefined ? `This session reached ${sessionCap} credits` : "This session reached its credit limit"}
        actions={
          <>
            {onNewSession && (
              <Button variant="ghost" tone="secondary" onClick={onNewSession}>
                New session
              </Button>
            )}
            {onRaise && nextCap !== undefined && (
              <Button variant="outline" onClick={onRaise} disabled={isRaising}>
                {isRaising ? "Raising…" : `Raise to ${nextCap}`}
              </Button>
            )}
          </>
        }
      >
        <p>NEAR AI stopped it at the cap you set. Raise the cap to go on, or start a new session.</p>
      </BlockerCard>
    );
  }

  if (paymentSource === "ownKey") {
    const isKeyRefusal = reason === "key";
    return (
      <BlockerCard
        label="Private credits"
        title={ownKeyOutTitle(reason, ownKeySaved)}
        actions={
          isKeyRefusal ? (
            <>
              <Button variant="primary" onClick={onOpenSettings}>
                Add key
              </Button>
              <Button variant="ghost" tone="secondary" onClick={onSwitchToCredits}>
                Switch to Zorvo credits
              </Button>
              <Button
                variant="outline"
                icon={<ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />}
                onClick={onOpenDashboard}
              >
                Open NEAR AI dashboard
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" tone="secondary" onClick={onSwitchToCredits}>
                Switch to Zorvo credits
              </Button>
              <Button
                variant="outline"
                icon={<ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />}
                onClick={onOpenDashboard}
              >
                Open NEAR AI dashboard
              </Button>
            </>
          )
        }
      >
        {isKeyRefusal ? (
          <p>
            {ownKeySaved
              ? "NEAR AI didn't accept this key. Check it or create a new one in your NEAR AI dashboard, then add it in Settings → Private mode."
              : "You removed this key from Zorvo. Add a key in Settings → Private mode to keep running privately."}
          </p>
        ) : (
          <p>
            NEAR AI turned the request down: your organization has no credits left. Add credits or stake more NEAR in
            your NEAR AI dashboard, or switch this Mac to Zorvo credits.
          </p>
        )}
        <p className="text-ui-sm text-fg-subtle">Your message is back in the box.</p>
      </BlockerCard>
    );
  }

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
      <BlockerCard label="Private credits" title={creditsOutText(reason)} actions={actions}>
        {reason === "empty" && (
          <p>
            Qwen Code stopped because there are no credits left. Your message is back in the box, ready to send after a
            top-up. The rest of Zorvo and this session's history keep working.
          </p>
        )}
        {canContinue && (
          <p className="text-ui-sm text-fg-subtle">
            Continuing with another agent sends your code to that agent's provider, outside a TEE.
          </p>
        )}
      </BlockerCard>
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
  const warningId = useId();
  return (
    <PrivateDialog
      title="Continue with another agent?"
      initialFocusRef={firstRef}
      describedBy={warningId}
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
    </PrivateDialog>
  );
}

export interface PrivateCreditsOutLayerProps extends Omit<PrivateCreditsOutProps, "reason"> {
  /** The session on screen, if any: one session's confirm never carries over to another's panel. */
  sessionId: string | undefined;
  reason: CreditsOutReason | undefined;
}

/** The status line, kept mounted, and the panel while the session on screen is out of credits or a key. */
export function PrivateCreditsOutLayer({
  sessionId,
  reason,
  paymentSource,
  ownKeySaved,
  ...panel
}: PrivateCreditsOutLayerProps) {
  return (
    <>
      <PrivateCreditsOutStatus reason={reason} paymentSource={paymentSource} ownKeySaved={ownKeySaved} />
      {sessionId && reason && (
        <PrivateCreditsOut
          key={sessionId}
          reason={reason}
          paymentSource={paymentSource}
          ownKeySaved={ownKeySaved}
          {...panel}
        />
      )}
    </>
  );
}
