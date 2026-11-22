import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { InstallBar, InstallStatus } from "../InstallProgressLine";
import { AgentSignIn, isSignInBusy, sessionWarning, signInStatus } from "./AgentSignIn";
import { SignInStatus } from "./SignInStatus";
import { AgentTile } from "../ui/AgentTile";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { useAgentInstall } from "../../hooks/useAgentInstall";
import { useConfirmFocus } from "../../hooks/useConfirmFocus";
import { availableLine, rowActions, sourceLine, statusLine } from "../../lib/agent-catalog";
import { SIGN_IN_RUNNING_NOTICE } from "../../lib/agent-sign-in";
import type { CatalogAgent, InstallStep } from "../../types";

export interface AgentCatalogRowProps {
  agent: CatalogAgent;
  isInUse: boolean;
  /** What Add or Install would install, from the agent's profile; null when nothing or unknown. */
  plan: readonly InstallStep[] | null;
  runningSessionCount: number;
  /** Why the last Remove could not delete Zorvo's copy; kept by the list, as the row moves section. */
  removeError: string | null;
  /** Settings' sign-in controls; the row shows no sign-in without them (onboarding has none). */
  signIn?: SettingsSignIn;
  onAdd: () => void;
  onUpdate: () => void;
  onRemove: () => void;
}

/** Statuses of an agent that cannot start yet, so it has no sign-in to check. */
const NOT_STARTABLE: readonly CatalogAgent["status"][] = ["not_installed", "unsupported", "waiting"];

function removeQuestion(name: string, runningSessionCount: number): string {
  const question = `Remove ${name}? Zorvo deletes its copy. Saved sessions stay readable.`;
  return runningSessionCount > 0 ? `${question} Its open sessions stop.` : question;
}

/** An outline button whose label reads `fg`, as the canvas's row buttons do; `label` names it when the word alone would not. */
function RowButton({ onClick, label, children }: { onClick: () => void; label?: string; children: string }) {
  return (
    <Button size="md" aria-label={label} onClick={onClick}>
      <span className="text-fg">{children}</span>
    </Button>
  );
}

/**
 * One agent in Settings → Agents, as one line: its logo tile, name, and version (or what Add would
 * install), its sign-in as a dot and a word, one button, and ⋯ for the rest (Check sign-in, Remove).
 * Under the line, indented to the name: the sign-in methods while the agent needs one (or after Sign in again), what a check or
 * sign-in says, Remove's question, and what failed.
 */
