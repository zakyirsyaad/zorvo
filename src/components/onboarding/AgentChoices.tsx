import { useState } from "react";
import { Check } from "lucide-react";
import { AgentLogo } from "../AgentLogo";
import { InstallBar, InstallStatus } from "../InstallProgressLine";
import { SettingsRow } from "../settings/SettingsGroup";
import { Button } from "../ui/Button";
import { StatusLine } from "../ui/StatusLine";
import { useAgentInstall } from "../../hooks/useAgentInstall";
import type { SignInState } from "../../lib/agent-sign-in";
import { statusLine } from "../../lib/agent-catalog";
import { hasMoreAgents, rowWords, visibleAgents } from "../../lib/onboarding";
import type { CatalogAgent } from "../../types";

export interface AgentChoicesProps {
  catalog: readonly CatalogAgent[];
  enabledIds: readonly string[];
  defaultId: string | null;
  signInStateOf: (id: string) => SignInState;
  isSetupOnly: (id: string) => boolean;
  onTick: (id: string) => void;
  onUntick: (id: string) => void;
  onMakeDefault: (id: string) => void;
}

/** A welcome-screen section's heading: its number in a ring, then its name. */
export function NumberedHeading({ number, children }: { number: number; children: string }) {
  return (
    <h2 className="flex items-center gap-2 text-ui font-semibold text-fg">
      <span
        aria-hidden="true"
        className="flex size-5 items-center justify-center rounded-full border border-border-strong text-caption font-normal text-fg-secondary"
      >
        {number}
      </span>
      {children}
    </h2>
  );
}

interface ChoiceRowProps {
  agent: CatalogAgent;
  isTicked: boolean;
  isDefault: boolean;
  signIn: SignInState;
  isSetupOnly: boolean;
  onTick: () => void;
  onUntick: () => void;
  onMakeDefault: () => void;
}

function ChoiceRow({ agent, isTicked, isDefault, signIn, isSetupOnly, onTick, onUntick, onMakeDefault }: ChoiceRowProps) {
  const job = useAgentInstall(agent.id);
  const isInstalling = job.status === "installing";
  const hasFailed = job.status === "failed" && isTicked;
  const words = rowWords(agent, signIn, isSetupOnly);

  const description = isInstalling ? (
    <>
      <InstallStatus progress={job.progress} action={job.action} isCompact />
      <div className="mt-1.5">
        <InstallBar progress={job.progress} />
      </div>
    </>
  ) : hasFailed ? (
    <span className="text-danger">{statusLine(agent, null, true, job)}</span>
  ) : (
    <StatusLine status={agent.status !== "not_installed" && signIn === "ready" ? "ready" : "idle"}>{words}</StatusLine>
  );

  const control = hasFailed ? (
    <Button size="md" onClick={job.install}>
      <span className="text-fg">Retry</span>
    </Button>
  ) : isTicked && !isDefault ? (
    <Button
      variant="ghost"
      size="md"
      onClick={onMakeDefault}
      aria-label={`Make default for ${agent.name}`}
      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      Make default
    </Button>
  ) : undefined;

  return (
    // The hairline is the item's: the row inside is always its item's last child.
    <li className="border-b border-border last:border-b-0">
      <SettingsRow
        isTight
        className="group"
        leading={
          <>
            <span className="relative flex size-4 shrink-0">
              <input
                type="checkbox"
                checked={isTicked}
                onChange={(event) => (event.target.checked ? onTick() : onUntick())}
                aria-label={`Use ${agent.name}`}
                className="peer size-4 shrink-0 cursor-pointer appearance-none rounded border-[1.5px] border-border-strong checked:border-fg checked:bg-fg focus-ring"
              />
              <Check
                size={11}
                strokeWidth={3}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 m-auto hidden text-bg peer-checked:block"
              />
            </span>
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-hover">
              <AgentLogo profileId={agent.id} name="" size={16} />
            </span>
          </>
        }
        label={
          <span className="flex items-center gap-2">
            {agent.name}
            {isDefault && (
              <span className="inline-flex h-4.5 items-center rounded border border-border px-1.5 text-[10px] font-medium text-fg-muted">
                Default
              </span>
            )}
          </span>
        }
        description={description}
        control={control}
      />
    </li>
  );
}

/** Section 1 of the welcome screen: tick the agents you'll use; ticking one Zorvo must install installs it. */
export function AgentChoices({
  catalog,
  enabledIds,
  defaultId,
  signInStateOf,
  isSetupOnly,
  onTick,
  onUntick,
  onMakeDefault,
}: AgentChoicesProps) {
  const [showAll, setShowAll] = useState(false);
  const agents = visibleAgents(catalog, enabledIds, showAll);
  return (
    <section className="flex flex-col gap-2.5">
      <NumberedHeading number={1}>Agents you'll use</NumberedHeading>
      <ul aria-label="Agents you'll use" className="flex flex-col rounded-xl border border-border bg-surface-2">
        {agents.map((agent) => (
          <ChoiceRow
            key={agent.id}
            agent={agent}
            isTicked={enabledIds.includes(agent.id)}
            isDefault={agent.id === defaultId}
            signIn={signInStateOf(agent.id)}
            isSetupOnly={isSetupOnly(agent.id)}
            onTick={() => onTick(agent.id)}
            onUntick={() => onUntick(agent.id)}
            onMakeDefault={() => onMakeDefault(agent.id)}
          />
        ))}
      </ul>
      {(showAll || hasMoreAgents(catalog, enabledIds)) && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
          className="h-6.5 self-start rounded px-1 text-ui-sm text-fg-muted focus-ring"
        >
          {showAll ? "Show fewer agents" : "Show all agents"}
        </button>
      )}
    </section>
  );
}
