import { createRef, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ComposerHandle } from '../components/ComposerDock';
import { useMessageDeliveryWiring, type MessageDeliveryWiringDeps } from '../hooks/useMessageDeliveryWiring';
import { NO_CHOICES } from '../lib/acp-draft';
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

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'claude-acp',
  cwd: '/w/app',
  status: 'running',
  acpSessionId: `acp-${id}`,
  createdAt: 1,
  ...overrides,
});

function makeDeps(overrides: Partial<MessageDeliveryWiringDeps> = {}): MessageDeliveryWiringDeps {
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
  return {
    sessions: [makeSession('s-1')],
    activeSession: makeSession('s-1'),
    activeSessionId: 's-1',
    isActiveRunning: true,
    isResumable: false,
    activeWorkspacePath: '/w/app',
    agents: [claude],
    activeAgent: claude,
    newSessionAgent: claude,
    agentOptions: undefined,
    transcripts: {},
    startChoices: NO_CHOICES,
    setAcpChoices: vi.fn(),
    isCompare: false,
    isPrivateLaunch: false,
    isSecretGuardEnabled: true,
    delegationMention: null,
    delegation: {
      start: vi.fn().mockResolvedValue(true),
      sendBlockedReason: () => null,
    },
    review: {
      slot: null,
      rearm: vi.fn(),
      sendFrom: vi.fn(),
    },
    secretGuardCheck: (_msg, onAllow) => onAllow(),
    dropCompareSignIn: vi.fn(),
    sendAcp: vi.fn().mockResolvedValue(true),
    resumeAcp: vi.fn().mockResolvedValue(true),
    isAcpBusy: () => false,
    isTurnUnderWay: () => false,
    isStarting: () => false,
    isRestarting: () => false,
    isSessionWaiting: () => false,
    restartSession: vi.fn().mockResolvedValue(true),
    handleInterrupt: vi.fn(),
    handleNewRun: vi.fn(),
    handleNewSession: vi.fn().mockResolvedValue(undefined),
    patchSession: vi.fn(),
    giveBackMessage: vi.fn(),
    composerRef,
    onNotice: vi.fn(),
    queueTurnSettledRef: { current: () => {} },
    queueAgentEndedRef: { current: () => {} },
    queuePromptStartedRef: { current: () => {} },
    queueRewoundRef: { current: () => {} },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMessageDeliveryWiring', () => {
  it('sendTo drops compare sign-in, calls sendAcp, and auto-names first message unless namedByUser', async () => {
    const deps = makeDeps({
      sessions: [
        makeSession('s-1', { name: 'Session #1' }),
        makeSession('s-2', { name: 'Session #2', namedByUser: true }),
      ],
    });
    const { result } = renderHook(() => useMessageDeliveryWiring(deps));

    await act(async () => {
      const ok = await result.current.sendTo('s-1', { text: 'Refactor auth flow' });
      expect(ok).toBe(true);
    });
    expect(deps.dropCompareSignIn).toHaveBeenCalledWith('s-1');
    expect(deps.sendAcp).toHaveBeenCalledWith('s-1', 'Refactor auth flow', undefined);
    expect(deps.patchSession).toHaveBeenCalledWith('s-1', expect.objectContaining({ titleSource: undefined, name: expect.any(String) }));

    vi.mocked(deps.patchSession).mockClear();
    await act(async () => {
      await result.current.sendTo('s-2', { text: 'Do not rename me' });
    });
    expect(deps.patchSession).not.toHaveBeenCalled();
  });

  it('sendFromComposer respects delegation block and giveBack flag', async () => {
    const blockedDeps = makeDeps({
      delegation: {
        start: vi.fn().mockResolvedValue(true),
        sendBlockedReason: () => 'Waiting on worker report',
      },
    });
    const blocked = renderHook(() => useMessageDeliveryWiring(blockedDeps));
    await act(async () => {
      const sent = await blocked.result.current.sendFromComposer('s-1', { text: 'hello' }, true);
      expect(sent).toBe(false);
    });
    expect(blockedDeps.giveBackMessage).toHaveBeenCalledWith('s-1', 'hello', undefined);
    expect(blockedDeps.sendAcp).not.toHaveBeenCalled();

    const rejectedDeps = makeDeps({ sendAcp: vi.fn().mockResolvedValue(false) });
    const rejected = renderHook(() => useMessageDeliveryWiring(rejectedDeps));
    await act(async () => {
      const sent = await rejected.result.current.sendFromComposer('s-1', { text: 'retry' }, false);
      expect(sent).toBe(false);
    });
    expect(rejectedDeps.giveBackMessage).not.toHaveBeenCalled();
  });

  it('handleSendMessage routes @mention, busy queue vs ended turn, compare run, and review slots', async () => {
    // 1. @mention starts delegation and gives back on failure.
    const mentionFail = makeDeps({
      delegationMention: { agentId: 'claude-acp', task: 'check logs' },
      delegation: {
        start: vi.fn().mockResolvedValue(false),
        sendBlockedReason: () => null,
      },
    });
    const mentionHook = renderHook(() => useMessageDeliveryWiring(mentionFail));
    await act(async () => {
      mentionHook.result.current.handleSendMessage('@claude check logs', ['/a.ts']);
    });
    expect(mentionFail.delegation.start).toHaveBeenCalledWith('s-1', 'claude-acp', 'check logs', {
      attachments: ['/a.ts'],
      choices: expect.any(Object),
    });
    expect(mentionFail.giveBackMessage).toHaveBeenCalledWith('s-1', '@claude check logs', ['/a.ts']);

    // 2. Busy turn queues after secretGuardCheck, or sends directly if turn ended during scan.
    let turnUnderWay = true;
    const busyDeps = makeDeps({
      isAcpBusy: () => true,
      isTurnUnderWay: () => turnUnderWay,
    });
    const busyHook = renderHook(() => useMessageDeliveryWiring(busyDeps));
    expect(busyHook.result.current.isQueueingActive).toBe(true);
    act(() => {
      busyHook.result.current.handleSendMessage('queued prompt');
    });
    expect(busyHook.result.current.queue.queueOf('s-1')).toHaveLength(1);

    const delayedDeps = makeDeps({
      isAcpBusy: () => true,
      isTurnUnderWay: () => turnUnderWay,
      secretGuardCheck: (_msg, onAllow) => {
        turnUnderWay = false;
        onAllow();
      },
    });
    const delayedHook = renderHook(() => useMessageDeliveryWiring(delayedDeps));
    await act(async () => {
      delayedHook.result.current.handleSendMessage('sent after scan');
    });
    expect(delayedDeps.sendAcp).toHaveBeenCalledWith('s-1', 'sent after scan', undefined);

    // 3. Active send rearms reviewSlot and calls review.sendFrom; compare draft calls handleNewRun.
    const rearm = vi.fn();
    const sendFrom = vi.fn();
    const slot = { sessionId: 's-1', commentIds: ['c-1'] } as unknown as MessageDeliveryWiringDeps['review']['slot'];
    const reviewDeps = makeDeps({
      review: { slot, rearm, sendFrom },
    });
    const reviewHook = renderHook(() => useMessageDeliveryWiring(reviewDeps));
    await act(async () => {
      reviewHook.result.current.handleSendMessage('apply review');
    });
    expect(rearm).toHaveBeenCalledWith(slot);
    expect(sendFrom).toHaveBeenCalledWith('s-1', 'apply review');
    expect(reviewDeps.sendAcp).toHaveBeenCalledWith('s-1', 'apply review', undefined);

    const compareDeps = makeDeps({
      activeSession: undefined,
      activeSessionId: '',
      isActiveRunning: false,
      isCompare: true,
    });
    const compareHook = renderHook(() => useMessageDeliveryWiring(compareDeps));
    act(() => {
      compareHook.result.current.handleSendMessage('compare prompt');
    });
    expect(compareDeps.handleNewRun).toHaveBeenCalledWith({ text: 'compare prompt', attachments: undefined });
  });
});
