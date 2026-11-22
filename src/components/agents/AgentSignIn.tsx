import { useId } from "react";
import { Button } from "../ui/Button";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { authCopy, hasRunnableMethod, isSetupOnly, signInButtonLabel, type AuthMethod } from "../../lib/acp-auth";
import { noSignInOfferedLine, plainReason, readingMethodsLine } from "../../lib/agent-sign-in";

export interface AgentSignInProps {
  agentId: string;
  agentName: string;
  signIn: SettingsSignIn;
  /** Opened by Sign in again on an agent that is not asking for a sign-in: says so when Zorvo can run none of the methods. */
  isAgain?: boolean;
}

/** The last part of a folder path, for words that name the folder a session opens in. */
function folderNameOf(cwd: string | undefined): string | null {
  const name = cwd?.split("/").filter(Boolean).pop();
  return name ?? null;
}

/**
 * Said with Check sign-in, before it runs, when asking can open a session in the agent: where it opens,
 * that the session can run the project's hooks, and that Zorvo asks the same way after a sign-in.
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

/** What the row's live region says: the sign-in under way, else the last check's result. */
export function signInStatus(agentName: string, signIn: SettingsSignIn, agentId: string): { text: string; isError: boolean } {
  const check = signIn.checkOf(agentId);
  const request = signIn.requestOf(agentId);
  if (check.phase === "checking") return { text: `Checking ${agentName}…`, isError: false };
  if (signIn.againOf(agentId) === "reading") return { text: readingMethodsLine(agentName), isError: false };
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

/** True while this agent cannot start another check or sign-in: one runs here, or another agent's login does. */
export function isSignInBusy(signIn: SettingsSignIn, agentId: string): boolean {
  const request = signIn.requestOf(agentId);
  const isSigningIn = request?.status === "signing-in" || request?.status === "checking";
  return signIn.checkOf(agentId).phase === "checking" || signIn.againOf(agentId) === "reading" || isSigningIn || signIn.busyAgentId !== null;
}

/** The verb on a method's button: the one its name starts with ("Log in with Google" reads Log in), else Sign in. */
function shortLabel(method: AuthMethod): string {
  const verb = /^(log ?in|sign ?in|sign ?up|connect|continue|authenticate|authorize)\b/i.exec(method.name.trim())?.[1];
  return verb ? verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase() : "Sign in";
}

/** The line under a method's name: the agent's own description, else what pressing it does. */
function methodNote(method: AuthMethod): string | null {
  if (method.description) return method.description;
  if (method.kind === "terminal") return "Opens a sign-in terminal.";
  if (method.kind === "explain") return "Set the key in your shell, then check again.";
  return null;
}

/**
 * While an agent needs a sign-in, its methods as rows inside its Settings → Agents row, with a hairline
 * between them and no box of their own. A method Zorvo can run has its button (the short verb shows, the
 * whole method names it for a screen reader); a key or setting Zorvo never handles has Check again.
 */
export function AgentSignIn({ agentId, agentName, signIn, isAgain = false }: AgentSignInProps) {
  const methods = signIn.methodsOf(agentId);
  const isBusy = isSignInBusy(signIn, agentId);
  const warning = sessionWarning(agentName, signIn.reportsStatusOf(agentId), signIn.cwd);
  const warningId = useId();
  const copy = authCopy(agentName, methods);
  // The status word already says a sign-in is needed: a lead line shows only when there is nothing to pick.
  const lead =
    isAgain && !hasRunnableMethod(methods)
      ? noSignInOfferedLine(agentName)
      : methods.length === 0
        ? copy.cliHint
        : isSetupOnly(methods)
          ? copy.lead
          : null;

  return (
    <div role="group" aria-label={`${agentName} sign-in`} className="flex flex-col">
      {lead && <p className="pb-2 text-ui-sm text-fg-muted">{lead}</p>}
      {methods.length > 0 && (
        <ul className="flex flex-col">
          {methods.map((method) => {
            const note = methodNote(method);
            return (
              <li key={method.id} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ui text-fg-secondary">{method.name}</span>
                  {note && <span className="text-ui-sm text-fg-muted">{note}</span>}
                </span>
                {method.kind === "agent" || method.kind === "terminal" ? (
                  // Settings runs a sign-in, never an agent's own setup: that runs from the draft's card.
                  <Button size="md" disabled={isBusy} aria-label={signInButtonLabel(method)} onClick={() => signIn.signInWith(agentId, method.id)}>
                    <span className="text-fg">{shortLabel(method)}</span>
                  </Button>
                ) : method.kind === "explain" ? (
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={isBusy}
                    aria-describedby={warning ? warningId : undefined}
                    onClick={() => signIn.check(agentId)}
                  >
                    Check again
                  </Button>
                ) : (
                  <span className="shrink-0 text-caption text-fg-subtle">From a new session</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {warning && (
        <span id={warningId} className="sr-only">
          {warning}
        </span>
      )}
    </div>
  );
}
