import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, buttonsOf, messageOf, offeredActions, parseNextStep, type NextStepFacts } from '../lib/next-step';

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
    expect(offeredActions({ changes: { files: 2, added: 42, removed: 11 } })).toEqual(['commit', 'create_pr']);
  });

  it('offers only Create PR for commits not pushed and no PR', () => {
    expect(offeredActions({ ahead: 2, hasUpstream: true })).toEqual(['create_pr']);
    expect(offeredActions({ ahead: 1, hasUpstream: false })).toEqual(['create_pr']);
  });

  it('offers Merge for an open PR whose checks passed and that GitHub calls CLEAN', () => {
    const offered = offeredActions({ pr: pr() });
    expect(offered).toContain('merge');
    expect(offered).not.toContain('auto_merge');
    expect(offered).toContain('open_pr');
  });

  it('offers auto-merge, not Merge, while checks still run', () => {
    const offered = offeredActions({ pr: pr({ checks: { passing: 4, failing: 0, pending: 5 }, mergeState: 'BLOCKED' }) });
    expect(offered).toContain('auto_merge');
    expect(offered).not.toContain('merge');
  });

  it('offers neither for a blocked PR or a failing check', () => {
    for (const facts of [{ pr: pr({ mergeState: 'BLOCKED' }) }, { pr: pr({ checks: { passing: 8, failing: 1, pending: 0 } }) }, { pr: pr({ mergeState: 'DIRTY' }) }]) {
      const offered = offeredActions(facts);
      expect(offered).not.toContain('merge');
      expect(offered).not.toContain('auto_merge');
    }
  });

  it('does not offer Create PR when the branch already has an open PR', () => {
    expect(offeredActions({ changes: { files: 1, added: 1, removed: 0 }, pr: pr() })).not.toContain('create_pr');
  });

  it('offers nothing for a merged PR', () => {
    expect(offeredActions({ pr: pr({ state: 'merged' }) })).toEqual([]);
  });

  it('offers Open in Zorvo\'s browser for a dev server', () => {
    expect(offeredActions({ preview: { port: 5173, command: 'pnpm dev' } })).toEqual(['open_preview']);
  });

  it('keeps the table order', () => {
    const facts: NextStepFacts = { changes: { files: 1, added: 1, removed: 0 }, preview: { port: 5173, command: 'pnpm dev' } };
    expect(offeredActions(facts)).toEqual(['commit', 'create_pr', 'open_preview']);
  });
});

describe('buttonsOf', () => {
  const facts: NextStepFacts = { changes: { files: 2, added: 42, removed: 11 } };

  it('puts an offered pick first and marks it', () => {
    const buttons = buttonsOf({ recap: 'Done.', pick: 'create_pr', replies: ['Not yet'] }, facts);
    expect(buttons.map((b) => b.label)).toEqual(['Create PR', 'Commit', 'Not yet']);
    expect(buttons[0]).toMatchObject({ kind: 'action', action: 'create_pr', isPick: true });
    expect(buttons[1]).toMatchObject({ kind: 'action', isPick: false });
    expect(buttons[2]).toEqual({ kind: 'reply', label: 'Not yet', message: 'Not yet' });
  });

  it('drops a pick that is not offered', () => {
    const buttons = buttonsOf({ recap: 'Done.', pick: 'merge' }, facts);
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
    });
    expect(buttons).toHaveLength(5);
    expect(buttons[0]).toMatchObject({ action: 'open_preview', isPick: true });
    expect(buttons.slice(-2).map((b) => b.label)).toEqual(['Not yet', 'Explain more']);
  });

  it('works with no step at all', () => {
    expect(buttonsOf(undefined, facts).map((b) => b.label)).toEqual(['Commit', 'Create PR']);
  });

  it('gives each action its message', () => {
    const [commit] = buttonsOf(undefined, facts);
    expect(commit).toMatchObject({ kind: 'action', message: 'Commit these changes.' });
  });
});

describe('messageOf', () => {
  it('has the exact sentences and none for the two that only open a page', () => {
    expect(messageOf('commit')).toBe('Commit these changes.');
    expect(messageOf('create_pr')).toBe('Commit, push and open a pull request.');
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
