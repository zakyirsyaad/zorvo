import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
vi.mock('@tauri-apps/api/event', () => ({ listen: (name: string, callback: Listener) => {
  listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name));
} }));
import { useAgentTools, type AgentToolsDeps } from '../hooks/useAgentTools';
import { ALLOW_SESSION, DENY } from '../lib/agent-tool-card';
import { buildSessionSnapshot } from '../lib/popout-bridge';
import { fakeProfiles } from './fixtures/agents';
import type { ChatMessage, Session } from '../types';

const session: Session = { id: 's1', name: 'Browser work', profileId: fakeProfiles[0].id, cwd: '/workspace', status: 'running', createdAt: 1, transport: 'acp' };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
afterEach(() => { cleanup(); vi.restoreAllMocks(); listeners.clear(); });

function setup(extra?: (command: string, args?: Record<string, unknown>) => Promise<unknown> | undefined) {
  let grant = false;
  const invoke = vi.spyOn(internals(), 'invoke').mockImplementation(async (command, args) => {
    const result = extra?.(command, args);
    if (result !== undefined) return result;
    if (command === 'browser_permission_status') return grant;
    if (command === 'browser_permission') { grant = args?.allow === true; return null; }
    if (command === 'browser_agent_execute') return { accepted: true };
    return null;
  });
  const messages: Record<string, ChatMessage[]> = {};
  const onAttention = vi.fn();
  const deps: AgentToolsDeps = {
    sessions: [session], agents: fakeProfiles, statusOf: () => 'ready', delegatesOf: () => [],
    giveTask: async () => ({ ok: false, reason: 'unused' }), workspaces: [],
    openSession: async () => ({ ok: false, reason: 'unused' }), openedOf: () => [],
    updateMessages: (id, update) => { messages[id] = update(messages[id] ?? []); }, onAttention,
    messagesOf: async id => messages[id] ?? [], stateOf: () => 'idle', stopTurn: vi.fn(), onArtifactShown: vi.fn(),
  };
  const hook = renderHook(() => useAgentTools(deps));
  const deliver = async (name: string, payload: unknown) => {
    await waitFor(() => expect(listeners.has(name)).toBe(true));
    await act(async () => { listeners.get(name)?.({ payload }); });
  };
  const call = (id: string, tool = 'browser', args: unknown = { operation: 'tabs.list' }) =>
    deliver('agent-tool-call', { callId: id, sessionId: session.id, tool, args });
  const cards = () => (messages.s1 ?? []).flatMap(message => message.actionCard ? [message.actionCard] : []);
  const choose = async (allow: boolean) => {
    const card = cards().find(card => card.status === 'pending')!;
    await act(async () => { expect(hook.result.current.chooseCard('s1', card.id, allow ? ALLOW_SESSION : DENY)).toBe(true); });
  };
  return { ...hook, invoke, messages, cards, call, choose, deliver, onAttention, setBackendGrant: (value: boolean) => { grant = value; } };
}

describe('browser access through ordinary tool cards', () => {
  it('groups waiting browser calls on the requesting chat and retains the card in popout snapshots', async () => {
    const t = setup();
    await t.call('first', 'browser', { operation: 'tabs.open', url: 'https://example.com/' });
    await t.call('second', 'browser', { operation: 'snapshot' });
    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0]).toMatchObject({ status: 'pending', zorvoTool: { tool: 'browser' }, prompt: '> tabs.open\n> snapshot' });
    expect(t.result.current.isWaiting('s1')).toBe(true);
    expect(t.onAttention).toHaveBeenCalledOnce();
    expect(t.invoke.mock.calls.some(([command]) => command === 'browser_agent_execute')).toBe(false);
    expect(buildSessionSnapshot('s1', [session], t.messages).messages[0].actionCard?.id).toBe(t.cards()[0].id);
    await t.choose(true);
    expect(t.invoke).toHaveBeenCalledWith('browser_permission', { sessionId: 's1', allow: true, callId: 'first' }, undefined);
    await waitFor(() => expect(t.invoke.mock.calls.filter(([command]) => command === 'browser_agent_execute')).toHaveLength(2));
    expect(t.cards()[0].status).toBe('approved');
    expect(t.result.current.isWaiting('s1')).toBe(false);
    expect(t.result.current.hasBrowserGrant('s1')).toBe(true);
    expect(t.result.current.hasGrant('s1')).toBe(false);
  });

  it('reads backend authorization for each call and asks again when it was revoked', async () => {
    const t = setup();
    await t.call('first'); await t.choose(true);
    await waitFor(() => expect(t.result.current.hasBrowserGrant('s1')).toBe(true));
    await t.call('allowed');
    expect(t.cards()).toHaveLength(1);
    t.setBackendGrant(false);
    await t.deliver('browser-permission-changed', { sessionId: 's1', allow: false });
    await t.call('ask-again');
    expect(t.cards()).toHaveLength(2);
    expect(t.cards()[1].status).toBe('pending');
    expect(t.result.current.hasBrowserGrant('s1')).toBe(false);
    await t.choose(false);
    expect(t.invoke).toHaveBeenCalledWith('agent_tool_respond', { callId: 'ask-again', ok: false, text: 'The user declined.' }, undefined);
  });

  it('withdraws ended calls and never executes one after a grant arrives late', async () => {
    let finish: (() => void) | undefined;
    const t = setup(command => command === 'browser_permission' ? new Promise(resolve => { finish = () => resolve(null); }) : undefined);
    await t.call('slow');
    await t.choose(true);
    await t.deliver('agent-tool-call-ended', { callId: 'slow' });
    expect(t.cards()[0]).toMatchObject({ status: 'rejected', chosenOptionId: undefined });
    await act(async () => { finish?.(); });
    expect(t.invoke.mock.calls.some(([command]) => command === 'browser_agent_execute')).toBe(false);
    expect(t.result.current.isWaiting('s1')).toBe(false);
  });

  it('answers the guide without a grant and settles a backend-refused grant without execution', async () => {
    const t = setup(command => command === 'browser_permission' ? Promise.reject(new Error('failure')) : undefined);
    await t.call('guide', 'browser_guide', {});
    expect(t.cards()).toHaveLength(0);
    expect(t.invoke).toHaveBeenCalledWith('browser_catalog', {}, undefined);
    await t.call('need-grant'); await t.choose(true);
    expect(t.cards()[0].status).toBe('rejected');
    expect(t.invoke).toHaveBeenCalledWith('agent_tool_respond', { callId: 'need-grant', ok: false, text: 'Browser permission could not be changed.' }, undefined);
    expect(t.invoke.mock.calls.some(([command]) => command === 'browser_agent_execute')).toBe(false);
  });
});
