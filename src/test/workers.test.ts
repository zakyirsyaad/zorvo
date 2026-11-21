import { describe, expect, test } from 'vitest';
import {
  MAX_AT_WORK,
  WORKER_CLOSE_MS,
  WORKER_FILES_MAX,
  WORKER_SUMMARY_MAX,
  isReportOwed,
  nextWorkerHandle,
  owedWorkersOf,
  startRefusal,
  toolsRoleOf,
  withNewTask,
  withOutcome,
  withReported,
  withTurnEnd,
  workerByHandle,
  workerHandleOf,
  workerStateOf,
} from '../lib/workers';
import type { DelegationLink, Session } from '../types';

const link: DelegationLink = { sessionId: 'a', task: 't', startedAt: 100 };
const idle = { isBusy: false, isWaiting: false };

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's',
    name: 'Worker',
    profileId: 'codex',
    cwd: '/w',
    status: 'idle',
    createdAt: 1,
    ...overrides,
  } as Session;
}

describe('constants', () => {
  test('hold the agreed limits', () => {
    expect([MAX_AT_WORK, WORKER_SUMMARY_MAX, WORKER_FILES_MAX, WORKER_CLOSE_MS]).toEqual([4, 2_000, 50, 120_000]);
  });
});

describe('workerStateOf', () => {
  test('a worker in a turn is working, and needs you when it waits', () => {
    expect(workerStateOf({ link, isBusy: true, isWaiting: false })).toBe('working');
    expect(workerStateOf({ link, isBusy: true, isWaiting: true })).toBe('needs-you');
  });
  test('a worker that waits without being busy needs you', () => {
    expect(workerStateOf({ link, isBusy: false, isWaiting: true })).toBe('needs-you');
  });
  test('a worker with no turn behind it has no state', () => {
    expect(workerStateOf({ link, ...idle })).toBeNull();
  });
  test.each([
    [{ lastTurn: { endedAt: 300, how: 'finished' }, outcome: { result: 'succeeded', at: 250 } }, 'succeeded'],
    [{ lastTurn: { endedAt: 300, how: 'finished' }, outcome: { result: 'failed', at: 250 } }, 'failed'],
    [{ lastTurn: { endedAt: 300, how: 'finished' } }, 'did-not-report'],
    [{ lastTurn: { endedAt: 300, how: 'failed' } }, 'errored'],
    [{ lastTurn: { endedAt: 300, how: 'cancelled' } }, 'stopped'],
    [{ lastTurn: { endedAt: 300, how: 'exited' } }, 'gone'],
  ] as const)('the last turn decides the state %#', (extra, state) => {
    expect(workerStateOf({ link: { ...link, ...extra }, ...idle })).toBe(state);
  });
});

describe('link updates', () => {
  test('a turn end keeps an outcome reported inside that turn only', () => {
    const reported = {
      ...link,
      lastTurn: { endedAt: 300, how: 'finished' as const },
      outcome: { result: 'succeeded' as const, at: 250 },
    };
    expect(withTurnEnd(reported, { how: 'finished', at: 500 }).outcome).toBeNull();
    expect(withTurnEnd({ ...link, outcome: { result: 'failed', at: 150 } }, { how: 'finished', at: 200 }).outcome?.result).toBe('failed');
    expect(withTurnEnd({ ...link, outcome: { result: 'succeeded', at: 150 } }, { how: 'cancelled', at: 200 }).outcome).toBeNull();
  });
  test('a turn end records how it ended and does not change the link it was given', () => {
    const next = withTurnEnd(link, { how: 'failed', at: 200, reason: 'boom' });
    expect(next.lastTurn).toEqual({ endedAt: 200, how: 'failed', reason: 'boom' });
    expect(link).toEqual({ sessionId: 'a', task: 't', startedAt: 100 });
  });
  test('an outcome is set, and a new task clears it', () => {
    const done = withOutcome(link, { result: 'succeeded', at: 150, summary: 's' });
    expect(done.outcome).toEqual({ result: 'succeeded', at: 150, summary: 's' });
    const again = withNewTask(done, 'next');
    expect(again.task).toBe('next');
    expect(again.outcome).toBeNull();
  });
  test('reporting drops the summary and the files', () => {
    const done = withOutcome(link, { result: 'failed', at: 150, summary: 's', files: ['x'] });
    const reported = withReported(done, 400);
    expect(reported.reportedAt).toBe(400);
    expect(reported.outcome).toEqual({ result: 'failed', at: 150 });
    expect(withReported(link, 400).outcome).toBeUndefined();
  });
});

