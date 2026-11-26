import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
}));

import { usePrivateContinue, type PrivateContinueDeps } from '../hooks/usePrivateWiring';
import type { usePrivateCredits } from '../hooks/usePrivateCredits';
import type { AgentProfile, ChatMessage, Session } from '../types';

const qwen: AgentProfile = {
  id: 'qwen-code',
  name: 'Qwen Code',
  command: 'qwen',
  detected: true,
  acp_args: [],
  source: 'registry',
  version: '0.27.0',
  distribution: 'npx',
  availability: 'ready',
  install_plan: null,
  description: null,
  installed_on_system: true,
  listed: true,
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 's-1',
  name: 'Private chat',
  profileId: 'qwen-code',
  cwd: '/w/app',
  status: 'running',
  createdAt: 1,
  privateMode: { modelId: 'Qwen/Qwen3.8-27B', sessionCap: 100 },
  ...overrides,
});

function makeDeps(overrides: Partial<PrivateContinueDeps> = {}): PrivateContinueDeps {
  const activeSession = makeSession();
  const clearCreditsOut = vi.fn();
  return {
    credits: {
      creditsOut: {},
      clearCreditsOut,
      status: { ownKey: { saved: true } },
    } as unknown as ReturnType<typeof usePrivateCredits>,
    activeSession,
    sessions: [activeSession],
    agents: [qwen],
    agentsInUse: [qwen],
    transcripts: {},
    agentOptions: undefined,
    openNewSession: vi.fn(),
    forkSession: vi.fn().mockResolvedValue(undefined),
    patchSession: vi.fn(),
    startSession: vi.fn(),
    updateSettings: vi.fn(),
    setNotice: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  invoke.mockReset();
});

describe('usePrivateContinue', () => {
  it('raiseCap doubles the cap, patches the session, clears creditsOut, and warns on failure', async () => {
    invoke.mockResolvedValueOnce(200);
    const deps = makeDeps();

    const { result } = renderHook(() => usePrivateContinue(deps));

    await act(async () => {
      await result.current.raiseCap();
    });

    expect(invoke).toHaveBeenCalledWith('private_raise_session_cap', { sessionId: 's-1', credits: 200 });
    expect(deps.patchSession).toHaveBeenCalledWith('s-1', {
      privateMode: { modelId: 'Qwen/Qwen3.8-27B', sessionCap: 200 },
    });
    expect(deps.credits.clearCreditsOut).toHaveBeenCalledWith('s-1');
    expect(result.current.isRaisingCap).toBe(false);

    invoke.mockRejectedValueOnce(new Error('unreachable'));
    await act(async () => {
      await result.current.raiseCap();
    });
    expect(deps.setNotice).toHaveBeenCalledWith(expect.any(String), 'warning');
    expect(result.current.isRaisingCap).toBe(false);
  });

  it('startUncappedSession forks uncapped when messages exist, or starts fresh when empty', () => {
    const forkSession = vi.fn().mockResolvedValue(undefined);
    const startSession = vi.fn();
    const message: ChatMessage = { id: 'm-1', role: 'agent', content: 'hi', timestamp: 1 };

    const withMessages = renderHook(() =>
      usePrivateContinue(makeDeps({ transcripts: { 's-1': [message] }, forkSession, startSession })),
    );
    act(() => withMessages.result.current.startUncappedSession());
    expect(forkSession).toHaveBeenCalledWith('m-1', { uncappedPrivate: true });
    expect(startSession).not.toHaveBeenCalled();

    forkSession.mockClear();
    const empty = renderHook(() =>
      usePrivateContinue(makeDeps({ transcripts: {}, forkSession, startSession })),
    );
    act(() => empty.result.current.startUncappedSession());
    expect(forkSession).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledWith({
      agent: qwen,
      cwd: '/w/app',
      name: 'Session #1',
      privateMode: { modelId: 'Qwen/Qwen3.8-27B' },
    });
  });

  it('switchToCredits sets paymentSource to credits, clears creditsOut, and forks or starts fresh', () => {
    const forkSession = vi.fn().mockResolvedValue(undefined);
    const startSession = vi.fn();
    const updateSettings = vi.fn();
    const message: ChatMessage = { id: 'm-9', role: 'user', content: 'hello', timestamp: 1 };
    const depsWithMsg = makeDeps({
      activeSession: makeSession({ privateMode: { modelId: 'Qwen/Qwen3.8-27B', ownKey: true } }),
      transcripts: { 's-1': [message] },
      forkSession,
      startSession,
      updateSettings,
    });

    const first = renderHook(() => usePrivateContinue(depsWithMsg));
    act(() => first.result.current.switchToCredits());
    expect(updateSettings).toHaveBeenCalledWith({ paymentSource: 'credits' });
    expect(depsWithMsg.credits.clearCreditsOut).toHaveBeenCalledWith('s-1');
    expect(forkSession).toHaveBeenCalledWith('m-9', { creditsPrivate: true });

    const depsEmpty = makeDeps({
      activeSession: makeSession({ privateMode: { modelId: 'Qwen/Qwen3.8-27B', ownKey: true } }),
      transcripts: {},
      forkSession: vi.fn().mockResolvedValue(undefined),
      startSession,
      updateSettings,
    });
    const second = renderHook(() => usePrivateContinue(depsEmpty));
    act(() => second.result.current.switchToCredits());
    expect(startSession).toHaveBeenCalledWith({
      agent: qwen,
      cwd: '/w/app',
      name: 'Session #1',
      privateMode: { modelId: 'Qwen/Qwen3.8-27B' },
    });
  });
});
