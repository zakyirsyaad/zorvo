import { useState } from "react";
import { Settings2 } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { Button } from "../ui/Button";
import { Popover, PopoverHeader } from "../ui/Popover";
import { isInUse, type EnabledSettings } from "../../lib/enabled-agents";
import { SIGN_IN_LABELS, SIGN_IN_STATUS_WORDS, type SignInState } from "../../lib/agent-sign-in";
import { AgentSignIn, isSignInBusy, signInStatus } from "../agents/AgentSignIn";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import type { AgentProfile } from "../../types";

/** How many tiles the footer button stacks. */
const SHOWN_LOGOS = 3;

/**
 * The panel spans the sidebar's footer, 8px in from each side and 8px above it. It anchors to
 * the footer's box, so a narrow sidebar can never cut it off at the button's edge.
 */
const PANEL_PLACEMENT = "left-2 right-2 bottom-[60px]";

export interface AgentsMenuProps {
  agents: readonly AgentProfile[];
  /** Decides which registry agents are in use; the defaults apply when absent. */
  settings?: EnabledSettings;
  /** Where each agent stands on signing in; every agent reads Ready when absent. */
  signInStateOf?: (profileId: string) => SignInState;
  /** Starts a new session with an agent that is not ready, which asks it and shows its sign-in; used while no folder is open. */
  onSetUpAgent?: (profileId: string) => void;
  /** Settings' sign-in, so an agent signs in or is checked inside its row, with no new session. */
  signIn?: SettingsSignIn;
  /** Opens Settings → Agents. */
  onManageAgents: () => void;
}

interface StateCellProps {
  agentName: string;
  state: SignInState;
  /** Sign in or Check was pressed; absent, the state is words only. */
  onAct?: () => void;
  isBusy?: boolean;
}

/**
 * An agent's sign-in state as the menu draws it: Ready with a green dot; Needs sign-in with an amber
 * dot and a Sign in button; Not checked yet in subtle words with Check. The words are Settings' own.
 */
function StateCell({ agentName, state, onAct, isBusy = false }: StateCellProps) {
  if (state === "ready") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-caption text-fg-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-status-running" />
        {SIGN_IN_STATUS_WORDS.ready}
      </span>
    );
  }
  if (state === "needed") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-caption text-fg-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-status-attention" />
        {SIGN_IN_STATUS_WORDS.needed}
        {onAct && (
          <Button variant="outline" size="sm" disabled={isBusy} aria-label={`Sign in to ${agentName}`} onClick={onAct} className="ml-1">
            <span className="text-fg">{SIGN_IN_LABELS.needed}</span>
          </Button>
        )}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-caption text-fg-subtle">
      {SIGN_IN_STATUS_WORDS.unchecked}
      {onAct && (
        <button
          type="button"
          disabled={isBusy}
          onClick={onAct}
          aria-label={`Check ${agentName}`}
          className="rounded px-1 text-caption text-fg-secondary transition-colors enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
        >
          Check
        </button>
      )}
    </span>
  );
}

/** Under an agent's row once Sign in or Check was pressed: its methods, and one live line for the check or sign-in. */
function RowSignIn({ agentId, agentName, state, signIn }: { agentId: string; agentName: string; state: SignInState; signIn: SettingsSignIn }) {
  const status = signInStatus(agentName, signIn, agentId);
  const showsMethods = state === "needed" || signIn.methodsOf(agentId).length > 0;
  return (
    <div className="flex flex-col gap-2 px-2 pb-2.5 pl-8">
      {showsMethods && state !== "ready" && <AgentSignIn agentId={agentId} agentName={agentName} signIn={signIn} isAgain={state !== "needed"} />}
      <p role="status" className={status.text === "" ? "sr-only" : status.isError ? "text-ui-sm text-danger" : "text-ui-sm text-fg-muted"}>
        {status.text}
      </p>
    </div>
  );
}

