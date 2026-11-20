import { describe, expect, test } from 'vitest';
import {
  MAX_AT_WORK,
  atWorkCount,
  WORKER_CLOSE_MS,
  cleanFiles,
  cleanSummary,
  WORKER_FILES_MAX,
  WORKER_SUMMARY_MAX,
  isReportOwed,
  issuedWorkerHandles,
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

describe('atWorkCount', () => {
  const worker = (id: string, from: string) =>
    session({ id, delegatedFrom: { sessionId: from, task: 't', startedAt: 100 } });
  const opened = (id: string, from: string) => session({ id, openedBy: { sessionId: from, at: 2 } });

  test('workers and opened sessions count together', () => {
    const sessions = [worker('w1', 'a'), worker('w2', 'a'), opened('o1', 'a'), worker('w3', 'other')];
    expect(
      atWorkCount({
        coordinatorId: 'a',
        sessions,
        isBusy: (id) => id !== 'w2',
        isWaiting: () => false,
        underWay: 1,
      }),
    ).toBe(3);
  });

  test('a session that waits counts, an archived opened one does not', () => {
    const sessions = [opened('o1', 'a'), session({ id: 'o2', openedBy: { sessionId: 'a', at: 2 }, archivedAt: 5 })];
    const count = atWorkCount({
      coordinatorId: 'a',
      sessions,
      isBusy: () => true,
      isWaiting: (id) => id === 'o1',
      underWay: 0,
    });
    expect(count).toBe(1);
  });
});

describe('issuedWorkerHandles', () => {
  const owned = (id: string, handle: string | undefined, overrides: Partial<Session> = {}) =>
    session({ id, delegatedFrom: { ...link, ...(handle !== undefined ? { handle } : {}) }, ...overrides });

  test('lists the handles of open, ended and archived workers of the coordinator', () => {
    const sessions = [
      owned('w1', 'worker-1'),
      owned('w2', 'worker-2', { delegatedFrom: { ...link, handle: 'worker-2', endedAt: 9 } }),
      owned('w3', 'worker-3', { archivedAt: 5 }),
    ];
    expect(issuedWorkerHandles('a', sessions)).toEqual(['worker-1', 'worker-2', 'worker-3']);
  });

  test('leaves out other coordinators, links with no handle and sessions with no link', () => {
    const sessions = [
      owned('w1', 'worker-1', { delegatedFrom: { ...link, sessionId: 'other', handle: 'worker-1' } }),
      owned('w2', undefined),
      session({ id: 'plain' }),
    ];
    expect(issuedWorkerHandles('a', sessions)).toEqual([]);
  });
});

describe('cleanSummary', () => {
  test('keeps the line breaks of a summary of several lines', () => {
    const cleaned = cleanSummary('one\ntwo\nthree');
    expect(cleaned).toBe('one\ntwo\nthree');
    expect(cleaned).not.toContain('\\u000A');
  });

  test('turns \\r\\n and \\r into \\n', () => {
    expect(cleanSummary('a\r\nb\rc')).toBe('a\nb\nc');
  });

  test('cuts the raw text before escaping and keeps a whole emoji last', () => {
    const cleaned = cleanSummary('a'.repeat(1999) + '\u{1F600}\u{1F600}');
    expect([...cleaned]).toHaveLength(WORKER_SUMMARY_MAX);
    expect([...cleaned].at(-1)).toBe('\u{1F600}');
  });

  test('escape codes do not eat the budget', () => {
    expect(cleanSummary('\u0001'.repeat(WORKER_SUMMARY_MAX))).toBe('\\u0001'.repeat(WORKER_SUMMARY_MAX));
  });

  test('spells out a bidi control character', () => {
    expect(cleanSummary('x\u202Ey')).toBe('x\\u202Ey');
  });

  test('gives an empty string for only white space', () => {
    expect(cleanSummary(' \n\t \r\n ')).toBe('');
  });
});

describe('cleanFiles', () => {
  test('escapes a control character, line breaks included', () => {
    expect(cleanFiles(['a\u0007b.ts', 'c\nd.ts'])).toEqual(['a\\u0007b.ts', 'c\\u000Ad.ts']);
  });

  test('drops empty entries and trims', () => {
    expect(cleanFiles([' a.ts ', '  ', ''])).toEqual(['a.ts']);
  });

  test('keeps at most WORKER_FILES_MAX', () => {
    const files = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
    expect(cleanFiles(files)).toHaveLength(WORKER_FILES_MAX);
  });

  test('gives undefined when none remain', () => {
    expect(cleanFiles([])).toBeUndefined();
    expect(cleanFiles(undefined)).toBeUndefined();
    expect(cleanFiles([' '])).toBeUndefined();
  });
});
