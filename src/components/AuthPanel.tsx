import { KeyRound, LogIn, X } from "lucide-react";
import { Button } from "./ui/Button";
import { authCopy, signInButtonLabel, type AuthMethod } from "../lib/acp-auth";

export type AuthStatus = "idle" | "signing-in" | "checking" | "signed-in" | "failed";

export interface AuthPanelProps {
  agentName: string;
  methods: AuthMethod[];
  status: AuthStatus;
  error?: string;
  onSignIn: (methodId: string) => void;
  /** Asks the agent again whether someone is signed in, e.g. after setting a key outside the app. */
  onCheckAgain: () => void;
  onDismiss: () => void;
}

/**
 * Shown when an agent needs a sign-in before it can start. Methods that run
 * in the agent (a browser sign-in) or in a terminal get a button; methods that
 * need a secret are only explained, since the app never asks for API keys.
 */
export function AuthPanel({ agentName, methods, status, error, onSignIn, onCheckAgain, onDismiss }: AuthPanelProps) {
  const copy = authCopy(agentName, methods);
  const isBusy = status === "signing-in" || status === "checking";
  const title = `Sign in to ${agentName}`;
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

      {status === "signed-in" ? (
        <p className="mt-2 text-status-running">Signed in to {agentName}. Send your message again.</p>
      ) : (
        <>
          <p className="mt-1.5 text-fg-muted">{copy.lead}</p>
          {copy.cliHint && <p className="mt-2 text-fg-secondary">{copy.cliHint}</p>}
          {copy.keysNote && <p className="mt-2 text-fg-muted">{copy.keysNote}</p>}
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
          {status === "signing-in" && <p className="mt-2 text-fg-muted">Finish signing in in the window that opened…</p>}
          {status === "checking" && <p className="mt-2 text-fg-muted">Checking whether you are signed in…</p>}
          {status === "failed" && <p className="mt-2 text-danger">Sign-in failed: {error}</p>}
          <Button variant="outline" disabled={isBusy} onClick={onCheckAgain} className="mt-2">
            Check again
          </Button>
        </>
      )}
    </section>
  );
}
