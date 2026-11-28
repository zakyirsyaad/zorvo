import { createRef, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ComposerHandle } from '../components/ComposerDock';
import {
  useDelegationRuntime,
  useDelegationUi,
  type DelegationRuntimeDeps,
  type DelegationUiDeps,
} from '../hooks/useDelegationWiring';
import { createStartPlaces } from '../lib/start-places';
import type { AgentProfile, Session } from '../types';

const makeAgent = (id: string, name: string, detected = true): AgentProfile => ({
  id,
  name,
  command: id,
  detected,
  acp_args: [],
  source: 'registry',
  version: '1.0.0',
  distribution: 'npx',
  availability: detected ? 'ready' : 'not_installed',
  install_plan: null,
  description: null,
  installed_on_system: detected,
  listed: true,
});

const claude = makeAgent('claude-acp', 'Claude Code', true);
const codex = makeAgent('codex-acp', 'Codex', true);
const gemini = makeAgent('gemini-cli', 'Gemini CLI', false);

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'claude-acp',
  cwd: '/w/app',
  status: 'running',
  createdAt: 1,
  ...overrides,
});

function makeRuntimeDeps(overrides: Partial<DelegationRuntimeDeps> = {}): DelegationRuntimeDeps {
  return {
    sessions: [makeSession('s-1')],
    agents: [claude, codex],
    transcripts: {},
    agentOptions: undefined,
    isSessionBusy: () => false,
    isSessionWaiting: () => false,
    isAgentRemovedFor: () => false,
    signInStateOf: () => 'ready',
    startPlaces: createStartPlaces(),
    send: vi.fn().mockResolvedValue(true),
    stopAgent: vi.fn().mockResolvedValue(true),
    resumeAgent: vi.fn().mockResolvedValue(true),
    canReopen: () => true,
    isTurnUnderWay: () => false,
    hasLiveTasks: () => false,
    hasFailedTurn: () => false,
    hasQueuedMessages: () => false,
    ensureLoaded: vi.fn(),
    patchSession: vi.fn(),
    startSession: vi.fn(),
    selectSession: vi.fn(),
    updateLink: vi.fn(),
    readMessages: vi.fn().mockResolvedValue([]),
    giveBack: vi.fn(),
    onNotice: vi.fn(),
    delegationTurnEndedRef: { current: () => {} },
    delegationTurnSettledRef: { current: () => {} },
    delegationBlockedRef: { current: () => null },
    ...overrides,
  };
}

