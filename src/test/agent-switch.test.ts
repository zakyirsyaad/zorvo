import { describe, expect, it } from 'vitest';
import {
  continuedFromView,
  continuedLine,
  switchHiddenFor,
  switchNote,
  switchTargets,
  switchWaitsNote,
} from '../lib/agent-switch';
import type { SignInState } from '../lib/agent-sign-in';
import type { AgentProfile, Session } from '../types';

const agent = (id: string, name: string, availability: AgentProfile['availability'] = 'ready'): AgentProfile => ({
  id,
  name,
  command: id,
  detected: availability === 'ready',
  acp_args: [],
  source: 'registry',
  version: '1.0.0',
  distribution: 'npx',
  availability,
  install_plan: null,
  description: null,
  installed_on_system: availability === 'ready',
  listed: true,
});

const codex = agent('codex-acp', 'Codex');
const qwen = agent('qwen-code', 'Qwen Code');
const claude = agent('claude-acp', 'Claude Code');

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's-1',
  name: 'Fix login bug',
  profileId: 'qwen-code',
  cwd: '/w',
  status: 'running',
  createdAt: 1,
  ...overrides,
});

const allReady = (): SignInState => 'ready';

describe('switchTargets', () => {
  it('lists the source first, then the other agents in use in their order', () => {
    const rows = switchTargets([codex, qwen, claude], 'qwen-code', allReady, false);

    expect(rows.map((row) => row.id)).toEqual(['qwen-code', 'codex-acp', 'claude-acp']);
    expect(rows[0]).toMatchObject({ isSource: true, word: 'This session', isDisabled: false });
    expect(rows[1]).toMatchObject({ isSource: false, name: 'Codex' });
  });

  it('a private source reads Private', () => {
    const rows = switchTargets([qwen, claude], 'qwen-code', allReady, true);

    expect(rows[0].word).toBe('Private');
  });

  it('status words come from the sign-in state', () => {
    const states: Record<string, SignInState> = { 'codex-acp': 'ready', 'claude-acp': 'needed', 'gemini': 'unchecked' };
    const gemini = agent('gemini', 'Antigravity');
    const rows = switchTargets([qwen, codex, claude, gemini], 'qwen-code', (id) => states[id] ?? 'ready', false);

    expect(rows.slice(1).map((row) => row.word)).toEqual(['Ready', 'Needs sign-in', 'Not checked yet']);
    expect(rows.slice(1).map((row) => row.status)).toEqual(['ready', 'needed', 'unchecked']);
    expect(rows[2].isDisabled).toBe(false);
  });

  it('an agent that cannot run is listed disabled as Not installed', () => {
    const kimi = agent('kimi', 'Kimi CLI', 'not_installed');
    const rows = switchTargets([qwen, kimi], 'qwen-code', allReady, false);

    expect(rows[1]).toMatchObject({ status: 'not-installed', word: 'Not installed', isDisabled: true });
  });
});

describe('switchHiddenFor', () => {
  it('hides the switch for a session with no messages', () => {
    expect(switchHiddenFor(session(), 0, false)).toBe(true);
  });

  it('hides it for a compare-run session', () => {
    expect(switchHiddenFor(session({ compareRunId: 'run-1' }), 3, false)).toBe(true);
  });

  it('hides it for a worker whose delegation link is open', () => {
    const link = { sessionId: 's-0', task: 'do it', startedAt: 1 };
    expect(switchHiddenFor(session({ delegatedFrom: link }), 3, false)).toBe(true);
    expect(switchHiddenFor(session({ delegatedFrom: { ...link, endedAt: 2 } }), 3, false)).toBe(false);
  });

  it('hides it in a popout', () => {
    expect(switchHiddenFor(session(), 3, true)).toBe(true);
  });

  it('offers it for a plain running or ended session with messages', () => {
    expect(switchHiddenFor(session(), 2, false)).toBe(false);
    expect(switchHiddenFor(session({ status: 'terminated' }), 2, false)).toBe(false);
  });
});

describe('switch copy', () => {
  it('words the note above the composer', () => {
    expect(switchNote('Claude Code', 'Qwen Code')).toBe(
      "Your message starts a new Claude Code session that continues this one. Qwen Code's session stays as it is.",
    );
  });

  it('words the busy note', () => {
    expect(switchWaitsNote('Qwen Code')).toBe('Qwen Code is still working. Wait for it to finish, or press Stop.');
  });

  it('words the continued line', () => {
    expect(continuedLine('Claude Code', 'Fix login bug')).toBe('Continued with Claude Code from Fix login bug');
  });
});

describe('continuedFromView', () => {
  const sessions = [session({ id: 'a', name: 'Plan' })];
  const agents = [qwen, claude, codex];

  it('names the agent the mark says took over, not the session on screen', () => {
    const view = continuedFromView({ sessionId: 'a', agentId: 'claude-acp', toAgentId: 'codex-acp' }, sessions, agents, 'Qwen Code');
    expect(view.agentName).toBe('Codex');
    expect(view.sourceName).toBe('Plan');
  });

  it('falls back to the session on screen for a mark without toAgentId, and reads a gone source as null', () => {
    const view = continuedFromView({ sessionId: 'gone', agentId: 'claude-acp' }, sessions, agents, 'Qwen Code');
    expect(view.agentName).toBe('Qwen Code');
    expect(view.sourceName).toBeNull();
  });
});
