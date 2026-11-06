import type { Ref } from "react";
import type { AppUpdate } from "../../hooks/useAppUpdate";
import { useNow } from "../../hooks/useNow";
import type { AgentSummary } from "../../lib/agent-readiness";
import { checkedWords, downloadPercent } from "../../lib/app-update";
import type { FolderOption } from "../onboarding/types";
import { Button } from "../ui/Button";
import { StatusLine, type Status } from "../ui/StatusLine";
import { DefaultAgentPicker } from "./DefaultAgentPicker";
import { SettingsGroup, SettingsHeader, SettingsRow } from "./SettingsGroup";

export type GeneralAppUpdate = Pick<
  AppUpdate,
  "available" | "isChecking" | "checkedAt" | "checkFailed" | "checkNow" | "install" | "isInstalling" | "progress"
>;

export interface GeneralSectionProps {
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  /** The agents in use. */
  agents: readonly AgentSummary[];
  defaultAgentId: string | null;
  onChangeDefaultAgent: (agentId: string) => void;
  recentFolders: readonly FolderOption[];
  onRemoveRecentFolder: (path: string) => void;
  /** This Zorvo's version; unknown outside the app. */
  appVersion?: string;
  appUpdate: GeneralAppUpdate;
  /** What Update & restart would stop ("Restarting stops 2 agents mid-turn."), or null when nothing. */
  restartNote: string | null;
  onRunOnboarding: () => void;
}

/** The About row's line: its dot and words. The first state that applies wins. */
export function versionStatus(update: GeneralAppUpdate, appVersion: string | undefined, now: number): { status: Status; words: string } {
  const own = (words: string) => (appVersion ? `${appVersion} · ${words}` : words);
  const { available } = update;
  if (available && update.isInstalling) {
    if (update.progress?.phase === "installing") return { status: "idle", words: `Installing ${available.version}…` };
    const percent = downloadPercent(update.progress);
    return {
      status: "idle",
      words: percent === null ? `Downloading ${available.version}…` : `Downloading ${available.version} · ${percent}%`,
    };
  }
  if (available) return { status: "attention", words: `${available.version} is ready` };
  if (update.isChecking) return { status: "idle", words: own("Checking for updates…") };
  if (update.checkFailed) return { status: "attention", words: own("Could not check for updates") };
  if (update.checkedAt !== null) return { status: "ready", words: own(`Up to date · checked ${checkedWords(now - update.checkedAt)}`) };
  return { status: "idle", words: own("Not checked yet") };
}

function VersionRow({ appUpdate, appVersion, restartNote }: Pick<GeneralSectionProps, "appUpdate" | "appVersion" | "restartNote">) {
  const now = useNow();
  const { status, words } = versionStatus(appUpdate, appVersion, now);
  const description = (
    <span className="flex flex-col gap-0.5">
      {/* The visible line is the live region, so a finished check is announced once. */}
      <span role="status">
        <StatusLine status={status}>{words}</StatusLine>
      </span>
      {appUpdate.available && restartNote && <span>{restartNote}</span>}
    </span>
  );
  const control = appUpdate.available ? (
    <Button variant="primary" size="md" onClick={() => void appUpdate.install()} disabled={appUpdate.isInstalling}>
      Update & restart
    </Button>
  ) : (
    <Button size="md" onClick={() => void appUpdate.checkNow()} disabled={appUpdate.isChecking || appUpdate.isInstalling}>
      Check now
    </Button>
  );
  return <SettingsRow label="Zorvo version" description={description} control={control} />;
}

/** Settings → General: the default agent, the folders Zorvo remembers, and About. */
export function GeneralSection({
  titleRef,
  titleId,
  agents,
  defaultAgentId,
  onChangeDefaultAgent,
  recentFolders,
  onRemoveRecentFolder,
  appVersion,
  appUpdate,
  restartNote,
  onRunOnboarding,
}: GeneralSectionProps) {
  return (
    <div className="flex flex-col gap-7">
      <SettingsHeader title="General" titleRef={titleRef} id={titleId}>
        How new sessions start, and the folders Zorvo remembers.
      </SettingsHeader>

      <SettingsGroup heading="New sessions">
        <SettingsRow
          label="Default agent"
          description="New sessions start with this agent. You can switch in each draft."
          control={<DefaultAgentPicker agents={agents} defaultAgentId={defaultAgentId} onChange={onChangeDefaultAgent} />}
        />
      </SettingsGroup>

      <SettingsGroup heading="Recent folders">
        {recentFolders.length === 0 ? (
          <SettingsRow label={<span className="text-fg-subtle">No recent folders yet.</span>} />
        ) : (
          recentFolders.map((folder) => (
            <SettingsRow
              key={folder.path}
              label={folder.name}
              description={<span className="font-mono text-caption">{folder.path}</span>}
              control={
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => onRemoveRecentFolder(folder.path)}
                  aria-label={`Remove ${folder.name} from recent folders`}
                >
                  Remove
                </Button>
              }
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup heading="About">
        <VersionRow appUpdate={appUpdate} appVersion={appVersion} restartNote={restartNote} />
        <SettingsRow
          label="Setup"
          description="Pick agents and a folder again."
          control={
            <Button size="md" onClick={onRunOnboarding}>
              Run setup again
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
