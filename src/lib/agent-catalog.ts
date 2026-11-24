import type { AgentProfile, CatalogAgent, CatalogStatus, InstallStep, Session, Settings, UnavailableAgent, UnavailableReason } from '../types';
import { describePlan } from './install-plan';
import type { InstallStatus } from './agent-installs';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

/** Case-insensitive match of the trimmed query against name, id and description. */
export function matchesQuery(agent: Pick<CatalogAgent, 'id' | 'name' | 'description'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [agent.name, agent.id, agent.description ?? ''].some((text) => text.toLowerCase().includes(needle));
}

const OTHERS_RANK: Record<CatalogStatus, number> = {
  by_zorvo: 0,
  on_your_mac: 0,
  ready: 1,
  not_installed: 1,
  waiting: 2,
  unsupported: 2,
};

const byName = (a: CatalogAgent, b: CatalogAgent) => a.name.localeCompare(b.name);

/** Agents in use (updates first) and the rest (installed first, unavailable last), both filtered by `query`. */
export function catalogSections(
  agents: readonly CatalogAgent[],
  enabledIds: readonly string[],
  query: string,
): { inUse: CatalogAgent[]; others: CatalogAgent[] } {
  const shown = agents.filter((agent) => matchesQuery(agent, query));
  const inUse = shown
    .filter((agent) => enabledIds.includes(agent.id))
    .sort((a, b) => Number(b.updateVersion !== null) - Number(a.updateVersion !== null) || byName(a, b));
  const others = shown
    .filter((agent) => !enabledIds.includes(agent.id))
    .sort((a, b) => OTHERS_RANK[a.status] - OTHERS_RANK[b.status] || byName(a, b));
  return { inUse, others };
}

const UNAVAILABLE_REASONS: Record<UnavailableReason, string> = {
  no_checksum: 'The registry publishes no usable checksum for this download, so Zorvo cannot verify it.',
  invalid_entry: 'The registry entry for this agent is incomplete or fails the safety checks Zorvo applies, so Zorvo cannot run it.',
};

/** What to tell the user about why an agent the registry lists cannot be added. */
export function unavailableReasonText(reason: UnavailableReason): string {
  return UNAVAILABLE_REASONS[reason];
}

/** The agents Zorvo cannot offer that match `query`, by name. */
export function unavailableSection(agents: readonly UnavailableAgent[], query: string): UnavailableAgent[] {
  return agents.filter((agent) => matchesQuery(agent, query)).sort((a, b) => a.name.localeCompare(b.name));
}

/** How an agent's install or update is going, for its status line. */
export interface InstallLine {
  status: InstallStatus;
  action: 'install' | 'update';
  error: string | null;
}

function baseStatusLine(agent: CatalogAgent, plan: readonly InstallStep[] | null, isInUse: boolean): string {
  switch (agent.status) {
    case 'by_zorvo':
      return 'Installed by Zorvo';
    case 'on_your_mac':
      return agent.location === null ? 'Installed on your Mac' : `Managed outside Zorvo · ${agent.location}`;
    case 'ready':
      return `Runs with ${agent.distribution}`;
    case 'not_installed':
      if (plan === null || plan.length === 0) return 'Not installed';
      return `Not installed · ${isInUse ? 'Install adds' : 'Add installs'} ${describePlan(plan)}`;
    case 'waiting':
      return 'Not available yet';
    case 'unsupported':
      return 'Not available for this Mac';
  }
}

/** The line under an agent's name; `plan` is what Add or Install would install, when known. */
export function statusLine(
  agent: CatalogAgent,
  plan: readonly InstallStep[] | null,
  isInUse = false,
  install?: InstallLine,
): string {
  const line = jobLine(agent, plan, install) ?? baseStatusLine(agent, plan, isInUse);
  return agent.listed ? line : `${line} · No longer listed`;
}

/** What the agent is doing instead of its usual status line while an install or update runs, or why it failed. */
function jobLine(
  agent: CatalogAgent,
  plan: readonly InstallStep[] | null,
  install: InstallLine | undefined,
): string | null {
  if (!install || install.status === 'idle') return null;
  const isUpdate = install.action === 'update';
  if (install.status === 'failed') {
    return `${isUpdate ? 'Update' : 'Install'} failed · ${install.error ?? 'Unknown error'}`;
  }
  if (isUpdate) return agent.updateVersion ? `Updating to ${agent.updateVersion}` : `Updating ${agent.name}`;
  return `Installing ${plan && plan.length > 0 ? describePlan(plan) : agent.name}`;
}

export interface RowActions {
  add: boolean;
  /** An agent in use that is not installed yet, such as a default one. */
  install: boolean;
  update: boolean;
  remove: boolean;
}

/** Which buttons a catalog row offers. */
export function rowActions(agent: CatalogAgent, isInUse: boolean): RowActions {
  const canBeUsed = agent.status !== 'waiting' && agent.status !== 'unsupported';
  // A program managed outside Zorvo with a known location cannot be updated from here.
  const canUpdate = agent.status !== 'on_your_mac' || agent.location === null;
  return {
    add: !isInUse && canBeUsed,
    install: isInUse && agent.status === 'not_installed',
    update: isInUse && canUpdate && agent.updateVersion !== null,
    remove: isInUse,
  };
}

/**
 * Enables an agent: writes the full list (so defaults are not left implicit) and clears any removal.
 * `version`, the one the catalog offers, is recorded unless one already is, so a later
 * Check again cannot change the version in use without an Update.
 */