describe('handles', () => {
  test('handles count up and an old link is named by its agent', () => {
    expect(nextWorkerHandle(['worker-1', 'worker-3', 'codex'])).toBe('worker-4');
    expect(nextWorkerHandle([])).toBe('worker-1');
    expect(nextWorkerHandle(['worker-9007199254740992', 'worker-2'])).toBe('worker-3');
    expect(workerHandleOf(session({ profileId: 'codex', delegatedFrom: link }))).toBe('codex');
    expect(workerHandleOf(session({ profileId: 'codex', delegatedFrom: { ...link, handle: 'worker-2' } }))).toBe('worker-2');
    expect(workerHandleOf(session({ profileId: 'codex', delegatedFrom: { ...link, endedAt: 9 } }))).toBeUndefined();
  });
  test('a coordinator finds only its own unarchived worker, the newest when several match', () => {
    const mine = session({ id: 'w1', createdAt: 1, delegatedFrom: { ...link, handle: 'worker-1' } });
    const newer = session({ id: 'w1b', createdAt: 5, delegatedFrom: { ...link, handle: 'worker-1' } });
    const other = session({ id: 'w2', delegatedFrom: { ...link, sessionId: 'b', handle: 'worker-2' } });
    const archived = session({ id: 'w3', archivedAt: 9, delegatedFrom: { ...link, handle: 'worker-3' } });
    const sessions = [newer, mine, other, archived];
    expect(workerByHandle('a', 'worker-1', sessions)?.id).toBe('w1b');
    expect(workerByHandle('a', 'worker-2', sessions)).toBeUndefined();
    expect(workerByHandle('a', 'worker-3', sessions)).toBeUndefined();
    expect(workerByHandle('a', 'nope', sessions)).toBeUndefined();
  });
});

describe('reports owed', () => {
  test('a report is owed after a turn that was not reported', () => {
    expect(isReportOwed({ ...link, lastTurn: { endedAt: 300, how: 'finished' }, reportedAt: 200 })).toBe(true);
    expect(isReportOwed({ ...link, lastTurn: { endedAt: 300, how: 'finished' }, reportedAt: 300 })).toBe(false);
    expect(isReportOwed({ ...link, lastTurn: { endedAt: 300, how: 'finished' }, endedAt: 400 })).toBe(false);
    expect(isReportOwed(link)).toBe(false);
    expect(isReportOwed(null)).toBe(false);
  });
  test('owed workers come back oldest turn end first, for their coordinator only', () => {
    const owed = (id: string, endedAt: number, extra: Partial<Session> = {}) =>
      session({ id, delegatedFrom: { ...link, handle: id, lastTurn: { endedAt, how: 'finished' } }, ...extra });
    const sessions = [
      owed('late', 500),
      owed('early', 200),
      owed('archived', 100, { archivedAt: 9 }),
      session({ id: 'x', delegatedFrom: { ...link, sessionId: 'b', lastTurn: { endedAt: 50, how: 'finished' } } }),
      session({ id: 'quiet', delegatedFrom: { ...link, lastTurn: { endedAt: 60, how: 'finished' }, reportedAt: 60 } }),
    ];
    expect(owedWorkersOf('a', sessions).map((s) => s.id)).toEqual(['early', 'late']);
  });
});

describe('startRefusal', () => {
  test('the fifth start is refused', () => {
    expect(startRefusal(3)).toBeNull();
    expect(startRefusal(4)).toBe('4 are running. Start this one when one finishes.');
  });
});

describe('toolsRoleOf', () => {
  test.each([
    [{}, 'coordinator'],
    [{ delegatedFrom: link }, 'worker'],
    [{ delegatedFrom: { ...link, endedAt: 9 } }, null],
    [{ openedBy: { sessionId: 'a', at: 1 } }, null],
    [{ compareRunId: 'r' }, null],
  ] as const)('a session gets the tools of its role %#', (fields, role) => {
    expect(toolsRoleOf(fields)).toBe(role);
  });
  test('a fork of a worker gets no tools', () => {
    expect(toolsRoleOf({ forkedFrom: 'w' }, [{ id: 'w', delegatedFrom: link }])).toBeNull();
  });
  test('a fork of a handoff or compare-run session gets no tools', () => {
    expect(toolsRoleOf({ forkedFrom: 'o' }, [{ id: 'o', openedBy: { sessionId: 'a', at: 1 } }])).toBeNull();
    expect(toolsRoleOf({ forkedFrom: 'c' }, [{ id: 'c', compareRunId: 'r' }])).toBeNull();
  });
  test('a fork of a plain session, or of one that is gone, is a coordinator', () => {
    expect(toolsRoleOf({ forkedFrom: 'p' }, [{ id: 'p' }])).toBe('coordinator');
    expect(toolsRoleOf({ forkedFrom: 'gone' }, [])).toBe('coordinator');
  });
  test('a loop of forks ends', () => {
    const sessions = [{ id: 'x', forkedFrom: 'y' }, { id: 'y', forkedFrom: 'x' }];
    expect(toolsRoleOf({ forkedFrom: 'x' }, sessions)).toBe('coordinator');
  });
});