function makeUiDeps(overrides: Partial<DelegationUiDeps> = {}): DelegationUiDeps {
  const composerRef = createRef<ComposerHandle | null>() as MutableRefObject<ComposerHandle | null>;
  composerRef.current = {
    insertPaths: vi.fn(),
    insertText: vi.fn(),
    restore: vi.fn(),
    giveBack: vi.fn(),
    holdsRestored: () => false,
    clear: vi.fn(),
    focus: vi.fn(),
  };
  const menuButtonRef = createRef<HTMLButtonElement | null>() as MutableRefObject<HTMLButtonElement | null>;
  return {
    sessions: [makeSession('s-1')],
    activeSession: makeSession('s-1'),
    activeSessionId: 's-1',
    sessionOfItsOwn: makeSession('s-1'),
    agents: [claude, codex, gemini],
    agentsInUse: [claude, codex, gemini],
    agentOptions: undefined,
    signInStateOf: (id) => (id === 'codex-acp' ? 'needed' : 'ready'),
    isInCompareRun: () => false,
    isSessionBusy: () => false,
    delegationMention: null,
    delegation: {
      start: vi.fn().mockResolvedValue(true),
      end: vi.fn(),
      delegateBlockedReason: () => null,
      sendBlockedReason: () => null,
      viewsFor: () => [],
    },
    compareModelProbe: {
      ask: vi.fn(),
      stateOf: () => undefined,
    },
    composerRef,
    menuButtonRef,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDelegationWiring', () => {
  it('syncs ACP engine delegation refs and ends open delegate links on archive', () => {
    const delegationTurnEndedRef: DelegationRuntimeDeps['delegationTurnEndedRef'] = { current: () => {} };
    const delegationTurnSettledRef: DelegationRuntimeDeps['delegationTurnSettledRef'] = { current: () => {} };
    const delegationBlockedRef: DelegationRuntimeDeps['delegationBlockedRef'] = { current: () => null };
    const patchSession = vi.fn();
    const updateLink = vi.fn();

    const source = makeSession('s-1');
    const openWorker = makeSession('s-w1', {
      delegatedFrom: { sessionId: 's-1', task: 'check tests', startedAt: 10 },
    });
    const closedWorker = makeSession('s-w2', {
      delegatedFrom: { sessionId: 's-1', task: 'old task', startedAt: 5, endedAt: 9 },
    });

    const deps = makeRuntimeDeps({
      sessions: [source, openWorker, closedWorker],
      patchSession,
      updateLink,
      delegationTurnEndedRef,
      delegationTurnSettledRef,
      delegationBlockedRef,
    });

    const { result } = renderHook(() => useDelegationRuntime(deps));

    expect(delegationTurnEndedRef.current).toBe(result.current.delegation.onTurnEnded);
    expect(delegationTurnSettledRef.current).toBe(result.current.delegation.onTurnSettled);
    expect(delegationBlockedRef.current).toBe(result.current.delegation.sendBlockedReason);

    act(() => {
      result.current.endForArchived('s-1', [source, openWorker, closedWorker]);
    });
    expect(updateLink).toHaveBeenCalledTimes(1);
    expect(updateLink).toHaveBeenCalledWith('s-w1', expect.any(Function));
  });

  it('derives delegationAgents, mention states, followUp vs start summary, and end labels', () => {
    const source = makeSession('s-1');
    const existingWorker = makeSession('s-w1', {
      profileId: 'codex-acp',
      delegatedFrom: { sessionId: 's-1', task: 'first task', startedAt: 10 },
    });

    const { result, rerender } = renderHook((props: DelegationUiDeps) => useDelegationUi(props), {
      initialProps: makeUiDeps({
        sessions: [source, existingWorker],
        activeSession: source,
        sessionOfItsOwn: source,
        delegationMention: { agentId: 'claude-acp', task: 'review api' },
      }),
    });

    expect(result.current.delegationAgents).toEqual([
      { id: 'claude-acp', name: 'Claude Code', status: 'ready' },
      { id: 'codex-acp', name: 'Codex', status: 'needs-sign-in' },
      { id: 'gemini-cli', name: 'Gemini CLI', status: 'not-installed' },
    ]);
    expect(result.current.delegationSendLabel).toBe('Delegate to Claude Code');
    expect(result.current.delegationSummary?.text).toContain('Claude Code');
    expect(result.current.delegationEnds).toEqual([{ label: 'End delegation', run: expect.any(Function) }]);

    // Mentioning Codex, which already has a sole open delegate, switches to followUpSummary.
    const secondWorker = makeSession('s-w2', {
      profileId: 'claude-acp',
      delegatedFrom: { sessionId: 's-1', task: 'second task', startedAt: 20 },
    });
    rerender(
      makeUiDeps({
        sessions: [source, existingWorker, secondWorker],
        activeSession: source,
        sessionOfItsOwn: source,
        delegationMention: { agentId: 'codex-acp', task: 'follow up' },
      }),
    );

    expect(result.current.delegationSummary).toBeUndefined();
    expect(result.current.delegationBlock).toContain('Codex');
    expect(result.current.delegationEnds).toEqual([
      { label: 'End delegation to Codex', run: expect.any(Function) },
      { label: 'End delegation to Claude Code', run: expect.any(Function) },
    ]);

    // When `codex-acp` is signed in and has a sole open delegate, `delegationSummary` uses followUpSummary.
    rerender(
      makeUiDeps({
        sessions: [source, existingWorker, secondWorker],
        activeSession: source,
        sessionOfItsOwn: source,
        signInStateOf: () => 'ready',
        delegationMention: { agentId: 'codex-acp', task: 'follow up' },
      }),
    );
    expect(result.current.delegationSummary?.text).toBe('Goes to the Codex session this session already delegated to.');
  });

  it('filters shownDelegationViews while active session is busy and resolves openerSession', () => {
    const opener = makeSession('s-parent', { name: 'Parent' });
    const child = makeSession('s-1', { openedBy: { sessionId: 's-parent', at: 15 } });
    const views = [
      {
        role: 'source' as const,
        otherSessionId: 's-w1',
        otherName: 'Worker 1',
        agentName: 'Codex',
        task: 'run tests',
        state: 'working' as const,
        workingSince: 100,
        reportedAt: null,
      },
      {
        role: 'source' as const,
        otherSessionId: 's-w2',
        otherName: 'Worker 2',
        agentName: 'Gemini',
        task: 'done',
        state: 'reported' as const,
        workingSince: null,
        reportedAt: 200,
      },
    ];

    const endMock = vi.fn();
    const workerSession = makeSession('s-worker', {
      delegatedFrom: { sessionId: 's-parent', task: 'do work', startedAt: 30 },
    });

    const { result, rerender } = renderHook((props: DelegationUiDeps) => useDelegationUi(props), {
      initialProps: makeUiDeps({
        sessions: [opener, child],
        activeSession: child,
        sessionOfItsOwn: child,
        delegation: {
          start: vi.fn().mockResolvedValue(true),
          end: endMock,
          delegateBlockedReason: () => null,
          sendBlockedReason: () => null,
          viewsFor: () => views,
        },
      }),
    });

    expect(result.current.openerSession?.id).toBe('s-parent');
    expect(result.current.delegationView?.otherSessionId).toBe('s-w1');
    expect(result.current.shownDelegationViews).toHaveLength(1);

    // Busy active session hides delegation status lines.
    rerender(
      makeUiDeps({
        sessions: [opener, workerSession],
        activeSession: workerSession,
        activeSessionId: 's-worker',
        sessionOfItsOwn: workerSession,
        isSessionBusy: (id) => id === 's-worker',
        delegation: {
          start: vi.fn().mockResolvedValue(true),
          end: endMock,
          delegateBlockedReason: () => null,
          sendBlockedReason: () => null,
          viewsFor: () => views,
        },
      }),
    );

    expect(result.current.shownDelegationViews).toEqual([]);
    expect(result.current.onDelegate).toBeUndefined();
    expect(result.current.delegationEnds).toHaveLength(1);
    act(() => {
      result.current.delegationEnds?.[0].run();
    });
    expect(endMock).toHaveBeenCalledWith('s-worker');
  });
});
