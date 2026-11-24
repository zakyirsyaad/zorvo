import { SquareTerminal } from "lucide-react";
import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";
import { StatusLine } from "./ui/StatusLine";
import { SignInMethods } from "./SignInMethods";
import { authCopy, hasRunnableMethod, isSetupOnly, OPEN_SETUP_LABEL, type AuthMethod } from "../lib/acp-auth";

export { OPEN_SETUP_LABEL };
import { plainReason } from "../lib/agent-sign-in";

export type AuthStatus = "idle" | "signing-in" | "checking" | "signed-in" | "failed";

export interface AuthPanelProps {
  agentName: string;
  /** The agent's id, for its logo. */
  profileId?: string;
  methods: AuthMethod[];
  status: AuthStatus;
  error?: string;
  /** The message the agent refused is back in the composer and is sent again after the sign-in. */
  hasReturnedMessage?: boolean;
  onSignIn: (methodId: string) => void;
  /** Asks the agent again whether someone is signed in, e.g. after setting a key outside the app. */
  onCheckAgain: () => void;
  onDismiss: () => void;
}

/** The progress or result line the live region says, with its color; `isWaiting` adds the attention dot. */
function statusLine(
  agentName: string,
  status: AuthStatus,
  error: string | undefined,
  hasReturnedMessage: boolean,
  canRunMethod: boolean,
): { text: string; style: string; isWaiting?: boolean; next?: string } {
  switch (status) {
    case "signing-in":
      return { text: "Finish signing in in the window that opened…", style: "text-fg-muted" };
    case "checking":
      return { text: "Checking whether you are signed in…", style: "text-fg-muted" };
    case "failed":
      return {
        text: `Sign-in failed: ${plainReason(error)}`,
        style: "text-danger",
        // A failure always says what to try next.
        next: canRunMethod ? "Try again, or pick another way." : "Check again once it is set up.",
      };
    case "signed-in":
      return { text: `Signed in to ${agentName}. Send your message again.`, style: "text-status-running" };
    default:
      if (hasReturnedMessage) {
        return { text: "Your message will be sent again after you sign in.", style: "text-fg-secondary", isWaiting: true };
      }
      // The card shows after a check or a refusal, so an idle line claims nothing about one.
      return { text: "", style: "" };
  }
}


/**
 * Shown when an agent needs a sign-in before it can start. Methods that run
 * in the agent (a browser sign-in) or in a terminal get a button; methods that
 * need a secret are only explained, since the app never asks for API keys.
 */
export function AuthPanel({
  agentName,
  profileId,
  methods,
  status,
  error,
  hasReturnedMessage = false,
  onSignIn,
  onCheckAgain,
  onDismiss,
}: AuthPanelProps) {
  const copy = authCopy(agentName, methods);
  const isBusy = status === "signing-in" || status === "checking";
  const isSetup = isSetupOnly(methods);
  const title = isSetup ? `Set up ${agentName}` : `Sign in to ${agentName}`;
  const isSignedIn = status === "signed-in";
  const line = statusLine(agentName, status, error, hasReturnedMessage, hasRunnableMethod(methods));
  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {/* Always mounted, so a change of its text is announced. */}
      <p role="status" className={`flex min-w-0 flex-1 flex-col text-ui-sm ${line.style}`}>
        {line.isWaiting ? <StatusLine status="attention">{line.text}</StatusLine> : line.text && <span>{line.text}</span>}
        {line.next && <span className="text-fg-muted">{line.next}</span>}
      </p>
      <Button variant="ghost" tone="secondary" aria-label="Dismiss sign-in" onClick={onDismiss}>
        Dismiss
      </Button>
      {!isSignedIn && (
        <Button variant="ghost" tone="secondary" disabled={isBusy} onClick={onCheckAgain}>
          Check again
        </Button>
      )}
    </div>
  );
  if (isSetup) {
    // The agent picks its provider in its own app, which Zorvo opens; its list is never copied here.
    const setupMethod = methods[0];
    return (
      <BlockerCard label={title} profileId={profileId} title={title} footer={footer}>
        {!isSignedIn && (
          <div className="flex flex-col gap-3.5">
            <p>{agentName} connects to a provider you pick in its own setup, and keeps the choice and the key in its settings.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={isBusy}
                onClick={() => onSignIn(setupMethod.id)}
                icon={<SquareTerminal size={14} aria-hidden="true" />}
              >
                {OPEN_SETUP_LABEL}
              </Button>
              <span className="text-ui-sm text-fg-subtle">Already set up in {agentName}? Check again.</span>
            </div>
          </div>
        )}
      </BlockerCard>
    );
  }
  return (
    <BlockerCard label={title} profileId={profileId} title={title} footer={footer}>
      {!isSignedIn && (
        <>
          <p>{copy.lead}</p>
          {copy.cliHint && <p className="mt-2 text-fg-secondary">{copy.cliHint}</p>}
          {copy.keysNote && <p className="mt-2">{copy.keysNote}</p>}
          {methods.length > 0 && <SignInMethods methods={methods} isBusy={isBusy} onSignIn={onSignIn} />}
        </>
      )}
    </BlockerCard>
  );
}
