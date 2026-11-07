import { loadAgentIcons } from './agent-icons';

/**
 * Check again, in Settings and on the welcome screen: the registry and the agent profiles are read again
 * (`refreshAgents`), then the catalog and the logos, which the refresh reports no change event for. The
 * catalog and logos are read even when the refresh failed; the refresh's failure is then passed on.
 */
export async function recheckAgents(refreshAgents: () => Promise<void>, reloadCatalog: () => Promise<void>): Promise<void> {
  try {
    await refreshAgents();
  } finally {
    await Promise.all([reloadCatalog(), loadAgentIcons()]);
  }
}
