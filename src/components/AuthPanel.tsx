import { KeyRound, LogIn, X } from "lucide-react";
import { Button } from "./ui/Button";
import { authCopy, signInButtonLabel, type AuthMethod } from "../lib/acp-auth";
import { plainReason } from "../lib/agent-sign-in";

export type AuthStatus = "idle" | "signing-in" | "checking" | "signed-in" | "failed";

export interface AuthPanelProps {
  agentName: string;
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

/** The progress or result line the live region says, with the style it gets; empty while nothing happens. */
function statusLine(agentName: string, status: AuthStatus, error: string | undefined): { text: string; style: string } {
  switch (status) {
    case "signing-in":
      return { text: "Finish signing in in the window that opened…", style: "mt-2 text-fg-muted" };
    case "checking":
      return { text: "Checking whether you are signed in…", style: "mt-2 text-fg-muted" };
    case "failed":
      return { text: `Sign-in failed: ${plainReason(error)}`, style: "mt-2 text-danger" };
    case "signed-in":
      return { text: `Signed in to ${agentName}. Send your message again.`, style: "mt-2 text-status-running" };
    default:
      return { text: "", style: "sr-only" };
  }
}

/**
 * Shown when an agent needs a sign-in before it can start. Methods that run
 * in the agent (a browser sign-in) or in a terminal get a button; methods that
 * need a secret are only explained, since the app never asks for API keys.
 */
export function AuthPanel({ agentName, methods, status, error, hasReturnedMessage = false, onSignIn, onCheckAgain, onDismiss }: AuthPanelProps) {
  const copy = authCopy(agentName, methods);
  const isBusy = status === "signing-in" || status === "checking";
  const title = `Sign in to ${agentName}`;
  const isSignedIn = status === "signed-in";
  const line = statusLine(agentName, status, error);
  return (
    <section
      aria-label={title}
      className="mx-6 mt-3 rounded-lg border border-attention-border bg-attention-surface px-4 py-3 text-xs text-fg-secondary"
    >
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-medium text-status-attention">
          <KeyRound size={13} />
          {title}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss sign-in"
          className="rounded p-0.5 text-fg-muted hover:text-fg"
        >
          <X size={13} />
        </button>
      </header>

      {!isSignedIn && (
        <>
          <p className="mt-1.5 text-fg-muted">{copy.lead}</p>
          {copy.cliHint && <p className="mt-2 text-fg-secondary">{copy.cliHint}</p>}
          {copy.keysNote && <p className="mt-2 text-fg-muted">{copy.keysNote}</p>}
          {hasReturnedMessage && (
            <p className="mt-2 text-fg-secondary">
              Your message is back in the box below. Zorvo sends it again once you are signed in, unless you change it.
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {methods.map((method) => (
              <li key={method.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium text-fg-secondary">{method.name}</span>
                  {method.description && <p className="text-fg-subtle">{method.description}</p>}
                </div>
                {method.kind !== "explain" && (
                  <Button
                    variant="primary"
                    disabled={isBusy}
                    onClick={() => onSignIn(method.id)}
                    icon={<LogIn size={12} />}
                    className="shrink-0"
                  >
                    {signInButtonLabel(method)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {/* Always mounted, so a change of its text is announced. */}
      <p role="status" className={line.style}>
        {line.text}
      </p>
      {!isSignedIn && (
        <Button variant="outline" disabled={isBusy} onClick={onCheckAgain} className="mt-2">
          Check again
        </Button>
      )}
    </section>
  );
}
