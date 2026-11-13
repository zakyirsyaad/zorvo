import { useState } from "react";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import { InstallBar, InstallStatus } from "../InstallProgressLine";
import { AgentSignIn, signInStatus } from "./AgentSignIn";
import { SignInChip } from "./SignInChip";
import { AgentTile } from "../ui/AgentTile";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { useAgentInstall } from "../../hooks/useAgentInstall";
import { useConfirmFocus } from "../../hooks/useConfirmFocus";
import { availableLine, rowActions, sourceLine, statusLine } from "../../lib/agent-catalog";
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

/** An outline button whose label reads `fg`, as the canvas's row buttons do. */
function RowButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button size="md" onClick={onClick}>
      <span className="text-fg">{children}</span>
    </Button>
  );
}

/**
 * One agent in Settings → Agents, as one line: its logo tile, name and where it comes from (or what Add
 * would install), its sign-in chip, and its buttons. Under the line, indented to the name: the sign-in
 * panel when opened, Remove's question, and what failed.
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

  // The sign-in opens by itself when the agent comes to need one, and stays open once it is ready, so
  // the result shows; the chevron opens and closes it.
  const [isSignInOpen, setIsSignInOpen] = useState(signInState === "needed");
  const [seenState, setSeenState] = useState(signInState);
  if (signInState !== seenState) {
    setSeenState(signInState);
    if (signInState === "needed") setIsSignInOpen(true);
  }
  const isOpen = canCheckSignIn && isSignInOpen;
  // An install or update hides the chevron, so the panel steps aside with it until the job ends.
  const showsPanel = isOpen && !isBusy;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const { confirmRef, returnRef: moreRef } = useConfirmFocus(isConfirmingRemove);

  const secondLine = isBusy ? (
    <>
      <InstallStatus progress={job.progress} action={job.action} isCompact />
      <div className="mt-1.5">
        <InstallBar progress={job.progress} />
      </div>
    </>
  ) : isInUse && (agent.status !== "not_installed" || !hasPlan) ? (
    <span className="truncate font-mono text-caption text-fg-muted" title={agent.location ?? undefined}>
      {sourceLine(agent)}
    </span>
  ) : (
    <span className="text-ui-sm text-fg-muted">{availableLine(agent, plan)}</span>
  );

  // Remove stays offered while an install runs: removing ends the install too.
  const removeMenu = actions.remove && (
    <Popover
      isOpen={isMenuOpen}
      onClose={() => setIsMenuOpen(false)}
      label={`Actions for ${agent.name}`}
      role="menu"
      align="end"
      className="w-40"
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
      <PopoverOption
        onSelect={() => {
          setIsMenuOpen(false);
          setIsConfirmingRemove(true);
        }}
      >
        Remove
      </PopoverOption>
    </Popover>
  );

  const controls = isBusy ? (
    <>
      <Button variant="ghost" size="md" onClick={job.cancel}>
        Cancel
      </Button>
      {removeMenu}
    </>
  ) : (
    <>
      {signInState && <SignInChip state={signInState} />}
      {actions.update && <RowButton onClick={onUpdate}>{`Update to ${agent.updateVersion}`}</RowButton>}
      {actions.add && <RowButton onClick={onAdd}>{hasPlan ? "Install" : "Add"}</RowButton>}
      {actions.install && !hasFailed && <RowButton onClick={job.install}>Install</RowButton>}
      {hasFailed && <RowButton onClick={retry}>Retry</RowButton>}
      {canCheckSignIn && (
        <IconButton
          label={`${isOpen ? "Hide" : "Show"} sign-in for ${agent.name}`}
          aria-expanded={isOpen}
          onClick={() => setIsSignInOpen(!isOpen)}
        >
          {isOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </IconButton>
      )}
      {removeMenu}
    </>
  );

  const failure = hasFailed ? statusLine(agent, plan, isInUse, job) : isBusy ? job.error : null;
  const hasUnder = showsPanel || isConfirmingRemove || failure !== null || removeError !== null;
  // While the panel is closed, a check's result is still read out, from the row.
  const closedStatus = canCheckSignIn && !showsPanel ? signInStatus(agent.name, signIn, agent.id).text : null;

  return (
    // No tint on an opened or installing row: the panel under the line is what shows it.
    <li aria-label={agent.name} className="flex flex-col border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <AgentTile profileId={agent.id} name="" size={28} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-fg">{agent.name}</span>
          {secondLine}
        </div>
        <div className="flex shrink-0 items-center gap-2">{controls}</div>
      </div>

      {closedStatus !== null && (
        <p role="status" className="sr-only">
          {closedStatus}
        </p>
      )}
      {hasUnder && (
        <div className="mb-3.5 ml-14 mr-4 flex flex-col gap-2.5">
          {showsPanel && signIn && <AgentSignIn agentId={agent.id} agentName={agent.name} signIn={signIn} />}
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
