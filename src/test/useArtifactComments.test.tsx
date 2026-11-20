import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener[]>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return Promise.resolve(() => {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
    });
  },
  emit: () => Promise.resolve(),
}));

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { useArtifactComments, useArtifactCommentSweep } from '../hooks/useArtifactComments';
import type { Artifact, ArtifactComment, PageRef, Session } from '../types';

const A1 = 'a-0123456789abcdef';
const A2 = 'a-fedcba9876543210';
const PAGE: PageRef = { sessionId: 's-1', artifactId: A1, version: 3 };

const pageComment = (id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment => ({
  id,
  artifactId: A1,
  version: 3,
  anchor: { kind: 'text', quote: 'Annual', before: '', after: '' },
  body: 'Fix it.',
  createdAt: 1,
  ...overrides,
});

interface Props {
  shownPage: PageRef | null;
  shownCanvas?: { sessionId: string; key: string } | null;
  initial?: ArtifactComment[];
}

function renderComments(props: Props) {
  const forget = vi.fn();
  const onError = vi.fn();
  const view = renderHook(
    ({ shownPage, shownCanvas = null }: Props) => {
      const [comments, setComments] = useState<ArtifactComment[]>(props.initial ?? []);
      const state = useArtifactComments({
        sessionId: 's-1',
        comments,
        update: (_sessionId, change) => setComments(change),
        shownPage,
        shownCanvas,
        forget,
        onError,
      });
      return { state, comments };
    },
    { initialProps: props },
  );
  return { ...view, forget, onError };
}

function deliver(payload: unknown) {
  act(() => (listeners.get('artifact-page-pick') ?? []).forEach((cb) => cb({ payload })));
}

const textPick = (quote = 'Annual', page: PageRef = PAGE) => ({ ...page, message: { kind: 'pick-text', quote, before: '', after: '' } });

afterEach(() => {
  invoke.mockClear();
  listeners.clear();
});

describe('useArtifactComments', () => {
  it('a pick for the shown page makes a candidate', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));

    deliver(textPick());

    expect(result.current.state.candidate).toEqual({
      page: PAGE,
      anchor: { kind: 'text', quote: 'Annual', before: '', after: '' },
      isPickHeld: false,
    });
  });

  it('a pick while comment mode is off is dropped', () => {
    const { result } = renderComments({ shownPage: PAGE });

    deliver(textPick());

    expect(result.current.state.candidate).toBeNull();
  });

  it('a pick for another page or version is dropped', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));

    deliver(textPick('a', { ...PAGE, version: 2 }));
    deliver(textPick('a', { ...PAGE, artifactId: A2 }));
    deliver(textPick('a', { ...PAGE, sessionId: 's-2' }));

    expect(result.current.state.candidate).toBeNull();
  });

  it('a pick with a 1001-character quote is dropped', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));

    deliver(textPick('x'.repeat(1001)));

    expect(result.current.state.candidate).toBeNull();
  });

  it('a pick while text is typed keeps the text and holds the pick', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick('first'));
    act(() => result.current.state.setCandidateBody('Half written'));

    deliver(textPick('second'));

    expect(result.current.state.candidate?.anchor).toMatchObject({ quote: 'first' });
    expect(result.current.state.candidate?.isPickHeld).toBe(true);
    expect(result.current.state.candidateBody()).toBe('Half written');
  });

  it('a keystroke between a pick and its render keeps the text and holds the pick', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick('first'));

    act(() => {
      (listeners.get('artifact-page-pick') ?? []).forEach((cb) => cb({ payload: textPick('second') }));
      result.current.state.setCandidateBody('T');
    });

    expect(result.current.state.candidate?.anchor).toMatchObject({ quote: 'first' });
    expect(result.current.state.candidate?.isPickHeld).toBe(true);
    expect(result.current.state.candidateBody()).toBe('T');
  });

  it('a held candidate is not replaced by another object for each further pick', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick('first'));
    act(() => result.current.state.setCandidateBody('Typed'));
    deliver(textPick('second'));
    const held = result.current.state.candidate;

    deliver(textPick('third'));

    expect(result.current.state.candidate).toBe(held);
  });

  it('a pick replaces a candidate with a blank body', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick('first'));
    act(() => result.current.state.setCandidateBody('   '));

    deliver(textPick('second'));

    expect(result.current.state.candidate?.anchor).toMatchObject({ quote: 'second' });
  });

  it('cancel drops a blank candidate and keeps a written one', () => {
    const { result } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick());

    deliver({ ...PAGE, message: { kind: 'cancel' } });
    expect(result.current.state.candidate).toBeNull();

    deliver(textPick());
    act(() => result.current.state.setCandidateBody('Keep'));
    deliver({ ...PAGE, message: { kind: 'cancel' } });
    expect(result.current.state.candidate).not.toBeNull();
  });

  it('a new version while typing keeps the text and saves on the picked version, reading outdated', () => {
    const { result, rerender } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick());
    act(() => result.current.state.setCandidateBody('Badge'));

    rerender({ shownPage: { ...PAGE, version: 4 } });
    expect(result.current.state.candidateBody()).toBe('Badge');
    let saved = '';
    act(() => {
      saved = result.current.state.saveCandidate();
    });

    expect(saved).toBe('saved');
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0]).toMatchObject({ artifactId: A1, version: 3, body: 'Badge' });
    expect(result.current.state.candidate).toBeNull();
  });

  it('turning on invokes artifact_comment_mode with the page ids and on', async () => {
    const { result } = renderComments({ shownPage: PAGE });

    act(() => result.current.state.setCommenting(true));

    expect(result.current.state.isCommenting).toBe(true);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('artifact_comment_mode', { sessionId: 's-1', artifactId: A1, version: 3, on: true }),
    );
  });

  it('another shown page turns comment mode off', () => {
    const { result, rerender } = renderComments({ shownPage: PAGE });
    act(() => result.current.state.setCommenting(true));

    rerender({ shownPage: { ...PAGE, artifactId: A2 } });
    expect(result.current.state.isCommenting).toBe(false);

    rerender({ shownPage: PAGE });
    expect(result.current.state.isCommenting).toBe(false);
  });

  it('marks go out once per change, with numbers over every version', async () => {
    const initial = [pageComment('old', { version: 2, createdAt: 1 }), pageComment('new', { createdAt: 2 })];
    const { result, rerender } = renderComments({ shownPage: PAGE, initial });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('artifact_view_marks', {
        sessionId: 's-1',
        artifactId: A1,
        version: 3,
        marks: [{ n: 2, anchor: initial[1].anchor }],
      }),
    );
    const calls = () => invoke.mock.calls.filter(([cmd]) => cmd === 'artifact_view_marks').length;
    rerender({ shownPage: { ...PAGE } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls()).toBe(1);

    act(() => result.current.state.setCommenting(true));
    deliver(textPick('More'));
    act(() => result.current.state.setCandidateBody('Another'));
    act(() => void result.current.state.saveCandidate());

    await waitFor(() => expect(calls()).toBe(2));
  });

  it('marks-missing marks those numbers, until the marks change', async () => {
    const { result } = renderComments({ shownPage: PAGE, initial: [pageComment('c1')] });

    deliver({ ...PAGE, message: { kind: 'marks-missing', numbers: [1] } });
    expect([...result.current.state.missing]).toEqual([1]);

    act(() => result.current.state.deleteComment('c1'));
    expect(result.current.state.missing.size).toBe(0);
  });

  it('save refuses at 200 and a blank body', () => {
    const full = Array.from({ length: 200 }, (_, i) => pageComment(`c${i}`));
    const { result } = renderComments({ shownPage: PAGE, initial: full });
    act(() => result.current.state.setCommenting(true));
    deliver(textPick());

    let outcome = '';
    act(() => {
      outcome = result.current.state.saveCandidate();
    });
    expect(outcome).toBe('empty');

    act(() => result.current.state.setCandidateBody('Text'));
    act(() => {
      outcome = result.current.state.saveCandidate();
    });
    expect(outcome).toBe('full');
    expect(result.current.comments).toHaveLength(200);
  });

  it('edit clears sentAt and forgets the id', () => {
    const { result, forget } = renderComments({ shownPage: PAGE, initial: [pageComment('c1', { sentAt: 5 })] });

    act(() => result.current.state.editComment('c1', 'New text'));

    expect(forget).toHaveBeenCalledWith(['c1']);
    expect(result.current.comments[0]).toEqual(pageComment('c1', { body: 'New text' }));
  });

  it('delete forgets the id, and clear sent removes only that artifact\'s sent comments', () => {
    const initial = [
      pageComment('c1'),
      pageComment('c2', { sentAt: 5 }),
      pageComment('c3', { sentAt: 5, artifactId: A2 }),
    ];
    const { result, forget } = renderComments({ shownPage: PAGE, initial });

    act(() => result.current.state.deleteComment('c1'));
    expect(forget).toHaveBeenCalledWith(['c1']);

    act(() => result.current.state.clearSent(A1));
    expect(result.current.comments.map((c) => c.id)).toEqual(['c3']);
  });
});

