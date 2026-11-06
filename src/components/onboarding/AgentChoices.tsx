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
import { orderedAgents, rowWords } from "../../lib/onboarding";
import type { CatalogAgent } from "../../types";

export interface AgentChoicesProps {
  catalog: readonly CatalogAgent[];
  enabledIds: readonly string[];
  defaultId: string | null;
  signInStateOf: (id: string) => SignInState;
  isSetupOnly: (id: string) => boolean;
  /** Puts an agent in use; it installs nothing. */
  onTick: (id: string) => void;
  /** Installs a ticked agent that is not installed (its row's Install). */
  onInstall: (id: string) => void;
  onUntick: (id: string) => void;
  onMakeDefault: (id: string) => void;
  /** The rows' order, fixed when the screen first had agents, so a row never moves under the pointer. */
  order?: readonly string[];
  isLoading?: boolean;
  /** Why the agents could not be read, with `onRetry` to read them again. */
  loadError?: string | null;
  onRetry?: () => void;
  /** Reads the agents and the registry again (an agent installed elsewhere meanwhile). */
  onCheckAgain?: () => Promise<void>;
}

/** Rows shown before Show all agents. */
const FIRST_ROWS = 5;

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
  onInstall: () => void;
  onUntick: () => void;
  onMakeDefault: () => void;
}

function ChoiceRow({ agent, isTicked, isDefault, signIn, isSetupOnly, onTick, onInstall, onUntick, onMakeDefault }: ChoiceRowProps) {
  const job = useAgentInstall(agent.id);
  const isInstalling = job.status === "installing";
  const hasFailed = job.status === "failed" && isTicked;
  const words = rowWords(agent, signIn, isSetupOnly, isTicked);
  // Ticked but not installed: a default agent on a new Mac, or an install that was stopped.
  const needsInstall = isTicked && agent.status === "not_installed" && !isInstalling && !hasFailed;

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
  ) : needsInstall ? (
    <Button size="md" onClick={onInstall} aria-label={`Install ${agent.name}`}>
      <span className="text-fg">Install</span>
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

/** Section 1 of the welcome screen: tick the agents you'll use; a ticked one that is not installed offers Install. */
export function AgentChoices({
  catalog,
  enabledIds,
  defaultId,
  signInStateOf,
  isSetupOnly,
  onTick,
  onInstall,
  onUntick,
  onMakeDefault,
  order,
  isLoading = false,
  loadError = null,
  onRetry,
  onCheckAgain,
}: AgentChoicesProps) {
  const [showAll, setShowAll] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  // Rows ticked or unticked here stay on screen until the screen goes, even past the first five.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const live = orderedAgents(catalog, enabledIds);
  const byId = new Map(live.map((agent) => [agent.id, agent]));
  const fixed = (order ?? live.map((agent) => agent.id)).flatMap((id) => byId.get(id) ?? []);
  const all = [...fixed, ...live.filter((agent) => !fixed.includes(agent))];
  // The first rows as the screen first showed them; an agent in use is never cut.
  const [first, setFirst] = useState<ReadonlySet<string> | null>(null);
  if (first === null && all.length > 0) {
    setFirst(new Set(all.filter((agent, index) => index < FIRST_ROWS || enabledIds.includes(agent.id)).map((agent) => agent.id)));
  }
  const shown = showAll
    ? all
    : all.filter((agent) => first?.has(agent.id) || kept.has(agent.id) || enabledIds.includes(agent.id));
  const keep = (id: string) => setKept((current) => new Set(current).add(id));

  const checkAgain = () => {
    if (!onCheckAgain) return;
    setIsChecking(true);
    void onCheckAgain().finally(() => setIsChecking(false));
  };

  return (
    <section className="flex flex-col gap-2.5">
      <NumberedHeading number={1}>Agents you'll use</NumberedHeading>
      <ul aria-label="Agents you'll use" className="flex flex-col rounded-xl border border-border bg-surface-2">
        {shown.length === 0 && (isLoading || loadError) && (
          <li>
            <SettingsRow
              isTight
              label={
                loadError ? (
                  <span className="text-danger">{`Could not load the agents: ${loadError}`}</span>
                ) : (
                  <span className="text-fg-subtle">Loading the agents…</span>
                )
              }
              control={
                loadError && onRetry ? (
                  <Button size="md" onClick={onRetry}>
                    <span className="text-fg">Try again</span>
                  </Button>
                ) : undefined
              }
            />
          </li>
        )}
        {shown.map((agent) => (
          <ChoiceRow
            key={agent.id}
            agent={agent}
            isTicked={enabledIds.includes(agent.id)}
            isDefault={agent.id === defaultId}
            signIn={signInStateOf(agent.id)}
            isSetupOnly={isSetupOnly(agent.id)}
            onTick={() => {
              keep(agent.id);
              onTick(agent.id);
            }}
            onInstall={() => onInstall(agent.id)}
            onUntick={() => {
              keep(agent.id);
              onUntick(agent.id);
            }}
            onMakeDefault={() => onMakeDefault(agent.id)}
          />
        ))}
      </ul>
      <div className="flex items-center gap-1">
        {(showAll || all.length > shown.length) && (
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
            className="h-6.5 rounded px-1 text-ui-sm text-fg-muted focus-ring"
          >
            {showAll ? "Show fewer agents" : "Show all agents"}
          </button>
        )}
        {onCheckAgain && (
          <button
            type="button"
            disabled={isChecking}
            onClick={checkAgain}
            className="h-6.5 rounded px-1 text-ui-sm text-fg-muted focus-ring disabled:opacity-40"
          >
            Check again
          </button>
        )}
      </div>
    </section>
  );
}
