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

import { useArtifactsWiring, type ArtifactsWiringDeps } from '../hooks/useArtifactsWiring';
import type { ViewedArtifact } from '../lib/artifacts';
import type { AgentProfile, Artifact, Session } from '../types';

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'claude-acp',
  cwd: '/w/app',
  status: 'running',
  createdAt: 1,
  ...overrides,
});

const agent: AgentProfile = {
  id: 'claude-acp',
  name: 'Claude Code',
  command: 'claude',
  detected: true,
  acp_args: [],
  source: 'registry',
  version: '1.0.0',
  distribution: 'npx',
  availability: 'ready',
  install_plan: null,
  description: null,
  installed_on_system: true,
  listed: true,
};

const pageOne: Artifact = {
  id: 'a-0123456789abcdef',
  title: 'Pricing',
  sourcePath: '/w/app/pricing.html',
  versions: [
    { n: 1, at: 10, bytes: 100 },
    { n: 2, at: 20, bytes: 120 },
  ],
};

const canvasOne = {
  key: 'c-0123456789abcdef',
  folder: '/w/app/design',
  relative: 'design',
  title: 'Checkout',
  shownAt: 30,
  artboards: 4,
};

function makeDeps(overrides: Partial<ArtifactsWiringDeps> = {}): ArtifactsWiringDeps {
  const s1 = makeSession('s-1');
  const s2 = makeSession('s-2');
  return {
    sessions: [s1, s2],
    activeSession: s1,
    activeSessionId: 's-1',
    activeTranscript: undefined,
    agents: [agent],
    inspector: {
      viewedArtifact: null,
      viewArtifact: vi.fn(),
      show: vi.fn(),
      isArtifactExpanded: false,
      setArtifactExpanded: vi.fn(),
    },
    inspectorTab: 'artifacts',
    isGalleryOpen: false,
    onSelectSession: vi.fn(),
    updateArtifactComments: vi.fn(),
    forgetInMessage: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  invoke.mockReset();
  listeners.clear();
});