describe('useArtifactCommentSweep', () => {
  const artifact = (id: string): Artifact => ({ id, title: 'T', sourcePath: '/w/t.html', versions: [{ n: 3, at: 1, bytes: 1 }] });
  const session = (id: string, artifactComments: ArtifactComment[]): Session =>
    ({ id, name: id, profileId: 'x', cwd: '/w', status: 'idle', createdAt: 1, artifactComments }) as Session;

  it("removes a deleted artifact's comments and forgets their ids, and skips a session not in readSessions", () => {
    const update = vi.fn();
    const forget = vi.fn();
    const sessions = [session('s-1', [pageComment('c1'), pageComment('c2', { artifactId: A2 })]), session('s-2', [pageComment('c3')])];
    const bySession = new Map([
      ['s-1', [artifact(A1)]],
      ['s-2', []],
    ]);

    renderHook(() => useArtifactCommentSweep(sessions, bySession, new Set(['s-1']), update, forget));

    expect(forget).toHaveBeenCalledWith(['c2']);
    expect(update).toHaveBeenCalledTimes(1);
    const [sessionId, change] = update.mock.calls[0] as [string, (prev: ArtifactComment[]) => ArtifactComment[]];
    expect(sessionId).toBe('s-1');
    expect(change(sessions[0].artifactComments!).map((c) => c.id)).toEqual(['c1']);
  });

  it('does nothing when every artifact is still there', () => {
    const update = vi.fn();
    const sessions = [session('s-1', [pageComment('c1')])];

    renderHook(() => useArtifactCommentSweep(sessions, new Map([['s-1', [artifact(A1)]]]), new Set(['s-1']), update, vi.fn()));

    expect(update).not.toHaveBeenCalled();
  });
});

