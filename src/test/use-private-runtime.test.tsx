import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener[]>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return Promise.resolve(() => {
      listeners.set(event, (listeners.get(event) ?? []).filter((listener) => listener !== cb));
    });
  },
  emit: () => Promise.resolve(),
}));

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
}));

import { usePrivateRuntime, type PrivateRuntimeDeps } from '../hooks/usePrivateWiring';
import type { usePrivateCredits } from '../hooks/usePrivateCredits';
import { PRIVATE_TOPUP_REQUEST_EVENT } from '../lib/private-topup-request';
import type { Session } from '../types';

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'qwen-code',
  cwd: '/w/app',
  status: 'running',
  createdAt: 1,
  privateMode: { modelId: 'Qwen/Qwen3.8-27B' },
  ...overrides,
});

function makeDeps(overrides: Partial<PrivateRuntimeDeps> = {}): PrivateRuntimeDeps {
  const s1 = makeSession('s-1');
  return {
    sessions: [s1],
    activeSession: s1,
    credits: {
      models: [{ id: 'Qwen/Qwen3.8-27B', name: 'Qwen 3.8 27B' }],
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      buy: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof usePrivateCredits>,
    updateState: vi.fn(),
    updateMessages: vi.fn(),
    saveSoon: vi.fn(),
    setNotice: vi.fn(),
    ...overrides,
  };
}

function emitTopup(payload: unknown) {
  for (const cb of listeners.get(PRIVATE_TOPUP_REQUEST_EVENT) ?? []) cb({ payload });
}

afterEach(() => {
  invoke.mockReset();
  listeners.clear();
});

describe('usePrivateRuntime', () => {
  it('approves a pending top-up request, opens chatTopupSession, buys usd, and warns when stale', async () => {
    invoke.mockResolvedValueOnce(true);
    const deps = makeDeps();
    const { result } = renderHook(() => usePrivateRuntime(deps));
    await act(async () => undefined);

    act(() => {
      emitTopup({ sessionId: 's-1', requestId: 'req-1', usd: 10, credits: 1000, reason: 'Need more credits.' });
    });

    await act(async () => {
      await result.current.answerTopupRequest('s-1', 'req-1', true);
    });
    expect(invoke).toHaveBeenCalledWith('private_answer_topup_request', {
      sessionId: 's-1',
      requestId: 'req-1',
      approve: true,
    });
    expect(result.current.chatTopupSession).toBe('s-1');
    expect(deps.credits.buy).toHaveBeenCalledWith(10);

    // When the backend no longer holds the request, invoke rejects, so warn and do not open checkout.
    invoke.mockRejectedValueOnce(new Error('No pending top-up request'));
    act(() => {
      emitTopup({ sessionId: 's-1', requestId: 'req-2', usd: 5, credits: 500, reason: 'Again.' });
    });
    await act(async () => {
      await result.current.answerTopupRequest('s-1', 'req-2', true);
    });
    expect(deps.setNotice).toHaveBeenCalledWith('That top-up request is no longer waiting.', 'warning');
    expect(deps.credits.buy).toHaveBeenCalledTimes(1);
  });

  it('onPrivateTurnEnd triggers verification and credit refresh for private sessions', async () => {
    invoke.mockResolvedValue([]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePrivateRuntime(deps));
    await act(async () => undefined);

    act(() => {
      result.current.onPrivateTurnEnd('s-1');
    });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('private_verify', { sessionId: 's-1' }));
    expect(deps.credits.refresh).toHaveBeenCalled();
  });

  it('loads the private model catalog automatically when a private session opens and models are null', async () => {
    const loadCatalog = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      credits: {
        models: null,
        loadCatalog,
        buy: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReturnType<typeof usePrivateCredits>,
    });

    renderHook(() => usePrivateRuntime(deps));
    await act(async () => undefined);

    expect(loadCatalog).toHaveBeenCalledTimes(1);
  });
});
