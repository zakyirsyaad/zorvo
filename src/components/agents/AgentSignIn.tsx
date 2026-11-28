import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ExportLine } from "../ExportLine";
import { OPEN_SETUP_LABEL } from "../AuthPanel";
import { Button } from "../ui/Button";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { authCopy, hasRunnableMethod, isSetupOnly, signInButtonLabel, splitMethods, type AuthMethod } from "../../lib/acp-auth";
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

/**
 * The one line under a row whose button is Check sign-in, when checking may open a session in the agent.
 * The whole warning stays the menu item's description.
 */
export function shortSessionWarning(agentName: string, reportsStatus: boolean | undefined, cwd?: string): string | null {
  if (reportsStatus === true) return null;
  const folder = folderNameOf(cwd);
  return `Checking ${reportsStatus === false ? "opens" : "may open"} a short session in ${folder ?? "the open folder"}. It may stay in ${agentName}'s history.`;
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

/** The word on a method's button in a row: Set up for the agent's own setup, else the method's verb. */
function buttonWord(method: AuthMethod): string {
  return method.kind === "setup" ? "Set up" : shortLabel(method);
}

/** The line under a method's name: the agent's own description, else what pressing it does. */
function methodNote(method: AuthMethod): string | null {
  if (method.description) return method.description;
  if (method.kind === "terminal") return "Opens a sign-in terminal.";
  // A setup keeps the agent's own description above; this says what the button opens.
  if (method.kind === "explain") {
    return method.variables?.length ? "Add this line to ~/.zshrc, paste your key after the =, then check again." : "Set the key in your shell, then check again.";
  }
  return null;
}

interface MethodListProps {
  agentId: string;
  agentName: string;
  methods: readonly AuthMethod[];
  isBusy: boolean;
  canRunSetup: boolean;
  warningId: string | undefined;
  signIn: SettingsSignIn;
}

/** One method as a row: its name and note, then its control (a button, Check again, or why there is none). */
function MethodRow({ method, isFirst, agentId, agentName, isBusy, canRunSetup, warningId, signIn }: { method: AuthMethod; isFirst: boolean } & Omit<MethodListProps, "methods">) {
  const note = methodNote(method);
  const isRunnable = method.kind === "agent" || method.kind === "terminal" || (method.kind === "setup" && canRunSetup);
  const control = isRunnable ? (
    // A setup needs a folder to run in, as every sign-in does; without one it stays text.
    <Button
      size="md"
      variant={isFirst ? "primary" : "outline"}
      disabled={isBusy}
      aria-label={method.kind === "setup" ? OPEN_SETUP_LABEL : signInButtonLabel(method)}
      onClick={() => signIn.signInWith(agentId, method.id)}
    >
      {isFirst ? buttonWord(method) : <span className="text-fg">{buttonWord(method)}</span>}
    </Button>
  ) : method.kind === "explain" ? (
    <Button variant="ghost" size="md" disabled={isBusy} aria-describedby={warningId} onClick={() => signIn.check(agentId)}>
      Check again
    </Button>
  ) : (
    <span className="shrink-0 text-caption text-fg-subtle">From a new session</span>
  );
  return (
    <li className="flex flex-col gap-2 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-ui text-fg-secondary">{method.name}</span>
          {note && <span className="text-ui-sm text-fg-muted">{note}</span>}
          {method.kind === "setup" && canRunSetup && <span className="text-ui-sm text-fg-muted">Opens {agentName}'s own setup in a terminal.</span>}
        </span>
        {control}
      </div>
      {method.kind === "explain" && method.variables?.map((variable) => <ExportLine key={variable} variable={variable} />)}
    </li>
  );
}

/**
 * The first method Zorvo can run leads, with the row's one primary button; the other ways are folded
 * under it. With nothing Zorvo can run, every method shows at once.
 */
function MethodList({ methods, ...rest }: MethodListProps) {
  const { first, others } = splitMethods(methods);
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  // With nothing Zorvo can run there is no fold: every method shows at once.
  const isListShown = first === null || isOpen;
  return (
    <div className="flex flex-col gap-1.5">
      {first && (
        <ul className="flex flex-col">
          <MethodRow method={first} isFirst {...rest} />
        </ul>
      )}
      {first && others.length > 0 && (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => setIsOpen((open) => !open)}
          className="-ml-1.5 flex h-6.5 items-center gap-1.5 self-start rounded-md px-1.5 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover focus-ring"
        >
          {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          Other ways to sign in ({others.length})
        </button>
      )}
      {others.length > 0 && isListShown && (
        <ul id={listId} className="flex flex-col">
          {others.map((method) => (
            <MethodRow key={method.id} method={method} isFirst={false} {...rest} />
          ))}
        </ul>
      )}
    </div>
  );
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
  const canRunSetup = signIn.cwd !== undefined;
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
        <MethodList
          agentId={agentId}
          agentName={agentName}
          methods={methods}
          isBusy={isBusy}
          canRunSetup={canRunSetup}
          warningId={warning ? warningId : undefined}
          signIn={signIn}
        />
      )}
      {warning && (
        <span id={warningId} className="sr-only">
          {warning}
        </span>
      )}
    </div>
  );
}
