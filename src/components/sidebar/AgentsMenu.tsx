import { useState } from "react";
import { AgentLogo } from "../AgentLogo";
import { Popover, PopoverHeader } from "../ui/Popover";
import { isInUse, type EnabledSettings } from "../../lib/enabled-agents";
import { SIGN_IN_CHIP_STYLES, SIGN_IN_LABELS, type SignInState } from "../../lib/agent-sign-in";
import type { AgentProfile } from "../../types";

/** How many logos the footer button stacks. */
const SHOWN_LOGOS = 3;

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

/** An agent's sign-in state; one that is not ready opens a new session with it, where the sign-in is checked and shown. */
function SignInChip({ agentName, state, onSetUp }: { agentName: string; state: SignInState; onSetUp?: () => void }) {
  const style = SIGN_IN_CHIP_STYLES[state];
  const content = (
    <>
      <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${style.dot}`} />
      {SIGN_IN_LABELS[state]}
    </>
  );
  const className = `flex shrink-0 items-center gap-1 text-caption font-medium ${style.text}`;
  if (state === "ready" || !onSetUp) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onSetUp}
      aria-label={state === "needed" ? `Sign in to ${agentName}` : `Check ${agentName}`}
      className={`${className} rounded px-1 hover:bg-surface-hover focus-ring`}
    >
      {content}
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
      side="top"
      align="end"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label={needsSignIn ? "Agents, sign-in needed" : "Agents"}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="relative flex h-7 items-center rounded-md px-1.5 transition-colors hover:bg-surface-hover focus-ring"
        >
          <span aria-hidden="true" className="flex -space-x-1">
            {listed.slice(0, SHOWN_LOGOS).map((agent) => (
              <span key={agent.id} className="flex rounded-full bg-bg ring-1 ring-bg">
                <AgentLogo profileId={agent.id} name={agent.name} size={14} />
              </span>
            ))}
          </span>
          {needsSignIn && (
            <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-status-attention" />
          )}
        </button>
      }
    >
      <PopoverHeader>Agents in use</PopoverHeader>
      <ul className="space-y-0.5">
        {listed.map((agent) => (
          <li
            key={agent.id}
            title={agent.detected_path ?? undefined}
            className="flex min-h-7.5 items-center justify-between gap-2 rounded px-2 text-ui text-fg-secondary"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AgentLogo profileId={agent.id} name={agent.name} />
              <span className="truncate">{agent.name}</span>
            </span>
            <SignInChip
              agentName={agent.name}
              state={stateOf(agent.id)}
              onSetUp={onSetUpAgent ? () => onSetUpAgent(agent.id) : undefined}
            />
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-border pt-1">
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            onManageAgents();
          }}
          className="flex min-h-7.5 w-full items-center rounded px-2 text-left text-ui text-fg transition-colors hover:bg-surface-hover focus-ring"
        >
          Manage agents
        </button>
      </div>
    </Popover>
  );
}
