import type { DelegationLink, Session, WorkerOutcome, WorkerTurnEnd } from '../types';
import { isOpenLink, openDelegatesOf } from './delegation';
import { isArchived } from './session-helpers';

/** What decides whether a session gets Zorvo's tools. */
export type ToolsSubject = Pick<Session, 'compareRunId' | 'delegatedFrom' | 'openedBy' | 'forkedFrom'> &
  Partial<Pick<Session, 'id'>>;

/** Where a worker stands, as its coordinator's agent and the user read it. */
export type WorkerState =
  | 'working'
  | 'needs-you'
  | 'succeeded'
  | 'failed'
  | 'did-not-report'
  | 'errored'
  | 'stopped'
  | 'gone';

/** Which tools a session gets: a coordinator starts workers, a worker reports back. */
export type ToolsRole = 'coordinator' | 'worker';

/** How many workers one coordinator may have in a turn at once. */
export const MAX_AT_WORK = 4;
/** The most characters of a worker's own summary that reach its coordinator. */
export const WORKER_SUMMARY_MAX = 2_000;
/** The most files a worker's outcome names. */
export const WORKER_FILES_MAX = 50;
/** How long a worker may take to close a turn it was asked to end. */
export const WORKER_CLOSE_MS = 120_000;

const WORKER_HANDLE_PATTERN = /^worker-([1-9][0-9]*)$/;

/**
 * The role a session's tools follow from. A compare run's agents work side by
 * side and a session an agent opened must not open more, so neither has one.
 * A delegated session with an open link is a worker. A fork of a session
 * that is not a coordinator has no role either, so forking is no way around
 * the one level. A source that is gone cannot be judged, and the walk ends on
 * a loop a hand-edited file could hold.
 */
export function toolsRoleOf(
  session: ToolsSubject,
  sessions: readonly (ToolsSubject & Pick<Session, 'id'>)[] = [],
): ToolsRole | null {
  const seen = new Set<string>();
  const roleOf = (current: ToolsSubject): ToolsRole | null => {
    if (current.compareRunId || current.openedBy) return null;
    if (current.delegatedFrom) return isOpenLink(current.delegatedFrom) ? 'worker' : null;
    const sourceId = current.forkedFrom;
    if (sourceId == null || seen.has(sourceId)) return 'coordinator';
    seen.add(sourceId);
    const source = sessions.find((candidate) => candidate.id === sourceId);
    if (source === undefined) return 'coordinator';
    return roleOf(source) === 'coordinator' ? 'coordinator' : null;
  };
  return roleOf(session);
}

/**
 * Where a worker stands. A turn in progress decides first; otherwise the last
 * turn's end does, and a finished turn is read by the outcome the worker
 * reported in it. No turn behind it means no state yet. It trusts `withTurnEnd`
 * to have cleared an outcome that does not belong to the last turn, so `lastTurn`
 * must be written before the state is read.
 */
export function workerStateOf(input: {
  link: DelegationLink;
  isBusy: boolean;
  isWaiting: boolean;
}): WorkerState | null {
  const { link, isBusy, isWaiting } = input;
  if (isWaiting) return 'needs-you';
  if (isBusy) return 'working';
  switch (link.lastTurn?.how) {
    case undefined:
      return null;
    case 'finished':
      if (link.outcome?.result === 'succeeded') return 'succeeded';
      return link.outcome?.result === 'failed' ? 'failed' : 'did-not-report';
    case 'failed':
      return 'errored';
    case 'cancelled':
      return 'stopped';
    case 'exited':
      return 'gone';
  }
}

/** The next handle for a worker: one more than the highest `worker-N` in `taken`. */
export function nextWorkerHandle(taken: readonly string[]): string {
  const highest = taken.reduce((max, handle) => {
    const match = WORKER_HANDLE_PATTERN.exec(handle);
    const number = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(number) ? Math.max(max, number) : max;
  }, 0);
  return `worker-${highest + 1}`;
}

/**
 * Every handle the coordinator has given, whether the worker's link is open or
 * ended or the session archived: its saved conversation still names them. A
 * deleted session leaves nothing to read.
 */
export function issuedWorkerHandles(coordinatorId: string, sessions: readonly Session[]): string[] {
  return sessions.flatMap((session) => {
    const link = session.delegatedFrom;
    return link?.sessionId === coordinatorId && link.handle !== undefined ? [link.handle] : [];
  });
}

