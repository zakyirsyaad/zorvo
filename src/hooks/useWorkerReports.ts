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
  if (!isOpenLink(link)) return link;
  const reported = withReported(link, at);
  const isGone = link.lastTurn?.how === 'exited' && link.lastTurn.endedAt === endedTurnAt;
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
  // Bumped when a coordinator's turn ends or a hand-over settles, so the drain runs and the lines read again.
  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((current) => current + 1);

  const drop = (workerId: string): void => {
    delivering.current.delete(workerId);
  };

  const recheck = (sessionId: string): void => {
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

    const deliver = async (coordinator: Session, workers: readonly Session[]): Promise<void> => {
      const current = latest.current;
      const at = Date.now();
      const endedTurns = new Map(workers.map((worker) => [worker.id, worker.delegatedFrom?.lastTurn?.endedAt]));
      try {
        const settled = await Promise.all(
          workers.map(async (worker) => {
            const link = worker.delegatedFrom;
            return link == null ? null : entryOf(worker, coordinator, link);
          }),
        );
        const entries = settled.filter((entry): entry is WorkerReportEntry => entry !== null);
        const markReported = (): void => {
          for (const worker of workers) {
            current.updateLink(worker.id, (link) => reportedLink(link, at, endedTurns.get(worker.id)));
          }
        };
        if (entries.length === 0) {
          markReported();
          return;
        }
        const text = workersReportMessage(entries);
        const workerReport = {
          workers: entries.map(({ agentName, agentId, handle, state }) => ({ agentName, agentId, handle, state })),
        };
        const toComposer = (): void => {
          current.giveBack(coordinator.id, text);
          current.onNotice(
            entries.length === 1
              ? `${entries[0].agentName}'s report is in the composer of ${coordinator.name}.`
              : `${entries.length} workers' reports are in the composer of ${coordinator.name}.`,
          );
        };
        if (!current.canPrompt(coordinator.id)) {
          // Waiting in the coordinator's composer is delivery.
          toComposer();
          markReported();
          return;
        }
        let isSent: boolean;
        try {
          isSent = await current.send(coordinator.id, text, [], { workerReport });
        } catch {
          isSent = false;
        }
        // The agent refused the prompt: the report waits in the composer, which counts as reported.
        if (!isSent) toComposer();
        markReported();
      } finally {
        for (const worker of workers) delivering.current.delete(worker.id);
        // The hand-over is over either way: Send in a worker may be judged again.
        bump();
      }
    };

    const drain = (): void => {
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
        const owed = owedWorkersOf(coordinatorId, current.sessions).filter((worker) => !delivering.current.has(worker.id));
        if (owed.length === 0) continue;
        // Nobody to tell: the workers' links end, and no notice, since nothing was lost the user can act on.
        if (coordinator === undefined || isArchived(coordinator)) {
          endLinks(owed);
          continue;
        }
        // In a turn, or waiting on the user: the report waits. A turn end or a change of the
        // sessions brings us back.
        if (current.isBusy(coordinatorId) || current.isWaiting(coordinatorId)) continue;
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
