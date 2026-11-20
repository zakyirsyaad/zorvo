import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ComposerHandle } from '../components/ComposerDock';
import type { ReviewComments } from '../hooks/useReviewComments';
import { useReviewMessage } from '../hooks/useReviewMessage';
import { useReviewWiring } from '../hooks/useReviewWiring';
import { artifactHeading, canvasHeading } from '../lib/artifact-comments';
import type { Artifact, ArtifactComment, Session } from '../types';

const artifact: Artifact = {
  id: 'a-0123456789abcdef',
  title: 'Pricing report',
  sourcePath: '/w/api/reports/pricing.html',
  versions: [{ n: 3, at: 1, bytes: 1 }],
};

const pageComment = (id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment => ({
  id,
  artifactId: artifact.id,
  version: 3,
  anchor: { kind: 'text', quote: 'Annual', before: '', after: '' },
  body: 'Make it a badge.',
  createdAt: 1,
  ...overrides,
});

const session = (id: string): Session => ({ id, name: id, profileId: 'agent', cwd: '/w/api', status: 'running', createdAt: 1 }) as Session;

describe('one slot for diff and artifact comments', () => {
  function renderMessage() {
    const markSent = vi.fn();
    const markArtifactSent = vi.fn();
    const view = renderHook(() => useReviewMessage({ activeSessionId: 's-a', markSent, markArtifactSent, sessionIds: ['s-a', 's-b'] }));
    return { ...view, markSent, markArtifactSent };
  }

  it('a message with a diff comment and an artifact comment marks both Sent', () => {
    const { result, markSent, markArtifactSent } = renderMessage();
    act(() => result.current.add('s-a', ['c-1'], 'head'));
    act(() => result.current.addArtifact('s-a', ['ac-1'], 'a-1'));

    act(() => result.current.sendFrom('s-a', 'the text'));

    expect(markSent).toHaveBeenLastCalledWith('s-a', ['c-1']);
    expect(markArtifactSent).toHaveBeenLastCalledWith('s-a', ['ac-1']);
    expect(result.current.slot).toBeNull();
  });

  it('an artifact add after a diff add keeps the diff ids', () => {
    const { result } = renderMessage();
    act(() => result.current.add('s-a', ['c-1'], 'head'));

    act(() => result.current.addArtifact('s-a', ['ac-1'], 'a-1'));
    act(() => result.current.addArtifact('s-a', ['ac-1', 'ac-2'], 'a-1'));

    expect(result.current.slot).toEqual({
      sessionId: 's-a',
      commentIds: ['c-1'],
      artifactCommentIds: ['ac-1', 'ac-2'],
      lastTarget: null,
      lastArtifactId: 'a-1',
    });
    expect([...result.current.inMessageArtifact]).toEqual(['ac-1', 'ac-2']);
    expect([...result.current.inMessage]).toEqual(['c-1']);
  });

  it('an artifact add first leaves no diff target, so a later diff add writes its heading', () => {
    const { result } = renderMessage();
    act(() => result.current.addArtifact('s-a', ['ac-1'], 'a-1'));

    expect(result.current.slot).toEqual({ sessionId: 's-a', commentIds: [], artifactCommentIds: ['ac-1'], lastTarget: null, lastArtifactId: 'a-1' });
    expect(result.current.needsHeading('s-a', 'head', 'heading')).toBe(true);
  });

  it('a diff add clears the last artifact, so the next artifact add writes its heading', () => {
    const { result } = renderMessage();
    act(() => result.current.onComposerText('artifact heading'));
    act(() => result.current.addArtifact('s-a', ['ac-1'], 'a-1'));
    expect(result.current.needsArtifactHeading('s-a', 'a-1', 'artifact heading')).toBe(false);
    expect(result.current.needsArtifactHeading('s-a', 'a-2', 'artifact heading')).toBe(true);

    act(() => result.current.add('s-a', ['c-1'], 'head'));

    expect(result.current.slot).toEqual({ sessionId: 's-a', commentIds: ['c-1'], artifactCommentIds: ['ac-1'], lastTarget: 'head' });
    expect(result.current.needsArtifactHeading('s-a', 'a-1', 'artifact heading')).toBe(true);
  });

  it('forget takes an artifact id out and keeps the slot', () => {
    const { result } = renderMessage();
    act(() => result.current.addArtifact('s-a', ['ac-1', 'ac-2'], 'a-1'));

    act(() => result.current.forget(['ac-1']));

    expect(result.current.slot).toEqual({ sessionId: 's-a', commentIds: [], artifactCommentIds: ['ac-2'], lastTarget: null, lastArtifactId: 'a-1' });
  });

  it('restore of the sent text re-arms with both lists empty', () => {
    const { result, markArtifactSent } = renderMessage();
    act(() => result.current.addArtifact('s-a', ['ac-1'], 'a-1'));
    act(() => result.current.sendFrom('s-a', 'the text'));

    act(() => result.current.onComposerRestored('the text'));

    expect(result.current.slot).toEqual({ sessionId: 's-a', commentIds: [], lastTarget: null });
    act(() => result.current.sendFrom('s-a', 'the text'));
    expect(markArtifactSent).toHaveBeenCalledTimes(1);
  });

  it("giveBack keeps an existing slot's artifact ids", () => {
    const { result } = renderMessage();
    act(() => result.current.addArtifact('s-a', ['ac-1'], 'a-1'));
    act(() => result.current.sendFrom('s-a', 'the text'));
    act(() => result.current.addArtifact('s-a', ['ac-2'], 'a-1'));

    act(() => result.current.onComposerGivenBack('s-a', 'the text'));

    expect(result.current.slot).toEqual({ sessionId: 's-a', commentIds: [], artifactCommentIds: ['ac-2'], lastTarget: null, lastArtifactId: 'a-1' });
  });
});

describe('adding artifact comments to the message', () => {
  function renderWiring(options: { active?: string } = {}) {
    let text = '';
    const order: string[] = [];
    const updateArtifactComments = vi.fn();
    const collapseArtifact = vi.fn(() => order.push('collapse'));
    const composerRef = createRef<ComposerHandle>() as { current: ComposerHandle | null };
    const view = renderHook(
      ({ active }) =>
        useReviewWiring({
          session: session(active),
          sessions: [session('s-a'), session('s-b')],
          comments: { comments: [] } as unknown as ReviewComments,
          updateComments: () => {},
          updateArtifactComments,
          composerRef,
          canContinue: true,
          hasComposer: true,
          isComposerDisabled: false,
          collapseDiff: () => {},
          collapseArtifact,
          agentNameOf: (profileId) => profileId,
        }),
      { initialProps: { active: options.active ?? 's-a' } },
    );
    composerRef.current = {
      insertText: (inserted: string) => {
        order.push('insert');
        text = text === '' ? inserted : `${text}\n\n${inserted}`;
        view.result.current.onComposerText(text);
      },
    } as unknown as ComposerHandle;
    return { ...view, updateArtifactComments, collapseArtifact, order, text: () => text };
  }

  const checked = (comment: ArtifactComment, number = 1) => ({ comment, number, status: 'current' as const });

  it('add from an expanded artifact collapses it before inserting', () => {
    const { result, order, updateArtifactComments } = renderWiring();

    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));

    expect(order).toEqual(['collapse', 'insert']);
    expect(updateArtifactComments).toHaveBeenCalledWith('s-a', expect.any(Function));
    expect([...result.current.addArtifactReview.inMessage]).toEqual(['ac-1']);
  });

  it('marks added comments unsent again', () => {
    const { result, updateArtifactComments } = renderWiring();

    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1', { sentAt: 5 }))], artifact, '/w/api'));

    const change = updateArtifactComments.mock.calls[0][1] as (prev: ArtifactComment[]) => ArtifactComment[];
    expect(change([pageComment('ac-1', { sentAt: 5 }), pageComment('ac-2', { sentAt: 6 })])).toEqual([
      pageComment('ac-1'),
      pageComment('ac-2', { sentAt: 6 }),
    ]);
  });

  it('the artifact heading is written once while the composer holds it', () => {
    const { result, text } = renderWiring();
    const heading = artifactHeading(artifact, '/w/api');

    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-2'), 2)], artifact, '/w/api'));

    expect(text().split(heading)).toHaveLength(2);
    expect(text()).toContain('2. On the text:');
  });

  it('canvas comments get one heading per artboard, written once while the composer holds it', () => {
    const { result, text } = renderWiring();
    const key = 'c-0123456789abcdef';
    const entry = { key, folder: '/w/api/design/checkout', relative: 'design/checkout', title: 'Checkout', shownAt: 1, artboards: 2 };
    const board = (id: string, title: string) => ({ id, title, file: `${id}.html`, width: 1440, height: 900, group: null });
    const canvas = { title: 'Checkout', sections: [{ id: 'pay', title: 'Payment', artboards: [board('pay-a', 'Payment A'), board('pay-b', 'Payment B')] }] };
    const onBoard = (id: string, artboardId: string) =>
      pageComment(id, { artifactId: key, version: 0, canvas: { key, artboardId, fileHash: 'b'.repeat(64) } });
    const headingB = canvasHeading(entry, canvas, canvas.sections[0].artboards[1], '/w/api');

    act(() => result.current.addArtifactReview.addCanvas([checked(onBoard('ac-1', 'pay-b'))], entry, canvas, '/w/api'));
    act(() => result.current.addArtifactReview.addCanvas([checked(onBoard('ac-2', 'pay-b'), 2)], entry, canvas, '/w/api'));

    expect(text().split(headingB)).toHaveLength(2);
    expect(text()).toContain('2. On the text:');
    expect([...result.current.addArtifactReview.inMessage]).toEqual(['ac-1', 'ac-2']);
  });

  it("add while the slot is another session's does nothing and blockedReason says so", () => {
    const { result, rerender, updateArtifactComments, text } = renderWiring();
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));
    updateArtifactComments.mockClear();
    rerender({ active: 's-b' });

    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-2'))], artifact, '/w/api'));

    expect(result.current.addArtifactReview.blockedReason).toBe(
      'The message holds comments for another session. Go back to it, or clear the message.',
    );
    expect(updateArtifactComments).not.toHaveBeenCalled();
    expect(text()).not.toContain('ac-2');
    expect(result.current.addArtifactReview.inMessage.size).toBe(0);
  });

  it('artifact A, then artifact B, then A again writes each heading where its block starts', () => {
    const { result, text } = renderWiring();
    const other: Artifact = { ...artifact, id: 'a-fedcba9876543210', title: 'Other page' };

    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-2', { artifactId: other.id }))], other, '/w/api'));
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-3'), 2)], artifact, '/w/api'));

    expect(text().split(artifactHeading(artifact, '/w/api'))).toHaveLength(3);
    expect(text().trimEnd().endsWith('Make it a badge.')).toBe(true);
  });

  it('a diff add between two artifact adds puts the second under its own heading again', () => {
    const { result, text } = renderWiring();
    const diffComment = {
      id: 'c-1', file: 'src/a.ts', side: 'new' as const, line: 3, lineHash: 'deadbeef', quote: 'x', target: 'head' as const,
      body: 'Fix', createdAt: 1,
    };

    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));
    act(() => result.current.addReview.add([{ comment: diffComment, status: 'current' }], 'head', { root: '/w/api', prefix: '', baseName: null }));
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-2'), 2)], artifact, '/w/api'));
    act(() => result.current.addReview.add([{ comment: { ...diffComment, id: 'c-2' }, status: 'current' }], 'head', { root: '/w/api', prefix: '', baseName: null }));

    expect(text().split(artifactHeading(artifact, '/w/api'))).toHaveLength(3);
    expect(text().split('Review comments on the diff against the last commit.')).toHaveLength(3);
  });

  it('Send marks the artifact comments Sent through updateArtifactComments', () => {
    const { result, updateArtifactComments } = renderWiring();
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));
    updateArtifactComments.mockClear();

    act(() => result.current.sendFrom('s-a', 'anything'));

    const change = updateArtifactComments.mock.calls[0][1] as (prev: ArtifactComment[]) => ArtifactComment[];
    const [marked] = change([pageComment('ac-1')]);
    expect(typeof marked.sentAt).toBe('number');
  });

  it('forget takes an artifact comment out of the message', () => {
    const { result } = renderWiring();
    act(() => result.current.addArtifactReview.add([checked(pageComment('ac-1'))], artifact, '/w/api'));

    act(() => result.current.forget(['ac-1']));

    expect(result.current.addArtifactReview.inMessage.size).toBe(0);
  });
});
