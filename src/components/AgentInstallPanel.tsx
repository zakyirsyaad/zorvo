import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";
import { InstallBar, InstallCancel, InstallStatus } from "./InstallProgressLine";
import { useAgentInstall } from "../hooks/useAgentInstall";
import { describePlan } from "../lib/install-plan";
import type { AgentProfile } from "../types";

export interface AgentInstallPanelProps {
  agent: AgentProfile;
}

/**
 * Shown in a new-session draft whose agent is not installed yet: says what
 * Install puts on the machine, then follows the install until the agent is ready.
 */
export function AgentInstallPanel({ agent }: AgentInstallPanelProps) {
  const { status, progress, error, install, cancel } = useAgentInstall(agent.id);
  const installLabel = `Install ${agent.name}`;
  if (status === "installing") {
    return (
      <BlockerCard
        label={installLabel}
        profileId={agent.id}
        title={`Installing ${agent.name}`}
        // The bar spans the card, with Cancel on its own row under it, as drawn.
        actions={
          <div className="flex w-full flex-col gap-3.5">
            <InstallBar progress={progress} />
            <InstallCancel onCancel={cancel} />
          </div>
        }
      >
        <InstallStatus progress={progress} />
        {/* A Cancel that failed leaves the install running, and says why. */}
        {error && <p className="mt-2 text-danger">{error}</p>}
      </BlockerCard>
    );
  }
  return (
    <BlockerCard
      label={installLabel}
      profileId={agent.id}
      title={`${agent.name} isn't installed yet`}
      actions={
        <Button variant="primary" onClick={install}>
          {status === "failed" ? "Retry" : installLabel}
        </Button>
      }
    >
      <p>
        Zorvo downloads {describePlan(agent.install_plan ?? [])} into its own folder. Once it is installed, Zorvo checks whether you are
        signed in.
      </p>
      {error && <p className="mt-2 text-danger">{status === "failed" ? `Install failed: ${error}` : error}</p>}
    </BlockerCard>
  );
}