/**
 * What its coordinator's agent calls a worker: the link's handle, else the
 * agent's id for a link made before handles, and only while the link is open.
 */
export function workerHandleOf(session: Session): string | undefined {
  const link = session.delegatedFrom;
  if (!link || !isOpenLink(link)) return undefined;
  return link.handle ?? session.profileId;
}

/**
 * Whether a report mark on the coordinator's message is this worker's. A mark
 * with a handle names one worker; an older mark names only the agent.
 */
export function isReportOf(mark: { agentId?: string; handle?: string }, worker: Session): boolean {
  return mark.handle !== undefined ? mark.handle === workerHandleOf(worker) : mark.agentId === worker.profileId;
}

/**
 * The coordinator's open, unarchived worker named `handle`. Old links are
 * named by agent id, so several can match; the newest wins.
 */
export function workerByHandle(
  coordinatorId: string,
  handle: string,
  sessions: readonly Session[],
): Session | undefined {
  const matches = openDelegatesOf(coordinatorId, sessions).filter((worker) => workerHandleOf(worker) === handle);
  return matches[matches.length - 1];
}

/** A turn ended that the coordinator has not been told about, on a link that is still open. */
export function isReportOwed(link: DelegationLink | null | undefined): boolean {
  if (!link || !isOpenLink(link) || !link.lastTurn) return false;
  return link.lastTurn.endedAt > (link.reportedAt ?? 0);
}

/** The coordinator's workers that owe it a report, the oldest turn end first. */
export function owedWorkersOf(coordinatorId: string, sessions: readonly Session[]): Session[] {
  const endedAt = (worker: Session) => worker.delegatedFrom?.lastTurn?.endedAt ?? 0;
  return sessions
    .filter(
      (session) =>
        session.delegatedFrom?.sessionId === coordinatorId &&
        !isArchived(session) &&
        isReportOwed(session.delegatedFrom),
    )
    .sort((a, b) => endedAt(a) - endedAt(b));
}

/** Why one more worker cannot start now, or null when there is room. */
export function startRefusal(atWork: number): string | null {
  return atWork >= MAX_AT_WORK ? `${MAX_AT_WORK} are running. Start this one when one finishes.` : null;
}

/**
 * How many starts count against the limit: the coordinator's open workers and
 * the sessions it opened that are in a turn or wait for an answer, plus the
 * starts still under way, which are not listed yet.
 */
export function atWorkCount(input: {
  coordinatorId: string;
  sessions: readonly Session[];
  isBusy: (sessionId: string) => boolean;
  isWaiting: (sessionId: string) => boolean;
  underWay: number;
}): number {
  const { coordinatorId, sessions, isBusy, isWaiting } = input;
  const opened = sessions.filter((session) => session.openedBy?.sessionId === coordinatorId && !isArchived(session));
  const atWork = [...openDelegatesOf(coordinatorId, sessions), ...opened].filter(
    (session) => isBusy(session.id) || isWaiting(session.id),
  );
  return atWork.length + input.underWay;
}

/**
 * Records how a turn ended. An outcome stays only when the turn finished and
 * the worker reported it after the turn before; any other outcome belongs to
 * an earlier task and is dropped.
 */
export function withTurnEnd(
  link: DelegationLink,
  end: { how: WorkerTurnEnd; at: number; reason?: string },
): DelegationLink {
  const previousEnd = link.lastTurn?.endedAt ?? link.startedAt;
  const keeps = end.how === 'finished' && link.outcome != null && link.outcome.at > previousEnd;
  return {
    ...link,
    lastTurn: { endedAt: end.at, how: end.how, ...(end.reason !== undefined ? { reason: end.reason } : {}) },
    outcome: keeps ? link.outcome : null,
  };
}

/** Records what the worker said about its task. */
export function withOutcome(link: DelegationLink, outcome: WorkerOutcome): DelegationLink {
  return { ...link, outcome };
}

/** A further task for the same worker: the earlier outcome no longer applies. */
export function withNewTask(link: DelegationLink, task: string): DelegationLink {
  return { ...link, task, outcome: null };
}

/** Marks the report as delivered. Its words are not kept: only the result and its time. */
export function withReported(link: DelegationLink, at: number): DelegationLink {
  if (!link.outcome) return { ...link, reportedAt: at };
  return { ...link, reportedAt: at, outcome: { result: link.outcome.result, at: link.outcome.at } };
}
