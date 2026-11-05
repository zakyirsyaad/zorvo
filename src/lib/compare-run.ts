import type { ActionCard, ChatMessage, Session } from '../types';
import { pendingCardsInTurn } from './acp-events';
import { hasPendingElicitation } from './acp-elicitation';
import { isListed } from './session-helpers';
import type { Status } from '../components/ui/StatusLine';

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

/** The run a session is part of now; null once it is the last one left, as a Pick's winner is. */
export function runOfSession(sessions: readonly Session[], sessionId: string): CompareRun | null {
  const runId = sessions.find((session) => session.id === sessionId)?.compareRunId;
  return runId ? runOf(sessions, runId) : null;
}

/** The session a run that went away leaves behind, as a Pick's winner is; null unless exactly one is listed. */
export function lastOfRun(sessions: readonly Session[], runId: string): Session | null {
  const left = sessions.filter((session) => session.compareRunId === runId && isListed(session));
  return left.length === 1 ? left[0] : null;
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

const STATUS_DOTS: Record<RunRowStatus, Status> = {
  starting: 'running',
  working: 'running',
  'needs-you': 'attention',
  'needs-sign-in': 'attention',
  failed: 'danger',
  done: 'idle',
  stopped: 'idle',
};

/** The dot beside a row's status word; done and stopped show the word alone. */
export function runStatusDot(status: RunRowStatus): Status {
  return STATUS_DOTS[status];
}

/** The confirm bar's question before the others are archived. */
export function pickQuestion(winnerName: string): string {
  return `Keep ${winnerName}'s work and archive the others?`;
}

/** The confirm bar's second line, naming the agents a Pick cuts off mid-turn. */
export function stopsLine(names: readonly string[]): string {
  const listed = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `This stops ${listed} mid-turn.`;
}

/** True when no row is still starting, working or waiting for the user. */
export function isRunSettled(statuses: readonly RunRowStatus[]): boolean {
  return statuses.every((status) => status !== 'starting' && status !== 'working' && status !== 'needs-you');
}

/** What the notification says once a run has settled. */
export function runFinishedBody(doneCount: number): string {
  return `Compare finished: ${doneCount} ${doneCount === 1 ? "agent is" : "agents are"} done.`;
}

/** The sessions to stop when `winnerId` is kept: every other one that has not already ended. */
export function othersToStop(run: CompareRun, winnerId: string, isBusy: (id: string) => boolean): Session[] {
  return run.sessions.filter(
    (session) => session.id !== winnerId && (session.status !== 'terminated' || isBusy(session.id)),
  );
}

/** The newest permission request of the current turn still waiting for an answer. */
export function pendingPermission(messages: readonly ChatMessage[]): ActionCard | null {
  return pendingCardsInTurn(messages).at(-1) ?? null;
}

/** Toggles `agentId` in the selection. Adding stops at MAX_COMPARE_AGENTS; removing always works. */
export function pickableAgentIds(selected: readonly string[], agentId: string): string[] {
  if (selected.includes(agentId)) return selected.filter((id) => id !== agentId);
  return selected.length >= MAX_COMPARE_AGENTS ? [...selected] : [...selected, agentId];
}

/** What `rowFactsOf` reads besides the run itself. */
export interface RowSources {
  isBusy: (sessionId: string) => boolean;
  /** Every loaded chat by session id: a run's sessions other than the open one are in here too. */
  transcripts: Readonly<Record<string, readonly ChatMessage[] | undefined>>;
  /** The error each session's last turn failed with. */
  failedTurns: Readonly<Record<string, string>>;
  /** The sessions whose agent refused until the user signs in, by id. */
  signInNeeded: ReadonlyMap<string, unknown>;
}

/**
 * The facts `rowStatus` needs for every session of `run`. A session fails when its
 * last turn did, or when its agent ended with a non-zero exit code.
 */
export function rowFactsOf(run: CompareRun, { isBusy, transcripts, failedTurns, signInNeeded }: RowSources): RowFacts[] {
  return run.sessions.map((session) => {
    const messages = transcripts[session.id] ?? [];
    const isBusyNow = isBusy(session.id);
    // A saved request outlives its agent: only a live agent still waits for an answer (as `isWaitingForAnswer` reads it).
    const isLive = session.status === 'running';
    const exitedBadly = session.status === 'terminated' && Boolean(session.exitCode);
    return {
      session,
      isBusy: isBusyNow,
      hasStarted: Boolean(session.acpSessionId) || messages.some((message) => message.role === 'agent'),
      pendingCard: isLive && isBusyNow ? pendingPermission(messages) : null,
      hasOpenForm: isLive && hasPendingElicitation(messages),
      needsSignIn: signInNeeded.has(session.id),
      failed: session.id in failedTurns || exitedBadly,
    };
  });
}