describe('useArtifactsWiring', () => {
  it('exposes session artifacts, canvases, gallery rows, isGalleryShown and artifactIds', async () => {
    invoke.mockImplementation(async (cmd) =>
      cmd === 'artifact_list'
        ? [
            { sessionId: 's-1', artifacts: [pageOne], canvases: [canvasOne] },
            { sessionId: 's-2', artifacts: [], canvases: [] },
          ]
        : undefined,
    );

    const { result, rerender } = renderHook((props: ArtifactsWiringDeps) => useArtifactsWiring(props), {
      initialProps: makeDeps({ isGalleryOpen: true }),
    });

    await waitFor(() => expect(result.current.sessionArtifacts).toEqual([pageOne]));
    expect(result.current.sessionCanvases).toEqual([canvasOne]);
    expect(result.current.gallery).toHaveLength(2);
    expect(result.current.isGalleryShown).toBe(true);
    expect([...result.current.artifactIds]).toEqual([pageOne.id, canvasOne.key]);

    // An open gallery with no rows left hides itself.
    invoke.mockImplementation(async (cmd) =>
      cmd === 'artifact_list' ? [{ sessionId: 's-1', artifacts: [], canvases: [] }] : undefined,
    );
    rerender(makeDeps({ sessions: [makeSession('s-1')], isGalleryOpen: true }));
    await waitFor(() => expect(result.current.gallery).toEqual([]));
    expect(result.current.isGalleryShown).toBe(false);
  });

  it('openArtifactCard pins older versions, follows newest, opens canvases, and ignores unknown cards', async () => {
    invoke.mockImplementation(async (cmd) =>
      cmd === 'artifact_list' ? [{ sessionId: 's-1', artifacts: [pageOne], canvases: [canvasOne] }] : undefined,
    );
    const viewArtifact = vi.fn();
    const show = vi.fn();
    const deps = makeDeps({
      sessions: [makeSession('s-1')],
      inspector: { viewedArtifact: null, viewArtifact, show, isArtifactExpanded: false, setArtifactExpanded: vi.fn() },
    });

    const { result } = renderHook(() => useArtifactsWiring(deps));
    await waitFor(() => expect(result.current.sessionArtifacts).toHaveLength(1));

    act(() => result.current.openArtifactCard({ artifactId: pageOne.id, title: pageOne.title, version: 1 }));
    expect(viewArtifact).toHaveBeenLastCalledWith({ artifactId: pageOne.id, version: 1 });
    expect(show).toHaveBeenLastCalledWith('artifacts');

    act(() => result.current.openArtifactCard({ artifactId: pageOne.id, title: pageOne.title, version: 2 }));
    expect(viewArtifact).toHaveBeenLastCalledWith({ artifactId: pageOne.id, version: null });

    act(() => result.current.openArtifactCard({ kind: 'canvas', canvasKey: canvasOne.key, title: canvasOne.title, artboards: 4 }));
    expect(viewArtifact).toHaveBeenLastCalledWith({ canvasKey: canvasOne.key });

    viewArtifact.mockClear();
    show.mockClear();
    act(() => result.current.openArtifactCard({ artifactId: 'a-missing', title: 'Gone', version: 1 }));
    act(() => result.current.openArtifactCard({ kind: 'canvas', canvasKey: 'c-missing', title: 'Gone', artboards: 1 }));
    expect(viewArtifact).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('openFromGallery and openCanvasFromGallery select the session and view for that session', async () => {
    invoke.mockImplementation(async (cmd) => (cmd === 'artifact_list' ? [] : undefined));
    const onSelectSession = vi.fn();
    const viewArtifact = vi.fn();
    const show = vi.fn();
    const deps = makeDeps({
      sessions: [makeSession('s-1')],
      onSelectSession,
      inspector: { viewedArtifact: null, viewArtifact, show, isArtifactExpanded: false, setArtifactExpanded: vi.fn() },
    });

    const { result } = renderHook(() => useArtifactsWiring(deps));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('artifact_list', { sessionIds: ['s-1'] }));
    await act(async () => undefined);

    act(() => result.current.openFromGallery('s-2', pageOne.id));
    expect(onSelectSession).toHaveBeenLastCalledWith('s-2');
    expect(viewArtifact).toHaveBeenLastCalledWith({ artifactId: pageOne.id, version: null }, 's-2');
    expect(show).toHaveBeenLastCalledWith('artifacts');

    act(() => result.current.openCanvasFromGallery('s-2', canvasOne.key));
    expect(onSelectSession).toHaveBeenLastCalledWith('s-2');
    expect(viewArtifact).toHaveBeenLastCalledWith({ canvasKey: canvasOne.key }, 's-2');
    expect(show).toHaveBeenLastCalledWith('artifacts');
  });

  it('expandArtifact pins an auto-opened single page or single canvas before expanding', async () => {
    const viewArtifact = vi.fn();
    const setArtifactExpanded = vi.fn();
    const inspectorFor = (viewedArtifact: ViewedArtifact | null) => ({
      viewedArtifact,
      viewArtifact,
      show: vi.fn(),
      isArtifactExpanded: false,
      setArtifactExpanded,
    });

    // Single page auto-opened -> pins artifactId before expanding.
    invoke.mockImplementation(async (cmd) =>
      cmd === 'artifact_list' ? [{ sessionId: 's-1', artifacts: [pageOne], canvases: [] }] : undefined,
    );
    const first = renderHook(() =>
      useArtifactsWiring(makeDeps({ sessions: [makeSession('s-1')], inspector: inspectorFor(null) })),
    );
    await waitFor(() => expect(first.result.current.sessionArtifacts).toHaveLength(1));

    act(() => first.result.current.expandArtifact());
    expect(viewArtifact).toHaveBeenCalledWith({ artifactId: pageOne.id, version: null });
    expect(setArtifactExpanded).toHaveBeenCalledWith(true);

    // Single canvas auto-opened -> pins canvasKey before expanding.
    viewArtifact.mockClear();
    setArtifactExpanded.mockClear();
    invoke.mockImplementation(async (cmd) =>
      cmd === 'artifact_list' ? [{ sessionId: 's-1', artifacts: [], canvases: [canvasOne] }] : undefined,
    );
    const second = renderHook(() =>
      useArtifactsWiring(makeDeps({ sessions: [makeSession('s-1')], inspector: inspectorFor(null) })),
    );
    await waitFor(() => expect(second.result.current.sessionCanvases).toHaveLength(1));

    act(() => second.result.current.expandArtifact());
    expect(viewArtifact).toHaveBeenCalledWith({ canvasKey: canvasOne.key });
    expect(setArtifactExpanded).toHaveBeenCalledWith(true);
  });
});