describe('useArtifactComments on a canvas', () => {
  const KEY = 'c-0123456789abcdef';
  const CANVAS = { sessionId: 's-1', key: KEY };
  const HASH = 'b'.repeat(64);
  const canvasPick = (overrides: Record<string, unknown> = {}) => ({
    sessionId: 's-1',
    key: KEY,
    artboardId: 'pay-b',
    message: { kind: 'pick-text', quote: 'Pay now', before: '', after: '' },
    ...overrides,
  });
  const deliverCanvas = (payload: unknown) => act(() => (listeners.get('canvas-pick') ?? []).forEach((cb) => cb({ payload })));

  it('turns a canvas-pick into a candidate on that artboard', async () => {
    const { result } = renderComments({ shownPage: null, shownCanvas: CANVAS });
    act(() => result.current.state.setCommenting(true));

    deliverCanvas(canvasPick({ key: 'c-ffffffffffffffff' }));
    deliverCanvas(canvasPick({ artboardId: 'Pay B' }));
    expect(result.current.state.candidate).toBeNull();
    deliverCanvas(canvasPick());

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('canvas_comment_mode', { sessionId: 's-1', key: KEY, on: true }));
    expect(result.current.state.candidate).toEqual({
      page: { sessionId: 's-1', artifactId: KEY, version: 0 },
      artboardId: 'pay-b',
      anchor: { kind: 'text', quote: 'Pay now', before: '', after: '' },
      isPickHeld: false,
    });

    act(() => result.current.state.setCandidateBody('Make it wider.'));
    let outcome = '';
    act(() => {
      outcome = result.current.state.saveCandidate([{ id: 'pay-b', sha256: HASH }]);
    });

    expect(outcome).toBe('saved');
    expect(result.current.comments).toEqual([
      expect.objectContaining({
        artifactId: KEY,
        version: 0,
        body: 'Make it wider.',
        canvas: { key: KEY, artboardId: 'pay-b', fileHash: HASH },
      }),
    ]);
  });

  it('drops a canvas-pick while comment mode is off, and a page pick on a canvas', () => {
    const { result } = renderComments({ shownPage: null, shownCanvas: CANVAS });

    deliverCanvas(canvasPick());
    expect(result.current.state.candidate).toBeNull();
  });

  it('writes on the whole artboard without comment mode', () => {
    const { result } = renderComments({ shownPage: null, shownCanvas: CANVAS });

    act(() => result.current.state.startArtboardComment('pay-b'));

    expect(result.current.state.candidate).toEqual({
      page: { sessionId: 's-1', artifactId: KEY, version: 0 },
      artboardId: 'pay-b',
      anchor: { kind: 'artboard' },
      isPickHeld: false,
    });
    act(() => result.current.state.setCandidateBody('More space.'));
    let outcome = '';
    act(() => {
      outcome = result.current.state.saveCandidate([{ id: 'pay-b', sha256: null }]);
    });
    // An artboard whose file is gone takes no comment.
    expect(outcome).toBe('gone');
  });

  it('keeps the numbers an artboard could not find, by artboard', () => {
    const { result } = renderComments({ shownPage: null, shownCanvas: CANVAS });

    deliverCanvas(canvasPick({ message: { kind: 'marks-missing', numbers: [2] } }));

    expect([...(result.current.state.canvasMissing.get('pay-b') ?? [])]).toEqual([2]);
  });
});
