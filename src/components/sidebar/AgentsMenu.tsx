import { useState } from "react";
import { Settings2 } from "lucide-react";
import { AgentLogo } from "../AgentLogo";
import { Button } from "../ui/Button";
import { Popover, PopoverHeader } from "../ui/Popover";
import { isInUse, type EnabledSettings } from "../../lib/enabled-agents";
import { SIGN_IN_LABELS, type SignInState } from "../../lib/agent-sign-in";
import type { AgentProfile } from "../../types";

/** How many logos the footer button stacks. */
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
  /** Starts a new session with an agent that is not ready, which asks it and shows its sign-in. */
  onSetUpAgent?: (profileId: string) => void;
  /** Opens Settings → Agents. */
  onManageAgents: () => void;
}

/**
 * An agent's sign-in state as the menu draws it: Ready in muted words with a green dot; a Sign in
 * button when one is needed; Not checked in subtle words. Either of the last two opens a new
 * session with the agent, where the sign-in is checked and shown.
 */
function StateCell({ agentName, state, onSetUp }: { agentName: string; state: SignInState; onSetUp?: () => void }) {
  if (state === "ready") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-caption text-fg-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-status-running" />
        {SIGN_IN_LABELS.ready}
      </span>
    );
  }
  if (state === "needed") {
    if (!onSetUp) return <span className="shrink-0 text-caption text-status-attention">{SIGN_IN_LABELS.needed}</span>;
    return (
      <Button variant="outline" size="sm" aria-label={`Sign in to ${agentName}`} onClick={onSetUp} className="shrink-0">
        <span className="text-fg">{SIGN_IN_LABELS.needed}</span>
      </Button>
    );
  }
  if (!onSetUp) return <span className="shrink-0 text-caption text-fg-subtle">{SIGN_IN_LABELS.unchecked}</span>;
  return (
    <button
      type="button"
      onClick={onSetUp}
      aria-label={`Check ${agentName}`}
      className="shrink-0 rounded px-1 text-caption text-fg-subtle transition-colors hover:text-fg-secondary focus-ring"
    >
      {SIGN_IN_LABELS.unchecked}
    </button>
  );
}

/**
 * The footer's Agents button: the logos of the agents in use, with a dot when one needs
 * a sign-in. It opens their list with each one's sign-in state, and Manage agents.
 * Renders nothing while no installed agent is in use.
 */
export function AgentsMenu({ agents, settings = {}, signInStateOf, onSetUpAgent, onManageAgents }: AgentsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listed = agents.filter((agent) => agent.detected && isInUse(agent, settings));
  if (listed.length === 0) return null;
  const stateOf = (profileId: string): SignInState => signInStateOf?.(profileId) ?? "ready";
  const needsSignIn = listed.some((agent) => stateOf(agent.id) === "needed");

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
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
              <span key={agent.id} className="flex rounded-[4px] bg-surface-1 ring-2 ring-surface-1">
                <AgentLogo profileId={agent.id} name={agent.name} size={16} />
              </span>
            ))}
          </span>
          {needsSignIn && (
            <span
              aria-hidden="true"
              className="absolute right-[3px] top-[3px] size-1.5 rounded-full bg-status-attention ring-2 ring-surface-1"
            />
          )}
        </button>
      }
    >
      <PopoverHeader>Agents in use</PopoverHeader>
      <ul className="space-y-0.5">
        {listed.map((agent) => {
          const state = stateOf(agent.id);
          return (
            <li
              key={agent.id}
              title={agent.detected_path ?? undefined}
              className={`flex min-h-8 items-center justify-between gap-2 rounded-md px-2 text-ui text-fg-secondary ${
                state === "needed" ? "bg-surface-hover" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <AgentLogo profileId={agent.id} name={agent.name} size={16} />
                <span className="truncate">{agent.name}</span>
              </span>
              <StateCell
                agentName={agent.name}
                state={state}
                onSetUp={
                  onSetUpAgent
                    ? () => {
                        // The new session's sign-in panel takes over; the menu would only cover the footer.
                        setIsOpen(false);
                        onSetUpAgent(agent.id);
                      }
                    : undefined
                }
              />
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
