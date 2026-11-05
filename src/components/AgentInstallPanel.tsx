import { Download, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";
import { InstallProgressLine } from "./InstallProgressLine";
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
  const actions =
    status === "idle" ? (
      <Button variant="primary" onClick={install} icon={<Download size={12} />}>
        {installLabel}
      </Button>
    ) : status === "failed" ? (
      <Button variant="primary" onClick={install} icon={<RotateCcw size={12} />}>
        Retry
      </Button>
    ) : undefined;
  return (
    <BlockerCard
      label={installLabel}
      profileId={agent.id}
      title={`${agent.name} isn't installed yet`}
      actions={actions}
      footer={status === "installing" ? <InstallProgressLine progress={progress} onCancel={cancel} /> : undefined}
    >
      <p>
        {agent.name} needs {describePlan(agent.install_plan ?? [])} before it can start.
      </p>
      <p className="mt-1">Once it is installed, Zorvo checks whether you are signed in.</p>
      {error && <p className="mt-2 text-danger">{status === "failed" ? `Install failed: ${error}` : error}</p>}
    </BlockerCard>
  );
}
