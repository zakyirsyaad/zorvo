import { useEffect, useId, useRef, type ReactNode } from "react";
import { AgentCatalogPanel } from "../agents/AgentCatalogPanel";
import { AgentToolsSetting } from "./AgentToolsSetting";
import { TerminalSignInDialog } from "../TerminalSignInDialog";
import type { FolderOption } from "../onboarding/types";
import { ToastStack } from "../ui/Toast";
import type { AgentCatalogActions } from "../../hooks/useAgentCatalogActions";
import type { AgentCatalogHandle } from "../../hooks/useAgentCatalog";
import type { GithubConnection } from "../../hooks/useGithubConnection";
import type { PersistedStateHandle } from "../../hooks/usePersistedState";
import type { SettingsPage as SettingsPageState } from "../../hooks/useSettingsPage";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import { isInUse } from "../../lib/enabled-agents";
import type { AgentProfile, Settings } from "../../types";
import { AppearanceSection } from "./AppearanceSection";
import { GeneralSection, type GeneralAppUpdate } from "./GeneralSection";
import { GithubSection } from "./GithubSection";
import { SettingsHeader } from "./SettingsGroup";
import { SettingsNav } from "./SettingsNav";

export interface SettingsPageProps {
  page: SettingsPageState;
  persisted: Pick<PersistedStateHandle, "state" | "updateState">;
  agents: readonly AgentProfile[];
  refreshAgents: () => Promise<void>;
  catalog: AgentCatalogHandle;
  /** What Add, Update and Remove do; the app's one instance, shared with the screens that offer Add. */
  actions: AgentCatalogActions;
  /** Agents in use with an update: the sidebar footer's count. */
  updateCount: number;
  recentFolders: readonly FolderOption[];
  onRemoveRecentFolder: (path: string) => void;
  onRunOnboarding: () => void;
  appVersion?: string;
  appUpdate: GeneralAppUpdate;
  /** What Update & restart would stop, or null when nothing. */
  restartNote: string | null;
  /** The app's notice while Settings shows (the sessions' column, where it lives otherwise, is hidden). */
  notice?: ReactNode;
  /** The GitHub connection; Settings shows no GitHub section without it. */
  github?: GithubConnection;
  /** Sign-in state and actions for the agents; the Agents section shows none without it. */
  agentSignIn?: SettingsSignIn;
  /** Opens a web link in the user's browser. */
  onOpenUrl?: (url: string) => void;
}

/**
 * Settings as a page in the main window, in place of the sidebar and the sessions (which stay mounted,
 * hidden, so nothing typed there is lost): the left navigation, then the section on screen.
 */
export function SettingsPage({
  page,
  persisted: { state, updateState },
  agents,
  refreshAgents,
  catalog,
  actions,
  updateCount,
  recentFolders,
  onRemoveRecentFolder,
  onRunOnboarding,
  appVersion,
  appUpdate,
  restartNote,
  notice,
  github,
  agentSignIn,
  onOpenUrl,
}: SettingsPageProps) {
  const { section } = page;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const githubRef = useRef<HTMLDivElement>(null);
  const hadSignInDialog = useRef(false);
  const hasSignInDialog = Boolean(github?.dialog);
  const isOpen = section !== null;

  useEffect(() => {
    // The dialog gives focus back to the button that opened it. After a sign-in that worked that button is
    // gone (the row shows the account now), so focus would drop to the page behind it.
    if (hadSignInDialog.current && !hasSignInDialog) {
      const focused = document.activeElement;
      if (!focused || focused === document.body) githubRef.current?.focus();
    }
    hadSignInDialog.current = hasSignInDialog;
  }, [hasSignInDialog]);

  // Opening Settings reads out the section's title; moving between sections keeps focus on the nav link.
  useEffect(() => {
    if (isOpen) titleRef.current?.focus();
  }, [isOpen]);

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
  // An agent's login started here is drawn above Settings; once Settings is closed the app's own layer takes it.
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
  if (section === null) return signInDialog;

  const { settings } = state;
  const updateSettings = (patch: Partial<Settings>) =>
    updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  const heading = { titleRef, titleId };

  const content = (() => {
    switch (section) {
      case "general":
        return (
          <GeneralSection
            {...heading}
            agents={agents.filter((agent) => isInUse(agent, settings))}
            defaultAgentId={settings.defaultAgentId}
            onChangeDefaultAgent={(defaultAgentId) => updateSettings({ defaultAgentId })}
            recentFolders={recentFolders}
            onRemoveRecentFolder={onRemoveRecentFolder}
            appVersion={appVersion}
            appUpdate={appUpdate}
            restartNote={restartNote}
            onRunOnboarding={onRunOnboarding}
          />
        );
      case "appearance":
        return (
          <AppearanceSection
            {...heading}
            appearance={settings.appearance}
            onChange={(appearance) => updateSettings({ appearance })}
          />
        );
      case "agents":
        return (
          <div className="flex flex-col gap-6">
            <SettingsHeader title="Agents" {...heading}>
              The agents Zorvo can run. Zorvo installs them in its own folder, or uses the ones already on this Mac.
            </SettingsHeader>
            <AgentCatalogPanel
              agents={agents}
              settings={settings}
              refreshAgents={refreshAgents}
              catalog={catalog}
              actions={actions}
              signIn={agentSignIn}
            />
            <AgentToolsSetting
              isOn={settings.agentTools !== false}
              onChange={(agentTools) => updateSettings({ agentTools })}
            />
          </div>
        );
      case "github":
        return github ? (
          <GithubSection
            {...heading}
            ref={githubRef}
            status={github.status}
            isChecking={github.isChecking}
            onCheck={() => void github.check()}
            onConnect={github.connect}
            onOpenUrl={(url) => onOpenUrl?.(url)}
          />
        ) : null;
    }
  })();

  return (
    <div data-settings-page className="relative flex min-h-0 min-w-0 flex-1 bg-ground">
      <SettingsNav current={section} onSelect={page.select} onBack={page.close} updateCount={updateCount} />
      {/* One sheet beside the nav, as the sessions' stage has; it clips its corners and the section inside scrolls. */}
      <div data-sheet="settings" className="my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-panel border border-border bg-sheet">
        {/* Keyed by section: a new section is a new scroller, so it opens at its top. */}
        <section
          key={section}
          aria-labelledby={titleId}
          data-settings-content
          className="relative min-w-0 flex-1 overflow-y-auto px-10 py-12"
        >
          {/* The top of the content drags the window too, as the nav's top does. */}
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
          <div className="mx-auto max-w-[720px]">{content}</div>
        </section>
      </div>
      {notice && <ToastStack>{notice}</ToastStack>}
      {signInDialog}
      {agentDialog}
    </div>
  );
}
