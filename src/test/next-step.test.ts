import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, buttonsOf, messageOf, offeredActions, parseNextStep, turnChangedFiles, type NextStepFacts } from '../lib/next-step';
import type { ChatMessage, ToolExecution } from '../types';

/** A turn that changed files: Zorvo may offer every action the facts allow. */
const CHANGED = { turnChanged: true };

const green = { passing: 9, failing: 0, pending: 0 };
const pr = (over: Partial<NonNullable<NextStepFacts['pr']>> = {}): NonNullable<NextStepFacts['pr']> => ({
  number: 325,
  url: 'https://github.com/o/r/pull/325',
  state: 'open',
  checks: green,
  mergeState: 'CLEAN',
  ...over,
});

describe('offeredActions', () => {
  it('offers Commit and Create PR for uncommitted changes', () => {
    expect(offeredActions({ changes: { files: 2, added: 42, removed: 11 } }, CHANGED)).toEqual(['commit', 'create_pr']);
  });

  it('offers only Create PR for commits not pushed and no PR', () => {
    expect(offeredActions({ ahead: 2, hasUpstream: true }, CHANGED)).toEqual(['create_pr']);
    expect(offeredActions({ ahead: 1, hasUpstream: false }, CHANGED)).toEqual(['create_pr']);
  });

  it('offers Merge for an open PR whose checks passed and that GitHub calls CLEAN', () => {
    const offered = offeredActions({ pr: pr() }, CHANGED);
    expect(offered).toContain('merge');
    expect(offered).not.toContain('auto_merge');
    expect(offered).toContain('open_pr');
  });

  it('offers auto-merge, not Merge, while checks still run', () => {
    const offered = offeredActions({ pr: pr({ checks: { passing: 4, failing: 0, pending: 5 }, mergeState: 'BLOCKED' }) }, CHANGED);
    expect(offered).toContain('auto_merge');
    expect(offered).not.toContain('merge');
  });

  it('offers neither for a blocked PR or a failing check', () => {
    for (const facts of [{ pr: pr({ mergeState: 'BLOCKED' }) }, { pr: pr({ checks: { passing: 8, failing: 1, pending: 0 } }) }, { pr: pr({ mergeState: 'DIRTY' }) }]) {
      const offered = offeredActions(facts, CHANGED);
      expect(offered).not.toContain('merge');
      expect(offered).not.toContain('auto_merge');
    }
  });

  it('does not offer Create PR when the branch already has an open PR', () => {
    expect(offeredActions({ changes: { files: 1, added: 1, removed: 0 }, pr: pr() }, CHANGED)).not.toContain('create_pr');
  });

  it('offers nothing for a merged PR', () => {
    expect(offeredActions({ pr: pr({ state: 'merged' }) }, CHANGED)).toEqual([]);
  });

  it('offers Open in Zorvo\'s browser for a dev server', () => {
    expect(offeredActions({ preview: { port: 5173, command: 'pnpm dev' } }, CHANGED)).toEqual(['open_preview']);
  });

  it('keeps the table order', () => {
    const facts: NextStepFacts = { changes: { files: 1, added: 1, removed: 0 }, preview: { port: 5173, command: 'pnpm dev' } };
    expect(offeredActions(facts, CHANGED)).toEqual(['commit', 'create_pr', 'open_preview']);
  });

  it('offers no action that sends a message after a turn that changed no file', () => {
    const facts: NextStepFacts = { changes: { files: 57, added: 5934, removed: 0 }, ahead: 2, pr: pr() };
    expect(offeredActions(facts, { turnChanged: false })).toEqual(['open_pr']);
    expect(offeredActions({ pr: pr({ checks: { passing: 4, failing: 0, pending: 5 }, mergeState: 'BLOCKED' }) }, { turnChanged: false })).toEqual(['open_pr']);
  });

  it("still offers the agent's pick after such a turn, when the facts allow it", () => {
    const facts: NextStepFacts = { changes: { files: 3, added: 10, removed: 2 } };
    expect(offeredActions(facts, { turnChanged: false, pick: 'commit' })).toEqual(['commit']);
    expect(offeredActions({}, { turnChanged: false, pick: 'commit' })).toEqual([]);
  });

  it('keeps the two that only open a page whatever the turn did', () => {
    expect(offeredActions({ preview: { port: 5173, command: 'pnpm dev' } }, { turnChanged: false })).toEqual(['open_preview']);
  });
});

describe('buttonsOf', () => {
  const facts: NextStepFacts = { changes: { files: 2, added: 42, removed: 11 } };

  it('puts an offered pick first and marks it', () => {
    const buttons = buttonsOf({ recap: 'Done.', pick: 'create_pr', replies: ['Not yet'] }, facts, CHANGED);
    expect(buttons.map((b) => b.label)).toEqual(['Create PR', 'Commit', 'Not yet']);
    expect(buttons[0]).toMatchObject({ kind: 'action', action: 'create_pr', isPick: true });
    expect(buttons[1]).toMatchObject({ kind: 'action', isPick: false });
    expect(buttons[2]).toEqual({ kind: 'reply', label: 'Not yet', message: 'Not yet' });
  });

  it('drops a pick that is not offered', () => {
    const buttons = buttonsOf({ recap: 'Done.', pick: 'merge' }, facts, CHANGED);
    expect(buttons.map((b) => b.label)).toEqual(['Commit', 'Create PR']);
    expect(buttons.every((b) => b.kind !== 'action' || !b.isPick)).toBe(true);
  });

  it('caps at five, cutting Zorvo\'s buttons before the pick or the replies', () => {
    const many: NextStepFacts = {
      changes: { files: 1, added: 1, removed: 0 },
      pr: undefined,
      preview: { port: 3000, command: 'pnpm dev' },
    };
    const buttons = buttonsOf({ recap: 'Done.', pick: 'open_preview', replies: ['Not yet', 'Explain more'] }, {
      ...many,
      ahead: 1,
    }, CHANGED);
    expect(buttons).toHaveLength(5);
    expect(buttons[0]).toMatchObject({ action: 'open_preview', isPick: true });
    expect(buttons.slice(-2).map((b) => b.label)).toEqual(['Not yet', 'Explain more']);
  });

  it('works with no step at all', () => {
    expect(buttonsOf(undefined, facts, CHANGED).map((b) => b.label)).toEqual(['Commit', 'Create PR']);
  });

  it('gives each action its message', () => {
    const [commit] = buttonsOf(undefined, facts, CHANGED);
    expect(commit).toMatchObject({ kind: 'action', message: 'Commit the changes you made.' });
  });
});

