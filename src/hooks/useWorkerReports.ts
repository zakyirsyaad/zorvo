import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerOf,
  isOpenLink,
  reportMessage,
  reportedFiles,
  sourceOf,
} from '../lib/delegation';
import { agentNameIn, lastMessage } from '../lib/delegation-helpers';
import { isArchived } from '../lib/session-helpers';
import type { DelegationDeps } from './useDelegation';
import { useLatest } from './useLatest';

export type ReportDeps = Pick<
  DelegationDeps,
  'sessions' | 'agents' | 'transcripts' | 'isBusy' | 'isWaiting' | 'canPrompt' | 'send' | 'giveBack' | 'onNotice'
>;

interface DelegationOutcome {
  kind: 'reported' | 'failed';
  at: number;
}

/** A path as A sees it: relative to its folder when the tool named it inside. */
function relativeTo(cwd: string, path: string): string {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The queue that sends a finished delegate's report back to its source. The
 * same-tick decisions read refs, so they hold before React renders; the
 * revision only triggers the drain.
 */
export function useWorkerReports(deps: ReportDeps): {
  queue: (workerId: string, coordinatorId: string) => void;
  drop: (workerId: string) => void;
  isQueued: (workerId: string) => boolean;
  isDelivering: (workerId: string) => boolean;
  handoverSince: (workerId: string) => number | null;
  outcomeOf: (workerId: string) => { kind: 'reported' | 'failed'; at: number } | undefined;
  noteFailed: (workerId: string) => void;
  /** A turn ended somewhere: queued reports are looked at again. */
  recheck: () => void;
} {
  const { sessions, transcripts } = deps;
  const latest = useLatest(deps);
  // Each finished delegate whose report waits for its source, by delegate id, in arrival order.
  const pending = useRef(new Map<string, string>());
  // The delegates whose report is being sent right now.
  const delivering = useRef(new Set<string>());
  // What each delegate's last turn led to: a report, or a failed turn. Memory only.
  const outcomes = useRef(new Map<string, DelegationOutcome>());
  // When the hand-over began, for B's line while the report is still on its way.
  const handoverSince = useRef(new Map<string, number>());
  // Bumped when a turn ends or a hand-over settles, so the drain runs and the lines read again.
  const [revision, setRevision] = useState(0);

  const dropHandover = useCallback((delegateId: string) => {
    delivering.current.delete(delegateId);
    handoverSince.current.delete(delegateId);
  }, []);

  const queue = (workerId: string, coordinatorId: string): void => {
    // Set before anything can await or render: Send in B is refused from now on.
    pending.current.set(workerId, coordinatorId);
    handoverSince.current.set(workerId, Date.now());
    setRevision((current) => current + 1);
  };

  const drop = (workerId: string): void => {
    // A report still queued for A is dropped with the link.
    pending.current.delete(workerId);
    dropHandover(workerId);
  };

  const noteFailed = (workerId: string): void => {
    outcomes.current.set(workerId, { kind: 'failed', at: Date.now() });
    setRevision((current) => current + 1);
  };

  const recheck = (): void => {
    // A source's turn ended: a report that waited for it may go out now.
    if (pending.current.size > 0) setRevision((current) => current + 1);
  };

  useEffect(() => {
    const deliver = async (delegateId: string): Promise<void> => {
      const current = latest.current;
      try {
        const session = current.sessions.find((candidate) => candidate.id === delegateId);
        const link = session?.delegatedFrom;
        // B is gone, archived, or its link is no longer open: nothing to send.
        if (session === undefined || isArchived(session) || link === null || link === undefined || !isOpenLink(link)) return;

        const messages = current.transcripts[delegateId] ?? [];
        const last = lastMessage(messages);
        // Only a whole reply is reported. One with no text (tool calls only) is reported too,
        // as such: the agent that delegated was told an answer would arrive.
        if (last === undefined || last.role !== 'agent' || last.isComplete !== true) return;
        const answer = answerOf(last);

        const source = sourceOf(session, current.sessions);
        if (source === undefined) return;

        const agentName = agentNameIn(current.agents, session.profileId);
        const files = [
          ...new Set(reportedFiles(last).map((path) => relativeTo(source.cwd, path))),
        ];
        const report = reportMessage({ agentName, task: link.task, answer, files });

        if (!current.canPrompt(source.id)) {
          // Waiting in A's composer is delivery: A's line shows the report, not a running turn.
          outcomes.current.set(delegateId, { kind: 'reported', at: Date.now() });
          current.giveBack(source.id, report);
          current.onNotice(`${agentName}'s report is in the composer of ${source.name}.`);
          return;
        }

        const at = Date.now();
        let isSent: boolean;
        try {
          isSent = await current.send(source.id, report, [], {
            delegationReport: { agentName, agentId: session.profileId },
          });
        } catch {
          isSent = false;
        }
        if (isSent) {
          outcomes.current.set(delegateId, { kind: 'reported', at });
          return;
        }
        // The agent refused the prompt: the report waits in A's composer, as when A cannot take one.
        outcomes.current.set(delegateId, { kind: 'reported', at: Date.now() });
        current.giveBack(source.id, report);
        current.onNotice(`${agentName}'s report is in the composer of ${source.name}.`);
      } finally {
        dropHandover(delegateId);
        // The hand-over is over either way: Send in B may be judged again.
        setRevision((currentRevision) => currentRevision + 1);
      }
    };

    const drain = async (): Promise<void> => {
      // One report per source per pass: taking it starts the source's next turn.
      const served = new Set<string>();
      for (const [delegateId, sourceId] of [...pending.current]) {
        if (served.has(sourceId)) continue;
        const current = latest.current;
        // The source is in a turn, or waits for the user: the report waits too. It goes
        // out when that changes (the transcripts, the sessions or a turn end bring us back).
        if (current.isBusy(sourceId) || current.isWaiting(sourceId)) continue;
        // Deleted first: a second run (StrictMode) must not send the report again.
        if (!pending.current.delete(delegateId)) continue;
        delivering.current.add(delegateId);
        served.add(sourceId);
        await deliver(delegateId);
      }
    };
    void drain();
    // The triggers are the transcript, the sessions, and a turn that ended; `latest`
    // and `dropHandover` never change. The deps themselves come through `latest`, so
    // a queued report sends with the freshest functions rather than the render that
    // queued it.
  }, [transcripts, sessions, revision, latest, dropHandover]);

  return {
    queue,
    drop,
    isQueued: (workerId) => pending.current.has(workerId),
    isDelivering: (workerId) => delivering.current.has(workerId),
    handoverSince: (workerId) => handoverSince.current.get(workerId) ?? null,
    outcomeOf: (workerId) => outcomes.current.get(workerId),
    noteFailed,
    recheck,
  };
}
