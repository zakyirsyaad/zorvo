import type { FolderOption } from '../components/onboarding/types';
import type { CatalogAgent } from '../types';
import type { SignInState } from './agent-sign-in';

/** Offered on the welcome screen after the agents in use or on this Mac, in this order. */
export const POPULAR_AGENT_IDS: readonly string[] = ['claude-acp', 'codex-acp', 'gemini', 'qwen-code'];

/** Rows the welcome screen shows before Show all agents. */
const FIRST_ROWS = 5;

const isOffered = (agent: CatalogAgent) => agent.status !== 'waiting' && agent.status !== 'unsupported';
const isHere = (agent: CatalogAgent, enabledIds: readonly string[]) =>
  enabledIds.includes(agent.id) || agent.status === 'by_zorvo' || agent.status === 'on_your_mac';

/** Every agent the welcome screen can offer, in its order: in use or on this Mac, popular, then by name. */
export function orderedAgents(catalog: readonly CatalogAgent[], enabledIds: readonly string[]): CatalogAgent[] {
  const offered = catalog.filter(isOffered);
  const here = offered.filter((agent) => isHere(agent, enabledIds));
  const popular = POPULAR_AGENT_IDS.map((id) => offered.find((agent) => agent.id === id)).filter(
    (agent): agent is CatalogAgent => agent !== undefined && !here.includes(agent),
  );
  const rest = offered
    .filter((agent) => !here.includes(agent) && !popular.includes(agent))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...here, ...popular, ...rest];
}

/**
 * The agents the welcome screen lists: those in use or on this Mac first, then the popular ones, then
 * the rest by name; five until Show all, though an agent in use is never cut. Agents Zorvo cannot offer
 * yet (waiting, unsupported) are left out.
 */
export function visibleAgents(catalog: readonly CatalogAgent[], enabledIds: readonly string[], showAll: boolean): CatalogAgent[] {
  const all = orderedAgents(catalog, enabledIds);
  if (showAll) return all;
  return all.filter((agent, index) => index < FIRST_ROWS || enabledIds.includes(agent.id));
}

/** Whether Show all agents would show more. */
export function hasMoreAgents(catalog: readonly CatalogAgent[], enabledIds: readonly string[]): boolean {
  return orderedAgents(catalog, enabledIds).length > visibleAgents(catalog, enabledIds, false).length;
}

const SIGN_IN_WORDS: Readonly<Record<SignInState, string>> = {
  ready: 'Ready',
  unchecked: 'Not checked',
  needed: 'Sign in when you start',
};

function sourceOf(agent: CatalogAgent): string {
  if (agent.status === 'on_your_mac') return 'On this Mac';
  if (agent.status === 'by_zorvo') return 'Installed by Zorvo';
  return `Runs with ${agent.distribution}`;
}

/**
 * A welcome-screen row's line: where the agent runs and its sign-in; for one not installed, that ticking
 * installs it, or, once ticked (a default agent, or an install that was stopped), that it is not yet.
 */
export function rowWords(agent: CatalogAgent, signIn: SignInState, isSetupOnly: boolean, isTicked = false): string {
  if (agent.status === 'not_installed') return isTicked ? 'Not installed yet' : 'Zorvo installs it when you tick it';
  const state = isSetupOnly && signIn !== 'ready' ? 'Set up when you start' : SIGN_IN_WORDS[signIn];
  return `${sourceOf(agent)} · ${state}`;
}

/** The default agent: the saved one while it is ticked, else the first ticked one. */
export function defaultOf(ticked: readonly string[], preferred: string | null): string | null {
  if (preferred !== null && ticked.includes(preferred)) return preferred;
  return ticked[0] ?? null;
}

/** The agent Start opens the draft with: the default when it is ready, else the first ready ticked one. */
export function startAgentOf(
  ticked: readonly string[],
  preferred: string | null,
  isReady: (id: string) => boolean,
): string | null {
  const chosen = defaultOf(ticked, preferred);
  if (chosen !== null && isReady(chosen)) return chosen;
  return ticked.find(isReady) ?? null;
}

export interface TickedAgent {
  id: string;
  name: string;
  isReady: boolean;
  isInstalling: boolean;
}

/** Whether Start can go, and the note beside it that says why not (or what is still installing). */
export function startGate({
  ticked,
  defaultId,
  folder,
  isLoading = false,
}: {
  ticked: readonly TickedAgent[];
  defaultId: string | null;
  folder: FolderOption | null;
  /** The agents or their profiles are still loading: nothing to say yet. */
  isLoading?: boolean;
}): { canStart: boolean; note: string } {
  if (isLoading) return { canStart: false, note: '' };
  if (ticked.length === 0) return { canStart: false, note: 'Tick an agent to continue.' };
  const installing = ticked.filter((agent) => agent.isInstalling);
  const startId = startAgentOf(
    ticked.map((agent) => agent.id),
    defaultId,
    (id) => ticked.find((agent) => agent.id === id)?.isReady ?? false,
  );
  if (startId === null) {
    if (installing.length === 1) return { canStart: false, note: `${installing[0].name} is still installing.` };
    if (installing.length > 1) return { canStart: false, note: 'Your agents are still installing.' };
    return { canStart: false, note: 'Install one of these agents to continue.' };
  }
  if (folder === null) return { canStart: false, note: 'Choose a project folder.' };
  const start = ticked.find((agent) => agent.id === startId);
  if (installing.length > 0 && start) {
    const names = installing.length === 1 ? `${installing[0].name} is` : 'Your other agents are';
    return { canStart: true, note: `${names} still installing. You can start with ${start.name} now.` };
  }
  return { canStart: true, note: '' };
}