export function withAgentAdded(
  settings: Settings,
  id: string,
  current: readonly string[],
  version: string | null = null,
): Settings {
  const known = settings.agentVersions ?? {};
  const shouldRecord = version !== null && !(id in known);
  return {
    ...settings,
    enabledAgents: current.includes(id) ? [...current] : [...current, id],
    removedAgents: (settings.removedAgents ?? []).filter((removed) => removed !== id),
    ...(shouldRecord ? { agentVersions: { ...known, [id]: version } } : {}),
  };
}

/** Disables an agent and remembers the removal so it is not enabled again automatically. */
export function withAgentRemoved(settings: Settings, id: string, current: readonly string[]): Settings {
  const removed = settings.removedAgents ?? [];
  return {
    ...settings,
    enabledAgents: current.filter((enabled) => enabled !== id),
    removedAgents: removed.includes(id) ? [...removed] : [...removed, id],
    defaultAgentId: settings.defaultAgentId === id ? null : settings.defaultAgentId,
  };
}

/** Agents in use that have a newer version on offer. */
export function pendingUpdates(agents: readonly CatalogAgent[], enabledIds: readonly string[]): CatalogAgent[] {
  return agents.filter((agent) => enabledIds.includes(agent.id) && agent.updateVersion !== null);
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** "2 hours ago"; "just now" within the first minute. Both arguments are unix seconds. */
export function formatCheckedAgo(seconds: number, now: number): string {
  const elapsed = Math.max(0, now - seconds);
  if (elapsed < SECONDS_PER_MINUTE) return 'just now';
  if (elapsed < SECONDS_PER_HOUR) return RELATIVE_FORMAT.format(-Math.floor(elapsed / SECONDS_PER_MINUTE), 'minute');
  if (elapsed < SECONDS_PER_DAY) return RELATIVE_FORMAT.format(-Math.floor(elapsed / SECONDS_PER_HOUR), 'hour');
  return RELATIVE_FORMAT.format(-Math.floor(elapsed / SECONDS_PER_DAY), 'day');
}

/**
 * Where an agent in use comes from, after its version: the mono line under its name in Settings → Agents.
 * Zorvo's own copy is the usual case and says nothing; any other source is named.
 */
function sourceWords(agent: CatalogAgent): string | null {
  switch (agent.status) {
    case 'by_zorvo':
      return null;
    case 'on_your_mac':
      return 'on this Mac';
    case 'ready':
      return `runs with ${agent.distribution}`;
    case 'not_installed':
      return 'not installed';
    case 'waiting':
      return 'not available yet';
    case 'unsupported':
      return 'not available for this Mac';
  }
}

/**
 * "0.93.0 · update 0.94.1 ready": an agent in use's version, where it comes from unless Zorvo installed it,
 * and the update its row offers. A program found outside Zorvo at a known place shows no version, since it
 * may not be the registry's. `updateVersion` is passed only when the row offers that update.
 */
export function sourceLine(agent: CatalogAgent, updateVersion: string | null = null): string {
  const version = agent.location === null ? agent.version : null;
  const parts = [
    version,
    sourceWords(agent),
    updateVersion ? `update ${updateVersion} ready` : null,
    agent.listed ? null : 'no longer listed',
  ];
  // Zorvo's copy with no version known still says where it is from, so the line is never empty.
  return parts.filter(Boolean).join(' · ') || 'installed by Zorvo';
}

/** What an available agent's line says first, before its description: why it cannot be used, or that it is already here. */
function availableReason(agent: CatalogAgent): string | null {
  switch (agent.status) {
    case 'waiting':
    case 'unsupported':
      return baseStatusLine(agent, null, false);
    case 'on_your_mac':
      return 'On this Mac';
    case 'by_zorvo':
      return 'Installed by Zorvo';
    default:
      return null;
  }
}

/**
 * An available agent's line: what Add would install; else why it cannot be used, or that it is already
 * on this Mac (so Add installs nothing), then its description; and whether the registry still lists it.
 */
export function availableLine(agent: CatalogAgent, plan: readonly InstallStep[] | null): string {
  const line =
    plan && plan.length > 0
      ? `Installs ${describePlan(plan)} into Zorvo's folder`
      : [availableReason(agent), agent.description].filter(Boolean).join(' · ');
  if (agent.listed) return line;
  return line ? `${line} · No longer listed` : 'No longer listed';
}

/**
 * The agents you have used: one with a session (archived ones count), your default agent,
 * and one Zorvo has seen signed in. An agent that is only in use by default, or was put in
 * use because its package was found on this Mac, is not among them.
 */
export function usedAgentIds(
  settings: Pick<Settings, 'defaultAgentId' | 'signedInAgents'>,
  sessions: readonly Pick<Session, 'profileId'>[],
): ReadonlySet<string> {
  const ids = [...sessions.map((session) => session.profileId), ...(settings.signedInAgents ?? []), settings.defaultAgentId];
  return new Set(ids.filter((id): id is string => typeof id === 'string'));
}

/**
 * The agents in use that Zorvo installs by itself when it opens: npm-package agents you have
 * used (`usedIds`) whose only missing part is that package. One that also needs Node.js or
 * another program was not ready before either, and one you never used was never picked;
 * both keep their Install button.
 */
export function autoInstallTargets(agentsInUse: readonly AgentProfile[], usedIds: ReadonlySet<string>): string[] {
  return agentsInUse
    .filter(
      (agent) =>
        usedIds.has(agent.id) &&
        agent.distribution === 'npx' &&
        agent.availability === 'not_installed' &&
        agent.install_plan?.length === 1 &&
        agent.install_plan[0].kind === 'agent',
    )
    .map((agent) => agent.id);
}
