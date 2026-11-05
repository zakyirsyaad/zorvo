import { LogIn } from "lucide-react";
import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";
import { authCopy, signInButtonLabel, type AuthMethod } from "../lib/acp-auth";
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

/** The progress or result line the live region says, with its color; empty while nothing happens. */
function statusLine(
  agentName: string,
  status: AuthStatus,
  error: string | undefined,
  hasReturnedMessage: boolean,
): { text: string; style: string } {
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
      return hasReturnedMessage
        ? { text: "Your message will be sent again after you sign in", style: "text-fg-muted" }
        : { text: "", style: "" };
  }
}

/** One way to sign in: a button when Zorvo can run it, else where to set it up, in words only. */
function MethodRow({ method, isBusy, onSignIn }: { method: AuthMethod; isBusy: boolean; onSignIn: (id: string) => void }) {
  if (method.kind === "explain") {
    // Never a field: the app never asks for or stores a key.
    return (
      <li className="min-w-0">
        <span className="font-medium text-fg-secondary">{method.name}</span>
        <span className="ml-1.5 text-caption text-fg-subtle">In your shell</span>
        {method.description && <p className="text-fg-subtle">{method.description}</p>}
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="font-medium text-fg-secondary">{method.name}</span>
        {method.description && <p className="text-fg-subtle">{method.description}</p>}
      </div>
      <Button
        variant="primary"
        disabled={isBusy}
        onClick={() => onSignIn(method.id)}
        icon={<LogIn size={12} />}
        className="shrink-0"
      >
        {signInButtonLabel(method)}
      </Button>
    </li>
  );
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
  const title = `Sign in to ${agentName}`;
  const isSignedIn = status === "signed-in";
  const line = statusLine(agentName, status, error, hasReturnedMessage);
  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {/* Always mounted, so a change of its text is announced. */}
      <p role="status" className={`min-w-0 flex-1 text-caption ${line.style}`}>
        {line.text}
      </p>
      <Button variant="ghost" aria-label="Dismiss sign-in" onClick={onDismiss}>
        Dismiss
      </Button>
      {!isSignedIn && (
        <Button disabled={isBusy} onClick={onCheckAgain}>
          Check again
        </Button>
      )}
    </div>
  );
  return (
    <BlockerCard label={title} profileId={profileId} title={title} footer={footer}>
      {!isSignedIn && (
        <>
          <p>{copy.lead}</p>
          {copy.cliHint && <p className="mt-2 text-fg-secondary">{copy.cliHint}</p>}
          {copy.keysNote && <p className="mt-2">{copy.keysNote}</p>}
          {methods.length > 0 && (
            <ul className="mt-3 space-y-2">
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