describe('buttonsOf after a turn that changed no file', () => {
  it("shows the agent's pick alone among the actions that send a message", () => {
    const facts: NextStepFacts = { changes: { files: 57, added: 5934, removed: 0 } };
    expect(buttonsOf({ recap: 'Done.', pick: 'create_pr' }, facts, { turnChanged: false }).map((b) => b.label)).toEqual(['Create PR']);
    expect(buttonsOf(undefined, facts, { turnChanged: false })).toEqual([]);
  });
});

describe('turnChangedFiles', () => {
  const tool = (over: Partial<ToolExecution>): ToolExecution => ({ id: 't', name: 'Edit', status: 'completed', ...over });
  const user = (id: string): ChatMessage => ({ id, role: 'user', content: 'Go', timestamp: 1 });
  const reply = (id: string, tools: ToolExecution[]): ChatMessage => ({ id, role: 'agent', content: 'Done.', timestamp: 2, tools });

  it('is true when a reply of the last turn completed a tool that changed a file', () => {
    expect(turnChangedFiles([user('u'), reply('a', [tool({ kind: 'edit' })])])).toBe(true);
    expect(turnChangedFiles([user('u'), reply('a', [tool({ kind: 'other', details: [{ kind: 'changed', path: 'a.ts' }] })])])).toBe(true);
    expect(turnChangedFiles([user('u'), reply('a', []), reply('b', [tool({ kind: 'delete' })])])).toBe(true);
  });

  it('is false for a turn that only read, searched or ran commands', () => {
    expect(turnChangedFiles([user('u'), reply('a', [tool({ kind: 'read' }), tool({ kind: 'execute', command: 'gh pr view 269' })])])).toBe(false);
    expect(turnChangedFiles([user('u'), reply('a', [])])).toBe(false);
  });

  it('counts only tools that completed', () => {
    expect(turnChangedFiles([user('u'), reply('a', [tool({ kind: 'edit', status: 'failed' }), tool({ kind: 'edit', status: 'running' })])])).toBe(false);
  });

  it('looks only after the last message of the user', () => {
    expect(turnChangedFiles([user('u1'), reply('a', [tool({ kind: 'edit' })]), user('u2'), reply('b', [tool({ kind: 'read' })])])).toBe(false);
  });
});

describe('messageOf', () => {
  it('has the exact sentences and none for the two that only open a page', () => {
    expect(messageOf('commit')).toBe('Commit the changes you made.');
    expect(messageOf('create_pr')).toBe('Commit the changes you made, push them and open a pull request.');
    expect(messageOf('merge')).toBe('Merge the pull request.');
    expect(messageOf('auto_merge')).toBe('Turn on auto-merge for the pull request.');
    expect(messageOf('open_pr')).toBeUndefined();
    expect(messageOf('open_preview')).toBeUndefined();
  });

  it('labels every action', () => {
    expect(ACTION_LABELS).toEqual({
      commit: 'Commit',
      create_pr: 'Create PR',
      merge: 'Merge',
      auto_merge: 'Turn on auto-merge',
      open_preview: "Open in Zorvo's browser",
      open_pr: 'Open PR',
    });
  });
});

describe('parseNextStep', () => {
  it('keeps a well-formed step', () => {
    const step = { recap: 'Done.', ask: 'Merge?', pick: 'merge', replies: ['Not yet'], answered: { label: 'Merge', at: 1 } };
    expect(parseNextStep(step)).toEqual(step);
  });

  it('keeps an answer alone, from a box that was only Zorvo\'s', () => {
    expect(parseNextStep({ answered: { label: 'Create PR', at: 1 } })).toEqual({ answered: { label: 'Create PR', at: 1 } });
  });

  it('drops fields over their limits or of the wrong kind', () => {
    expect(parseNextStep({ recap: 'r'.repeat(301), ask: 'Ok?' })).toEqual({ ask: 'Ok?' });
    expect(parseNextStep({ recap: 'Done.', replies: ['a', 'b', 'c'] })).toEqual({ recap: 'Done.' });
    expect(parseNextStep({ recap: 'Done.', pick: 'deploy' })).toEqual({ recap: 'Done.' });
    expect(parseNextStep({ recap: 'Done.', answered: { label: 3, at: 'x' } })).toEqual({ recap: 'Done.' });
  });

  it('returns null when nothing is left', () => {
    expect(parseNextStep({})).toBeNull();
    expect(parseNextStep(null)).toBeNull();
    expect(parseNextStep('wrap_up')).toBeNull();
  });
});