export function AgentCatalogRow({
  agent,
  isInUse,
  plan,
  runningSessionCount,
  removeError,
  signIn,
  onAdd,
  onUpdate,
  onRemove,
}: AgentCatalogRowProps) {
  const job = useAgentInstall(agent.id);
  const actions = rowActions(agent, isInUse);
  const isBusy = job.status === "installing";
  const retry = job.action === "update" ? onUpdate : job.install;
  // A failure is about an agent in use; once removed, its Add starts over.
  const hasFailed = job.status === "failed" && isInUse;
  const canCheckSignIn = isInUse && signIn !== undefined && !NOT_STARTABLE.includes(agent.status);
  const signInState = canCheckSignIn ? signIn.stateOf(agent.id) : null;
  const hasPlan = (plan?.length ?? 0) > 0;
  // Sign in again: the list of a Ready (or never checked) agent, opened from ⋯ and put away from there.
  const again = canCheckSignIn ? signIn.againOf(agent.id) : "closed";
  const isAgainShown = again === "open" && signInState !== "needed";
  // An install or update hides the methods until the job ends.
  const showsMethods = (signInState === "needed" || isAgainShown) && !isBusy;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const { confirmRef, returnRef: moreRef } = useConfirmFocus(isConfirmingRemove);
  const warningId = useId();
  const againNoticeId = useId();

  // Back to this row when a login's dialog closes and nothing holds the focus (the method's button is gone once the agent is ready).
  const hasDialog = canCheckSignIn && signIn.terminal.dialog !== null && signIn.requestOf(agent.id) !== null;
  const hadDialog = useRef(false);
  // Sign in again: focus goes to the list's first control when it opens, and back to ⋯ when it goes.
  const listRef = useRef<HTMLDivElement>(null);
  const wasListOpen = useRef(false);
  useEffect(() => {
    if (!wasListOpen.current && isAgainShown) {
      listRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    } else if (wasListOpen.current && !isAgainShown) {
      const focused = document.activeElement;
      if (!focused || focused === document.body) moreRef.current?.focus();
    }
    wasListOpen.current = isAgainShown;
  }, [isAgainShown, moreRef]);
  useEffect(() => {
    if (hadDialog.current && !hasDialog) {
      const focused = document.activeElement;
      if (!focused || focused === document.body) moreRef.current?.focus();
    }
    hadDialog.current = hasDialog;
  }, [hasDialog, moreRef]);

  const secondLine = isBusy ? (
    <>
      <InstallStatus progress={job.progress} action={job.action} isCompact />
      <div className="mt-1.5">
        <InstallBar progress={job.progress} />
      </div>
    </>
  ) : isInUse && (agent.status !== "not_installed" || !hasPlan) ? (
    <span className="truncate font-mono text-caption text-fg-muted" title={agent.location ?? undefined}>
      {sourceLine(agent, actions.update ? agent.updateVersion : null)}
    </span>
  ) : (
    <span className="text-ui-sm text-fg-muted">{availableLine(agent, plan)}</span>
  );

  const isOtherAgentBusy = canCheckSignIn && signIn.busyAgentId !== null && signIn.busyAgentId !== agent.id;
  const warning = canCheckSignIn ? sessionWarning(agent.name, signIn.reportsStatusOf(agent.id), signIn.cwd) : null;
  // Remove stays offered while an install runs: removing ends the install too.
  const hasMenu = actions.remove || canCheckSignIn;
  const menu = hasMenu && (
    <Popover
      isOpen={isMenuOpen}
      onClose={() => setIsMenuOpen(false)}
      label={`Actions for ${agent.name}`}
      role="menu"
      align="end"
      className={warning || isOtherAgentBusy ? "w-72" : "w-44"}
      trigger={
        <IconButton
          ref={moreRef}
          label={`More actions for ${agent.name}`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </IconButton>
      }
    >
      {canCheckSignIn && !isBusy && (
        <PopoverOption
          disabled={isSignInBusy(signIn, agent.id)}
          description={warning ?? undefined}
          descriptionId={warning ? warningId : undefined}
          onSelect={() => {
            setIsMenuOpen(false);
            signIn.check(agent.id);
          }}
        >
          Check sign-in
        </PopoverOption>
      )}
      {canCheckSignIn && !isBusy && signInState !== "needed" && (
        <PopoverOption
          disabled={again === "closed" && isSignInBusy(signIn, agent.id)}
          description={again === "closed" && isOtherAgentBusy ? SIGN_IN_RUNNING_NOTICE : undefined}
          descriptionId={again === "closed" && isOtherAgentBusy ? againNoticeId : undefined}
          onSelect={() => {
            setIsMenuOpen(false);
            if (again === "closed") signIn.openAgain(agent.id);
            else signIn.closeAgain(agent.id);
          }}
        >
          {again === "closed" ? "Sign in again" : "Hide sign-in options"}
        </PopoverOption>
      )}
      {actions.remove && (
        <PopoverOption
          onSelect={() => {
            setIsMenuOpen(false);
            setIsConfirmingRemove(true);
          }}
        >
          Remove
        </PopoverOption>
      )}
    </Popover>
  );

  // One button per row, whichever applies: an install's Cancel, Retry, Update, Add or Install.
  const primary = isBusy ? (
    <Button variant="ghost" size="md" onClick={job.cancel}>
      Cancel
    </Button>
  ) : hasFailed ? (
    <RowButton onClick={retry}>Retry</RowButton>
  ) : actions.update ? (
    // The version is on the line under the name; a screen reader hears it with the button.
    <RowButton onClick={onUpdate} label={`Update to ${agent.updateVersion}`}>
      Update
    </RowButton>
  ) : actions.add ? (
    <RowButton onClick={onAdd}>{hasPlan ? "Install" : "Add"}</RowButton>
  ) : actions.install ? (
    <RowButton onClick={job.install}>Install</RowButton>
  ) : null;

  const failure = hasFailed ? statusLine(agent, plan, isInUse, job) : isBusy ? job.error : null;
  const status = canCheckSignIn ? signInStatus(agent.name, signIn, agent.id) : null;
  const hasStatusText = status !== null && status.text !== "";
  const hasUnder = showsMethods || hasStatusText || isConfirmingRemove || failure !== null || removeError !== null;

  return (
    <li aria-label={agent.name} className="flex flex-col border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <AgentTile profileId={agent.id} name="" size={28} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-fg">{agent.name}</span>
          {secondLine}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {signInState && !isBusy && <SignInStatus state={signInState} />}
          {primary}
          {menu}
        </div>
      </div>

      {(hasUnder || status !== null) && (
        // With nothing to show, the box steps aside and only the empty live region stays.
        <div className={hasUnder ? "mb-3.5 ml-14 mr-4 flex flex-col gap-2.5" : "contents"}>
          {showsMethods && signIn && (
            <div ref={listRef}>
              <AgentSignIn agentId={agent.id} agentName={agent.name} signIn={signIn} isAgain={isAgainShown} />
            </div>
          )}
          {status !== null && (
            // One region, always mounted, so a check started from ⋯ is read out when its result arrives.
            <p role="status" className={!hasStatusText ? "sr-only" : status.isError ? "text-ui-sm text-danger" : "text-ui-sm text-fg-muted"}>
              {status.text}
            </p>
          )}
          {isConfirmingRemove && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-sheet px-3 py-2.5">
              <p className="text-ui text-fg-secondary">{removeQuestion(agent.name, runningSessionCount)}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="md" onClick={() => setIsConfirmingRemove(false)}>
                  Cancel
                </Button>
                <Button
                  ref={confirmRef}
                  variant="danger"
                  size="md"
                  onClick={() => {
                    setIsConfirmingRemove(false);
                    onRemove();
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          )}
          {failure && <p className="text-ui-sm text-danger">{failure}</p>}
          {removeError && (
            <p role="alert" className="text-ui-sm text-danger">
              {removeError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