/**
 * The footer's Agents button: the tiles of the agents in use, with a dot when one needs
 * a sign-in. It opens their list with each one's sign-in state, and Manage agents.
 * Renders nothing while no installed agent is in use.
 */
export function AgentsMenu({ agents, settings = {}, signInStateOf, onSetUpAgent, signIn, onManageAgents }: AgentsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // The agent whose sign-in shows under its row: in the menu, so the screen behind it stays.
  const [openId, setOpenId] = useState<string | null>(null);
  const listed = agents.filter((agent) => agent.detected && isInUse(agent, settings));
  if (listed.length === 0) return null;
  const stateOf = (profileId: string): SignInState => signInStateOf?.(profileId) ?? "ready";
  const needsSignIn = listed.some((agent) => stateOf(agent.id) === "needed");

  /**
   * What Sign in or Check does. With a folder open, the agent's sign-in opens under its row (its methods
   * read without a session when none are known) or it is checked there; with none, a new session asks it.
   */
  const actFor = (profileId: string, state: SignInState): (() => void) | undefined => {
    if (state === "ready") return undefined;
    if (signIn?.cwd === undefined) {
      if (!onSetUpAgent) return undefined;
      return () => {
        // The new session's sign-in panel takes over; the menu would only cover the footer.
        setIsOpen(false);
        onSetUpAgent(profileId);
      };
    }
    return () => {
      setOpenId(profileId);
      if (state === "unchecked") signIn.check(profileId);
      else if (signIn.methodsOf(profileId).length === 0) signIn.openAgain(profileId);
    };
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
        setOpenId(null);
      }}
      label="Agents in use"
      role="dialog"
      panelClassName={PANEL_PLACEMENT}
      trigger={
        <button
          type="button"
          aria-label={needsSignIn ? "Agents, sign-in needed" : "Agents"}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="relative flex h-7 items-center rounded-md px-1.5 transition-colors hover:bg-surface-hover aria-expanded:bg-surface-hover focus-ring"
        >
          <span aria-hidden="true" className="flex -space-x-1">
            {listed.slice(0, SHOWN_LOGOS).map((agent) => (
              // The tile's fill is translucent, so each sits on an opaque backing in the sidebar's color.
              <span key={agent.id} className="flex rounded bg-ground ring-2 ring-ground">
                <AgentTile profileId={agent.id} name={agent.name} size={16} />
              </span>
            ))}
          </span>
          {needsSignIn && (
            <span
              aria-hidden="true"
              className="absolute right-[3px] top-[3px] size-1.5 rounded-full bg-status-attention ring-2 ring-ground"
            />
          )}
        </button>
      }
    >
      <PopoverHeader>Agents in use</PopoverHeader>
      <ul className="space-y-0.5">
        {listed.map((agent) => {
          const state = stateOf(agent.id);
          const isRowOpen = openId === agent.id;
          return (
            <li key={agent.id} title={agent.detected_path ?? undefined} className={`rounded-md ${state === "needed" || isRowOpen ? "bg-surface-hover" : ""}`}>
              <div className="flex h-7 items-center justify-between gap-2 px-2 text-ui text-fg-secondary">
                <span className="flex min-w-0 items-center gap-2">
                  <AgentTile profileId={agent.id} name={agent.name} size={16} />
                  <span className="truncate">{agent.name}</span>
                </span>
                <StateCell
                  agentName={agent.name}
                  state={state}
                  isBusy={signIn !== undefined && isSignInBusy(signIn, agent.id)}
                  onAct={actFor(agent.id, state)}
                />
              </div>
              {isRowOpen && signIn && <RowSignIn agentId={agent.id} agentName={agent.name} state={state} signIn={signIn} />}
            </li>
          );
        })}
      </ul>
      <div role="separator" className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={() => {
          setIsOpen(false);
          onManageAgents();
        }}
        className="flex min-h-7.5 w-full items-center gap-2 rounded px-2 text-left text-ui text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg focus-ring"
      >
        <Settings2 size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
        Manage agents
      </button>
    </Popover>
  );
}
