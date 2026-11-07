import { useEffect } from "react";
import { AgentCatalog } from "./AgentCatalog";
import type { SettingsSignIn } from "../../hooks/useSettingsSignIn";
import type { AgentCatalogHandle } from "../../hooks/useAgentCatalog";
import type { AgentCatalogActions } from "../../hooks/useAgentCatalogActions";
import { recheckAgents } from "../../lib/agent-recheck";
import { enabledAgentIds } from "../../lib/enabled-agents";
import type { AgentProfile, Settings } from "../../types";

export interface AgentCatalogPanelProps {
  agents: readonly AgentProfile[];
  settings: Settings;
  refreshAgents: () => Promise<void>;
  catalog: AgentCatalogHandle;
  /** The app's one set of catalog actions. */
  actions: AgentCatalogActions;
  /** Settings passes its sign-in controls; onboarding does not. */
  signIn?: SettingsSignIn;
}

/** The agent catalog wired to the app's state; Settings and onboarding show the same one. */
export function AgentCatalogPanel({ agents, settings, refreshAgents, catalog, actions, signIn }: AgentCatalogPanelProps) {
  const checkAgain = () => recheckAgents(refreshAgents, catalog.reload);

  // When the Agents section opens (never at app start, never on window focus), agents that can say who is
  // signed in are asked, in a way that opens no session; the chip then reads Ready or Sign in.
  const sweep = signIn?.sweep;
  const startable = (catalog.catalog?.agents ?? [])
    .filter((agent) => !["not_installed", "unsupported", "waiting"].includes(agent.status))
    .map((agent) => agent.id)
    .filter((id) => enabledAgentIds(settings).includes(id));
  const sweepKey = startable.join(",");
  useEffect(() => {
    if (sweep && sweepKey !== "") sweep(sweepKey.split(","));
  }, [sweep, sweepKey]);

  return (
    <AgentCatalog
      catalog={catalog.catalog}
      error={catalog.error}
      agents={agents}
      enabledIds={enabledAgentIds(settings)}
      actions={actions}
      signIn={signIn}
      onCheckAgain={checkAgain}
      onRetryLoad={() => void catalog.reload()}
    />
  );
}
