import { useState, useSyncExternalStore } from "react";
import { isAgentRunnable } from "../lib/agent-readiness";
import { installEntryOf, subscribeToInstalls } from "../lib/agent-installs";
import type { SignInState } from "../lib/agent-sign-in";
import { enabledAgentIds, type EnabledSettings } from "../lib/enabled-agents";
import { defaultOf, startAgentOf, startGate, visibleAgents } from "../lib/onboarding";
import type { AgentCatalog, AgentProfile, Settings } from "../types";
import { AgentChoices } from "./onboarding/AgentChoices";
import { FolderChoice } from "./onboarding/FolderChoice";
import { Wordmark } from "./onboarding/Wordmark";
import { toFolderOption, type FolderOption, type OnboardingResult } from "./onboarding/types";
import { Button } from "./ui/Button";

export type { FolderOption, OnboardingResult } from "./onboarding/types";

export interface OnboardingProps {
  catalog: AgentCatalog | null;
  /** The agent profiles: whether an agent can run now. */
  agents: readonly AgentProfile[];
  settings: EnabledSettings & Pick<Settings, "defaultAgentId">;
  signInStateOf: (id: string) => SignInState;
  /** True for an agent whose only way in is its own setup (Qwen Code). */
  isSetupOnly: (id: string) => boolean;
  /** Puts an agent in use, installing it when it needs to be. */
  onTick: (id: string) => void;
  /** Takes an agent out of use and stops its install; never deletes it. */
  onUntick: (id: string) => void;
  onMakeDefault: (id: string) => void;
  recentFolders: readonly FolderOption[];
  suggestedFolders: readonly FolderOption[];
  onPickFolder: () => Promise<FolderOption | null>;
  onComplete: (result: OnboardingResult) => void;
}

const NOTE_ID = "onboarding-start-note";

/** The install status of each of `ids`, kept in step with the installs store. */
function useInstalling(ids: readonly string[]): ReadonlySet<string> {
  const key = useSyncExternalStore(subscribeToInstalls, () =>
    ids.filter((id) => installEntryOf(id).status === "installing").join(","),
  );
  return new Set(key === "" ? [] : key.split(","));
}

/**
 * The welcome screen, shown before any session (and again from Settings → Run setup again): tick the
 * agents you'll use, pick a project folder, and Start, which opens a new-session draft there with the
 * default agent. Sign-in is not asked here; the draft asks when it needs to.
 */
export function Onboarding({
  catalog,
  agents,
  settings,
  signInStateOf,
  isSetupOnly,
  onTick,
  onUntick,
  onMakeDefault,
  recentFolders,
  suggestedFolders,
  onPickFolder,
  onComplete,
}: OnboardingProps) {
  const [folder, setFolder] = useState<FolderOption | null>(() =>
    recentFolders[0] ? toFolderOption(recentFolders[0]) : null,
  );
  const enabledIds = enabledAgentIds(settings);
  const catalogAgents = catalog?.agents ?? [];
  // Ticked agents in the order the screen lists them, so "the first ticked" is the first row ticked.
  const ticked = visibleAgents(catalogAgents, enabledIds, true).filter((agent) => enabledIds.includes(agent.id));
  const tickedIds = ticked.map((agent) => agent.id);
  const installing = useInstalling(tickedIds);
  const isReady = (id: string) => {
    const profile = agents.find((agent) => agent.id === id);
    return profile !== undefined && isAgentRunnable(profile) && !installing.has(id);
  };
  const preferred = settings.defaultAgentId ?? null;
  const defaultId = defaultOf(tickedIds, preferred);
  const gate = startGate({
    ticked: ticked.map((agent) => ({ id: agent.id, name: agent.name, isReady: isReady(agent.id), isInstalling: installing.has(agent.id) })),
    defaultId,
    folder,
  });

  const start = () => {
    const startId = startAgentOf(tickedIds, preferred, isReady);
    if (gate.canStart && startId && folder) onComplete({ defaultAgentId: startId, folder });
  };

  return (
    <main className="relative flex h-screen w-full justify-center overflow-y-auto bg-bg px-6 py-16 text-fg-secondary">
      {/* The window's own buttons sit here; the strip drags the window. */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
      <div className="flex w-full max-w-[640px] flex-col gap-7">
        <header className="flex flex-col gap-3">
          <Wordmark />
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.03em] text-fg">Every coding agent. One desktop.</h1>
          <p className="text-sm leading-[22px] text-fg-muted">
            Pick the agents you'll use and a project folder. You can change all of this later in Settings.
          </p>
        </header>

        <AgentChoices
          catalog={catalogAgents}
          enabledIds={enabledIds}
          defaultId={defaultId}
          signInStateOf={signInStateOf}
          isSetupOnly={isSetupOnly}
          onTick={onTick}
          onUntick={onUntick}
          onMakeDefault={onMakeDefault}
        />

        <FolderChoice
          folder={folder}
          recentFolders={recentFolders}
          suggestedFolders={suggestedFolders}
          onChoose={setFolder}
          onPickFolder={onPickFolder}
        />

        <footer className="flex items-center gap-3 pt-2">
          <p id={NOTE_ID} role="status" className="min-w-0 flex-1 text-ui-sm text-fg-subtle">
            {gate.note}
          </p>
          <Button
            variant="primary"
            size="lg"
            disabled={!gate.canStart}
            aria-describedby={gate.note ? NOTE_ID : undefined}
            onClick={start}
          >
            Start
          </Button>
        </footer>
      </div>
    </main>
  );
}
