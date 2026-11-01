import type { ActionCard, ChatMessage, Session } from '../types';
import { isListed } from './session-helpers';

/** Most agents one compare run can start. */
export const MAX_COMPARE_AGENTS = 4;

export type RunRowStatus = 'starting' | 'working' | 'needs-you' | 'needs-sign-in' | 'failed' | 'done' | 'stopped';

/** A run is not stored: it is the listed sessions that share a `compareRunId`. */
export interface CompareRun {
  id: string;
  /** The sessions' shared name. */
  name: string;
  /** Oldest first. */
  sessions: Session[];
}

/** What the panel knows about one session; `rowStatus` turns it into one word. */
export interface RowFacts {
  session: Session;
  isBusy: boolean;
  hasStarted: boolean;
  pendingCard: ActionCard | null;
  hasOpenForm: boolean;
  needsSignIn: boolean;
  failed: boolean;
}

const STATUS_LABELS: Record<RunRowStatus, string> = {
  starting: 'Starting',
  working: 'Working',
  'needs-you': 'Needs you',
  'needs-sign-in': 'Needs sign-in',
  failed: 'Failed',
  done: 'Done',
  stopped: 'Stopped',
};

/** The runs with two or more listed sessions, oldest first. */
export function compareRuns(sessions: readonly Session[]): CompareRun[] {
  const byRun = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.compareRunId || !isListed(session)) continue;
    byRun.set(session.compareRunId, [...(byRun.get(session.compareRunId) ?? []), session]);
  }
  return [...byRun.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([id, members]) => {
      const ordered = [...members].sort((a, b) => a.createdAt - b.createdAt);
      return { id, name: ordered[0].name, sessions: ordered };
    })
    .sort((a, b) => a.sessions[0].createdAt - b.sessions[0].createdAt);
}

export function runOf(sessions: readonly Session[], runId: string): CompareRun | null {
  return compareRuns(sessions).find((run) => run.id === runId) ?? null;
}

/** Highest first: sign-in, a permission or form, failed, starting, working, then done or stopped. */
export function rowStatus(facts: RowFacts): RunRowStatus {
  if (facts.needsSignIn) return 'needs-sign-in';
  if (facts.pendingCard !== null || facts.hasOpenForm) return 'needs-you';
  if (facts.failed) return 'failed';
  if (facts.isBusy) return facts.hasStarted ? 'working' : 'starting';
  if (facts.session.status === 'terminated') return 'stopped';
  return facts.hasStarted ? 'done' : 'starting';
}

export function statusLabel(status: RunRowStatus): string {
  return STATUS_LABELS[status];
}

/** True when no row is still starting, working or waiting for the user. */
export function isRunSettled(statuses: readonly RunRowStatus[]): boolean {
  return statuses.every((status) => status !== 'starting' && status !== 'working' && status !== 'needs-you');
}

/** The sessions to stop when `winnerId` is kept: every other one that has not already ended. */
export function othersToStop(run: CompareRun, winnerId: string, isBusy: (id: string) => boolean): Session[] {
  return run.sessions.filter(
    (session) => session.id !== winnerId && (session.status !== 'terminated' || isBusy(session.id)),
  );
}

/** The newest permission card still waiting for an answer. */
export function pendingPermission(messages: readonly ChatMessage[]): ActionCard | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const card = messages[i].actionCard;
    if (card?.status === 'pending') return card;
  }
  return null;
}

/** Toggles `agentId` in the selection. Adding stops at MAX_COMPARE_AGENTS; removing always works. */
export function pickableAgentIds(selected: readonly string[], agentId: string): string[] {
  if (selected.includes(agentId)) return selected.filter((id) => id !== agentId);
  return selected.length >= MAX_COMPARE_AGENTS ? [...selected] : [...selected, agentId];
}
