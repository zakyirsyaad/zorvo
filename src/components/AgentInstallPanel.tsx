import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";
import { InstallBar, InstallStatus } from "./InstallProgressLine";
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
        // Cancel at the header's right, and the bar across the card under it, as drawn.
        action={
          <Button variant="ghost" tone="secondary" onClick={cancel}>
            Cancel
          </Button>
        }
        below={<InstallBar progress={progress} />}
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
      action={
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
