import { SquareTerminal } from "lucide-react";
import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";
import { StatusLine } from "./ui/StatusLine";
import { authCopy, isSetupOnly, signInButtonLabel, type AuthMethod } from "../lib/acp-auth";
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
): { text: string; style: string; isWaiting?: boolean } {
  switch (status) {
    case "signing-in":
      return { text: "Finish signing in in the window that opened…", style: "text-fg-muted" };
    case "checking":
      return { text: "Checking whether you are signed in…", style: "text-fg-muted" };
    case "failed":
      return { text: `Sign-in failed: ${plainReason(error)}`, style: "text-danger" };
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

/** One way to sign in: a button when Zorvo can run it, else where to set it up, in words only. */
function MethodRow({ method, isBusy, onSignIn }: { method: AuthMethod; isBusy: boolean; onSignIn: (id: string) => void }) {
  const isExplained = method.kind === "explain";
  return (
    <li className="flex items-center gap-2.5 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`text-ui ${isExplained ? "text-fg-secondary" : "text-fg"}`}>{method.name}</span>
        {method.description && <span className="text-ui-sm text-fg-subtle">{method.description}</span>}
      </div>
      {isExplained ? (
        // Never a field: the app never asks for or stores a key.
        <span className="shrink-0 text-caption text-fg-subtle">In your shell</span>
      ) : (
        <Button variant="outline" disabled={isBusy} onClick={() => onSignIn(method.id)} className="shrink-0">
          {/* The label carries the colour: the outline's own text-fg-secondary would win over a className. */}
          <span className="text-fg">{method.kind === "setup" ? OPEN_SETUP_LABEL : signInButtonLabel(method)}</span>
        </Button>
      )}
    </li>
  );
}

/** The button that opens an agent's own setup in the terminal dialog. */
const OPEN_SETUP_LABEL = "Open setup in terminal";

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
  const line = statusLine(agentName, status, error, hasReturnedMessage);
  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {/* Always mounted, so a change of its text is announced. */}
      <p role="status" className={`flex min-w-0 flex-1 items-center gap-2 text-ui-sm ${line.style}`}>
        {line.isWaiting ? <StatusLine status="attention">{line.text}</StatusLine> : line.text}
      </p>
      <Button variant="ghost" tone="secondary" aria-label="Dismiss sign-in" onClick={onDismiss}>
        Dismiss
      </Button>
      {!isSignedIn && (
        <Button disabled={isBusy} onClick={onCheckAgain}>
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
                variant="outline"
                disabled={isBusy}
                onClick={() => onSignIn(setupMethod.id)}
                icon={<SquareTerminal size={14} aria-hidden="true" />}
              >
                <span className="text-fg">{OPEN_SETUP_LABEL}</span>
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
          {methods.length > 0 && (
            <ul aria-label="Sign-in methods" className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {methods.map((method) => (
                <MethodRow key={method.id} method={method} isBusy={isBusy} onSignIn={onSignIn} />
              ))}
            </ul>
          )}
        </>
      )}
    </BlockerCard>
  );
}
