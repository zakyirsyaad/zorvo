import { useEffect, useRef, useState } from 'react';
import { answerOf, isOpenLink, reportedFiles } from '../lib/delegation';
import { agentNameIn, lastMessage } from '../lib/delegation-helpers';
import { isArchived } from '../lib/session-helpers';
import {
  MAX_REPORT_WORKERS,
  isReportOwed,
  owedWorkersOf,
  withReported,
  workerHandleOf,
  workerStateOf,
  workersReportMessage,
  type WorkerReportEntry,
} from '../lib/workers';
import type { ChatMessage, DelegationLink, Session } from '../types';
import type { DelegationDeps } from './useDelegation';
import { useLatest } from './useLatest';

export type ReportDeps = Pick<
  DelegationDeps,
  | 'sessions'
  | 'agents'
  | 'transcripts'
  | 'isBusy'
  | 'isWaiting'
  | 'canPrompt'
  | 'send'
  | 'giveBack'
  | 'onNotice'
  | 'updateLink'
  | 'messagesOf'
>;

/** A path as the worker's folder sees it: relative to it when the tool named it inside. */
function relativeTo(cwd: string, path: string): string {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The link as the state holds it now, marked reported; a worker that is gone also ends. */
function reportedLink(link: DelegationLink, at: number, endedTurnAt: number | undefined): DelegationLink {
  // A newer turn end is never covered by an older report: it stays owed.
  if (!isOpenLink(link) || link.lastTurn?.endedAt !== endedTurnAt) return link;
  // Never earlier than the turn end it covers: a clock that stepped back must not leave it owed.
  const reported = withReported(link, Math.max(at, link.lastTurn?.endedAt ?? at));
  const isGone = link.lastTurn?.how === 'exited';
  return isGone ? { ...reported, endedAt: at } : reported;
}

/**
 * Sends each coordinator one message with what its workers owe it. What is owed is read from
 * the sessions (a turn that ended after the last report), so it survives a reload; the refs only
 * make same-tick decisions hold before React renders, and the revision only triggers the drain.
 */
export function useWorkerReports(deps: ReportDeps): {
  drop: (workerId: string) => void;
  isDelivering: (workerId: string) => boolean;
  /** A turn ended in `sessionId`: reports owed to it are looked at again. */
  recheck: (sessionId: string) => void;
} {
  const { sessions, transcripts } = deps;
  const latest = useLatest(deps);
  // The workers whose report is being sent right now.
  const delivering = useRef(new Set<string>());
  // Coordinators whose last send threw, with their status then: not retried on every render, only
  // after their next turn settles, their status changes (a resume) or they go away.
  const failed = useRef(new Map<string, Session['status']>());
  // Workers whose report went out but could not be marked: the reported turn's time and the report
  // time. Only the marking is retried, at the start of each pass; that turn is never sent again.
  const unmarked = useRef(new Map<string, { endedAt: number | undefined; at: number }>());
  // Bumped when a coordinator's turn ends or a hand-over settles, so the drain runs and the lines read again.
  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((current) => current + 1);

  const drop = (workerId: string): void => {
    delivering.current.delete(workerId);
  };

  const recheck = (sessionId: string): void => {
    failed.current.delete(sessionId);
    if (latest.current.sessions.some((session) => session.delegatedFrom?.sessionId === sessionId && isReportOwed(session.delegatedFrom))) {
      bump();
    }
  };

  useEffect(() => {
    /** One worker's part of the message, from its link, else from its transcript. */
    const entryOf = async (worker: Session, coordinator: Session, link: DelegationLink): Promise<WorkerReportEntry | null> => {
      const current = latest.current;
      // The last turn is what is owed: a worker that has since been busy again is still described by it.
      const state = workerStateOf({ link, isBusy: false, isWaiting: false });
      if (state === null) return null;
      const handle = workerHandleOf(worker) ?? worker.profileId;
      const base = {
        handle,
        agentName: agentNameIn(current.agents, worker.profileId),
        agentId: worker.profileId,
        task: link.task,
        state,
        files: [] as string[],
        ...(worker.cwd !== coordinator.cwd ? { folder: worker.cwd } : {}),
      };
      if (state === 'succeeded' || state === 'failed') {
        return { ...base, summary: link.outcome?.summary ?? '', files: link.outcome?.files ?? [] };
      }
      if (state === 'errored') return { ...base, ...(link.lastTurn?.reason ? { reason: link.lastTurn.reason } : {}) };
      if (state !== 'did-not-report') return base;

      let messages: ChatMessage[] | null | undefined = current.transcripts[worker.id];
      if (messages === undefined) {
        try {
          messages = await current.messagesOf(worker.id);
        } catch {
          messages = null;
        }
      }
      // Never the cause: it may hold a path.
      if (messages === null) return { ...base, unreadable: true };
      const last = lastMessage(messages);
      if (last === undefined || last.role !== 'agent' || last.isComplete !== true) return base;
      const files = [...new Set(reportedFiles(last).map((path) => relativeTo(worker.cwd, path)))];
      return { ...base, answer: answerOf(last), files };
    };

    const endLinks = (workers: readonly Session[]): void => {
      const at = Date.now();
      for (const worker of workers) {
        latest.current.updateLink(worker.id, (link) => (isOpenLink(link) ? { ...link, endedAt: at } : link));
      }
    };

    /** The coordinator can be told now: alive, not archived, not in a turn, not waiting on the user. */
    const isFree = (coordinatorId: string): boolean => {
      const current = latest.current;
      const coordinator = current.sessions.find((session) => session.id === coordinatorId);
      return (
        coordinator !== undefined &&
        !isArchived(coordinator) &&
        coordinator.status === 'running' &&
        !current.isBusy(coordinatorId) &&
        !current.isWaiting(coordinatorId)
      );
    };

    /** Marks reported; a throw here must not read as a failed send, nor send it again. */
    const mark = (items: readonly { id: string; endedAt: number | undefined }[], at: number): void => {
      for (const item of items) {
        try {
          latest.current.updateLink(item.id, (link) => reportedLink(link, at, item.endedAt));
        } catch {
          // The report went out: remember it so no pass sends it again; a newer turn end is judged afresh.
          unmarked.current.set(item.id, { endedAt: item.endedAt, at });
        }
      }
    };

    /** Retries the marking of reports that went out. Nothing here throws out of the drain. */
    const retryMarks = (): void => {
      for (const [workerId, item] of [...unmarked.current]) {
        const link = latest.current.sessions.find((session) => session.id === workerId)?.delegatedFrom;
        // The worker or its open link is gone, or a newer turn ended: nothing left to mark.
        if (link == null || !isOpenLink(link) || link.lastTurn?.endedAt !== item.endedAt || !isReportOwed(link)) {
          unmarked.current.delete(workerId);
          continue;
        }
        try {
          latest.current.updateLink(workerId, (latestLink) => reportedLink(latestLink, item.at, item.endedAt));
          unmarked.current.delete(workerId);
        } catch {
          // Tried again in the next pass.
        }
      }
    };

    /** A worker in a turn is skipped: its report would be built from a conversation that is still moving. */
    const isWorking = (workerId: string): boolean => latest.current.isBusy(workerId) || latest.current.isWaiting(workerId);

    const deliver = async (coordinator: Session, workers: readonly Session[]): Promise<void> => {
      const at = Date.now();
      let isFailed = false;
      let isStale = false;
      try {
        const built = await Promise.all(
          workers.map(async (worker) => {
            const link = worker.delegatedFrom;
            const entry = link == null ? null : await entryOf(worker, coordinator, link);
            return entry === null ? null : { id: worker.id, endedAt: link?.lastTurn?.endedAt, entry };
          }),
        );
        // The awaits took time: judge the coordinator and each worker as they are now.
        if (!isFree(coordinator.id)) return;
        const fresh = built.filter((item): item is NonNullable<typeof item> => item !== null).filter((item) => {
          const link = latest.current.sessions.find((session) => session.id === item.id)?.delegatedFrom;
          const isCurrent =
            link != null && isOpenLink(link) && isReportOwed(link) && link.lastTurn?.endedAt === item.endedAt;
          // A worker now in a turn stays owed; its turn end changes its link and brings the drain back.
          if (isCurrent && isWorking(item.id)) return false;
          if (!isCurrent) isStale = true;
          return isCurrent;
        });
        if (fresh.length === 0) return;
        const entries = fresh.map((item) => item.entry);
        const text = workersReportMessage(entries);
        const workerReport = {
          workers: entries.map(({ agentName, agentId, handle, state }) => ({ agentName, agentId, handle, state })),
        };
        const toComposer = (): void => {
          latest.current.giveBack(coordinator.id, text);
          latest.current.onNotice(
            entries.length === 1
              ? `${entries[0].agentName}'s report is in the composer of ${coordinator.name}.`
              : `${entries.length} workers' reports are in the composer of ${coordinator.name}.`,
          );
        };
        if (!latest.current.canPrompt(coordinator.id)) {
          // A live coordinator that cannot be prompted (sign-in, agent removed): waiting in its composer is delivery.
          toComposer();
          mark(fresh, at);
          return;
        }
        let isSent: boolean;
        try {
          isSent = await latest.current.send(coordinator.id, text, [], { workerReport });
        } catch {
          isSent = false;
        }
        // The agent refused the prompt: the report waits in the composer, which counts as reported.
        if (!isSent) toComposer();
        mark(fresh, at);
      } catch {
        isFailed = true;
        failed.current.set(coordinator.id, latest.current.sessions.find((session) => session.id === coordinator.id)?.status ?? coordinator.status);
        // Never the error's text: it may hold a path.
        latest.current.onNotice(
          `A worker's report could not be sent. Zorvo will try again after ${coordinator.name}'s next turn.`,
        );
      } finally {
        for (const worker of workers) delivering.current.delete(worker.id);
        // A failure must not rerun the drain by itself; a turn that moved on while we waited must.
        if (!isFailed && isStale) bump();
      }
    };

    const drain = (): void => {
      retryMarks();
      const current = latest.current;
      const coordinatorIds = new Set(
        current.sessions.flatMap((session) =>
          session.delegatedFrom != null && isReportOwed(session.delegatedFrom) && !isArchived(session)
            ? [session.delegatedFrom.sessionId]
            : [],
        ),
      );
      for (const coordinatorId of coordinatorIds) {
        const coordinator = current.sessions.find((session) => session.id === coordinatorId);
        // A resume (a status change) or a coordinator that is gone ends the failure hold.
        if (failed.current.has(coordinatorId) && failed.current.get(coordinatorId) !== coordinator?.status) {
          failed.current.delete(coordinatorId);
        }
        const owed = owedWorkersOf(coordinatorId, current.sessions).filter(
          (worker) =>
            !delivering.current.has(worker.id) &&
            !isWorking(worker.id) &&
            !(unmarked.current.has(worker.id) && unmarked.current.get(worker.id)?.endedAt === worker.delegatedFrom?.lastTurn?.endedAt),
        );
        if (owed.length === 0) continue;
        // Nobody to tell: the workers' links end, and no notice, since nothing was lost the user can act on.
        if (coordinator === undefined || isArchived(coordinator)) {
          endLinks(owed);
          continue;
        }
        // In a turn, waiting on the user, or not running (after a reload every session is
        // terminated): the report stays owed. A turn end, or resuming the session, brings us back.
        if (!isFree(coordinatorId) || failed.current.has(coordinatorId)) continue;
        const batch = owed.slice(0, MAX_REPORT_WORKERS);
        // Marked before anything awaits: a second run (StrictMode) must not send it again.
        for (const worker of batch) delivering.current.add(worker.id);
        void deliver(coordinator, batch);
      }
    };
    drain();
    // The triggers are the transcripts, the sessions and a turn that ended; the deps themselves
    // come through `latest`, so a report sends with the freshest functions.
  }, [transcripts, sessions, revision, latest]);

  return { drop, isDelivering: (workerId) => delivering.current.has(workerId), recheck };
}
