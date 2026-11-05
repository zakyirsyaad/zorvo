import { useEffect, useId, useRef } from "react";
import { LogIn, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { authCopy, signInButtonLabel } from "../../lib/acp-auth";
import { plainReason, SIGN_IN_CHIP_STYLES, SIGN_IN_LABELS } from "../../lib/agent-sign-in";

export interface AgentSignInProps {
  agentId: string;
  agentName: string;
  signIn: SettingsSignIn;
}

/** The last part of a folder path, for words that name the folder a session opens in. */
function folderNameOf(cwd: string | undefined): string | null {
  const name = cwd?.split("/").filter(Boolean).pop();
  return name ?? null;
}

/**
 * Said next to Check sign-in, before it runs, when asking can open a session in the agent: where it
 * opens, that the session can run the project's hooks, and that Zorvo asks the same way after a sign-in.
 */
export function sessionWarning(agentName: string, reportsStatus: boolean | undefined, cwd?: string): string | null {
  if (reportsStatus === true) return null;
  const folder = folderNameOf(cwd);
  const place = folder ? `the ${folder} folder` : "the open folder";
  const tail = `That session may stay in ${agentName}'s history and may run your project's hooks. After you sign in, Zorvo checks the same way.`;
  if (reportsStatus === false) {
    return `${agentName} cannot say who is signed in, so Zorvo opens a session in ${place} to find out. ${tail}`;
  }
  return `If ${agentName} cannot say who is signed in, Zorvo opens a session in ${place} to find out. ${tail}`;
}

/** What the live region says: the sign-in under way, else the last check's result. */
function statusText(agentName: string, signIn: SettingsSignIn, agentId: string): { text: string; isError: boolean } {
  const check = signIn.checkOf(agentId);
  const request = signIn.requestOf(agentId);
  if (check.phase === "checking") return { text: `Checking ${agentName}…`, isError: false };
  switch (request?.status) {
    case "signing-in":
      return { text: "Finish signing in in the window that opened…", isError: false };
    case "checking":
      return { text: "Checking whether you are signed in…", isError: false };
    case "failed":
      return { text: `Sign-in failed: ${plainReason(request.error)}`, isError: true };
    case "signed-in":
      return { text: `Signed in to ${agentName}.`, isError: false };
    default:
      return { text: check.message ?? "", isError: check.isFailure === true };
  }
}

/**
 * An agent's sign-in in Settings → Agents: the same state the sidebar shows, a Check sign-in button,
 * and (when the agent needs one) its sign-in methods, with the same words as the new-session panel.
 */
export function AgentSignIn({ agentId, agentName, signIn }: AgentSignInProps) {
  const state = signIn.stateOf(agentId);
  const check = signIn.checkOf(agentId);
  const request = signIn.requestOf(agentId);
  const methods = signIn.methodsOf(agentId);
  const warning = sessionWarning(agentName, signIn.reportsStatusOf(agentId), signIn.cwd);
  const warningId = useId();
  const style = SIGN_IN_CHIP_STYLES[state];
  const isSigningIn = request?.status === "signing-in" || request?.status === "checking";
  // One sign-in at a time: another agent's running login would be cut off by this one.
  const isBusy = check.phase === "checking" || isSigningIn || signIn.busyAgentId !== null;
  const { text, isError } = statusText(agentName, signIn, agentId);
  const copy = authCopy(agentName, methods);

  // Back to this row when the login's dialog closes and the button that opened it is gone (the agent is ready now).
  const sectionRef = useRef<HTMLDivElement>(null);
  const hasDialog = signIn.terminal.dialog !== null && request !== null;
  const hadDialog = useRef(false);
  useEffect(() => {
    if (hadDialog.current && !hasDialog) {
      const focused = document.activeElement;
      if (!focused || focused === document.body) sectionRef.current?.focus();
    }
    hadDialog.current = hasDialog;
  }, [hasDialog]);

  return (
    <div
      ref={sectionRef}
      tabIndex={-1}
      role="group"
      aria-label={`${agentName} sign-in`}
      className="mt-2 flex flex-col gap-1.5 rounded-md focus-ring"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex shrink-0 items-center gap-1 text-[11px] font-medium ${style.text}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
          <span className="sr-only">Sign-in: </span>
          {SIGN_IN_LABELS[state]}
        </span>
        <Button
          disabled={isBusy}
          onClick={() => signIn.check(agentId)}
          aria-describedby={warning ? warningId : undefined}
          icon={<RefreshCw size={12} aria-hidden="true" className={check.phase === "checking" ? "animate-spin" : undefined} />}
        >
          Check sign-in
        </Button>
      </div>
      {warning && (
        <p id={warningId} className="text-[11px] text-fg-subtle">
          {warning}
        </p>
      )}
      <p role="status" className={text === "" ? "sr-only" : isError ? "text-[11px] text-danger" : "text-[11px] text-fg-muted"}>
        {text}
      </p>

      {state === "needed" && (
        <div className="flex flex-col gap-1.5 rounded-md border border-attention-border bg-attention-surface px-3 py-2 text-[11px] text-fg-secondary">
          <p>{copy.lead}</p>
          {copy.cliHint && <p>{copy.cliHint}</p>}
          {copy.keysNote && <p className="text-fg-muted">{copy.keysNote}</p>}
          {methods.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {methods.map((method) => (
                <li key={method.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium text-fg-secondary">{method.name}</span>
                    {method.description && <p className="text-fg-subtle">{method.description}</p>}
                  </div>
                  {/* Settings runs a sign-in, never an agent's own setup: that runs from the draft's card. */}
                  {(method.kind === "agent" || method.kind === "terminal") && (
                    <Button
                      variant="primary"
                      disabled={isBusy}
                      onClick={() => signIn.signInWith(agentId, method.id)}
                      icon={<LogIn size={12} aria-hidden="true" />}
                      className="shrink-0"
                    >
                      {signInButtonLabel(method)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
