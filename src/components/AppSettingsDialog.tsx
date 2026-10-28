import { useEffect, useRef } from "react";
import { AgentCatalogPanel } from "./agents/AgentCatalogPanel";
import { GithubSection } from "./GithubSection";
import { SettingsPanel, type SettingsTab } from "./SettingsPanel";
import { TerminalSignInDialog } from "./TerminalSignInDialog";
import type { FolderOption } from "./onboarding/types";
import type { AgentCatalogActions } from "../hooks/useAgentCatalogActions";
import type { AgentCatalogHandle } from "../hooks/useAgentCatalog";
import type { SettingsSignIn } from "../hooks/useSettingsSignIn";
import type { GithubConnection } from "../hooks/useGithubConnection";
import type { PersistedStateHandle } from "../hooks/usePersistedState";
import { pendingUpdates } from "../lib/agent-catalog";
import { enabledAgentIds, isInUse } from "../lib/enabled-agents";
import type { AgentProfile, Settings } from "../types";

export type { SettingsTab };

export interface AppSettingsDialogProps {
  isOpen: boolean;
  /** The tab shown when the dialog opens. */
  initialTab?: SettingsTab;
  persisted: Pick<PersistedStateHandle, "state" | "updateState">;
  agents: readonly AgentProfile[];
  refreshAgents: () => Promise<void>;
  catalog: AgentCatalogHandle;
  /** What Add, Update and Remove do; the app's one instance, shared with the screens that offer Add. */
  actions: AgentCatalogActions;
  recentFolders: readonly FolderOption[];
  onRemoveRecentFolder: (path: string) => void;
  onRunOnboarding: () => void;
  onClose: () => void;
  /** The GitHub connection; General shows no GitHub section without it. */
  github?: GithubConnection;
  /** Sign-in state and actions for the agents; the Agents tab shows none without it. */
  agentSignIn?: SettingsSignIn;
  /** Opens a web link in the user's browser. */
  onOpenUrl?: (url: string) => void;
}

/** The app's Settings dialog: General (with the GitHub connection), and the agent catalog with its Add, Update and Remove. */
export function AppSettingsDialog({
  isOpen,
  initialTab,
  persisted: { state, updateState },
  agents,
  refreshAgents,
  catalog,
  actions,
  recentFolders,
  onRemoveRecentFolder,
  onRunOnboarding,
  onClose,
  github,
  agentSignIn,
  onOpenUrl,
}: AppSettingsDialogProps) {
  const githubRef = useRef<HTMLDivElement>(null);
  const hadSignInDialog = useRef(false);
  const hasSignInDialog = Boolean(github?.dialog);
  useEffect(() => {
    // The dialog gives focus back to the button that opened it. After a sign-in that worked that button is
    // gone (the card shows the account now), so focus would drop to the page behind Settings.
    if (hadSignInDialog.current && !hasSignInDialog) {
      const focused = document.activeElement;
      if (!focused || focused === document.body) githubRef.current?.focus();
    }
    hadSignInDialog.current = hasSignInDialog;
  }, [hasSignInDialog]);

  // The GitHub sign-in's dialog is drawn even when Settings is not: it belongs to a login that is running.
  const signInDialog = github?.dialog ? (
    <TerminalSignInDialog
      state={github.dialog}
      output={github.output}
      onClose={github.closeDialog}
      onTryAgain={github.connect}
      onInput={github.sendInput}
      onResize={github.resize}
    />
  ) : null;
  // An agent's login started here is drawn above Settings, like the GitHub one; once Settings is closed the app's own layer takes it.
  const agentDialog =
    agentSignIn?.terminal.dialog && isOpen ? (
      <TerminalSignInDialog
        state={agentSignIn.terminal.dialog}
        output={agentSignIn.terminal.output}
        onClose={agentSignIn.cancelSignIn}
        onTryAgain={agentSignIn.retrySignIn}
        onInput={agentSignIn.terminal.sendInput}
        onResize={agentSignIn.terminal.resize}
      />
    ) : null;
  if (!isOpen) return signInDialog;

  const { settings } = state;
  const enabledIds = enabledAgentIds(settings);
  const updateSettings = (patch: Partial<Settings>) =>
    updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  return (
    <>
      <SettingsPanel
        initialTab={initialTab}
        appearance={settings.appearance}
        onChangeAppearance={(appearance) => updateSettings({ appearance })}
        agents={agents.filter((agent) => isInUse(agent, settings))}
        defaultAgentId={settings.defaultAgentId}
        recentFolders={recentFolders}
        onChangeDefaultAgent={(defaultAgentId) => updateSettings({ defaultAgentId })}
        onRemoveRecentFolder={onRemoveRecentFolder}
        onRunOnboarding={onRunOnboarding}
        onClose={onClose}
        isEscapeBlocked={signInDialog !== null || agentDialog !== null}
        updateCount={pendingUpdates(catalog.catalog?.agents ?? [], enabledIds).length}
        githubSection={
          github && (
            <GithubSection
              ref={githubRef}
              status={github.status}
              isChecking={github.isChecking}
              onCheck={() => void github.check()}
              onConnect={github.connect}
              onOpenUrl={(url) => onOpenUrl?.(url)}
            />
          )
        }
        agentsPanel={
          <AgentCatalogPanel
            agents={agents}
            settings={settings}
            refreshAgents={refreshAgents}
            catalog={catalog}
            actions={actions}
            signIn={agentSignIn}
          />
        }
      />
      {signInDialog}
      {agentDialog}
    </>
  );
}
