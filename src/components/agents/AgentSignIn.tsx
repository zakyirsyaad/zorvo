import { useEffect, useId, useRef } from "react";
import { Button } from "../ui/Button";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { authCopy, signInButtonLabel } from "../../lib/acp-auth";
import { plainReason } from "../../lib/agent-sign-in";

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
 * An agent's sign-in, opened inside its Settings → Agents row (the row shows the state as a chip):
 * while the agent needs one, its methods in a bordered list, with the same words as the new-session
 * panel; then what checking may do and Check sign-in, and the result in a live region.
 */
export function AgentSignIn({ agentId, agentName, signIn }: AgentSignInProps) {
  const state = signIn.stateOf(agentId);
  const check = signIn.checkOf(agentId);
  const request = signIn.requestOf(agentId);
  const methods = signIn.methodsOf(agentId);
  const warning = sessionWarning(agentName, signIn.reportsStatusOf(agentId), signIn.cwd);
  const warningId = useId();
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

  const runs = (method: (typeof methods)[number]) => method.kind === "agent" || method.kind === "terminal";
  return (
    <div
      ref={sectionRef}
      tabIndex={-1}
      role="group"
      aria-label={`${agentName} sign-in`}
      className="flex flex-col gap-2.5 rounded-md focus-ring"
    >
      {state === "needed" && (
        <>
          {[copy.lead, copy.cliHint, copy.keysNote].filter(Boolean).map((line) => (
            <p key={line} className="text-ui-sm text-fg-subtle">
              {line}
            </p>
          ))}
          {methods.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface-2">
              {methods.map((method) => (
                <li key={method.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2.25 last:border-b-0">
                  {runs(method) ? (
                    <>
                      <span className="min-w-0 flex-1 text-ui text-fg">{method.name}</span>
                      {/* Settings runs a sign-in, never an agent's own setup: that runs from the draft's card. */}
                      <Button size="md" disabled={isBusy} onClick={() => signIn.signInWith(agentId, method.id)}>
                        <span className="text-fg">{signInButtonLabel(method)}</span>
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-fg-secondary">{method.name}</span>
                        {method.description && <span className="text-ui-sm text-fg-subtle">{method.description}</span>}
                      </span>
                      <span className="shrink-0 text-caption text-fg-subtle">In your shell</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className={`flex items-center gap-2 ${warning ? "" : "justify-end"}`}>
        {warning && (
          <p id={warningId} className="min-w-0 flex-1 text-ui-sm text-fg-subtle">
            {warning}
          </p>
        )}
        <Button
          size="md"
          disabled={isBusy}
          onClick={() => signIn.check(agentId)}
          aria-describedby={warning ? warningId : undefined}
        >
          Check sign-in
        </Button>
      </div>
      <p role="status" className={text === "" ? "sr-only" : isError ? "text-ui-sm text-danger" : "text-ui-sm text-fg-muted"}>
        {text}
      </p>
    </div>
  );
}
