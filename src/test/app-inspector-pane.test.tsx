import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppInspectorPane, type AppInspectorPaneProps } from '../components/AppInspectorPane';
import type { useInspector } from '../hooks/useInspector';
import type { ReviewWiring } from '../hooks/useReviewWiring';
import type { Workspace } from '../types';

vi.mock('../components/changes/ChangesPanel', () => ({
  ChangesPanel: ({ rootPath }: { rootPath: string }) => <div data-testid="panel-changes">{rootPath}</div>,
}));
vi.mock('../components/FilesPanel', () => ({
  FilesPanel: ({ rootPath }: { rootPath: string }) => <div data-testid="panel-files">{rootPath}</div>,
}));
vi.mock('../components/terminal/TerminalDrawer', () => ({
  TerminalDrawer: ({ folderPath }: { folderPath: string }) => <div data-testid="panel-terminal">{folderPath}</div>,
}));

const folder: Workspace = { name: 'repo', path: '/w/repo' };

function makeInspector(): ReturnType<typeof useInspector> {
  return {
    tab: 'changes',
    show: vi.fn(),
    close: vi.fn(),
    width: 380,
    setWidth: vi.fn(),
    browserWidth: 560,
    setBrowserWidth: vi.fn(),
    isBrowserExpanded: false,
    setBrowserExpanded: vi.fn(),
    isDiffOpen: false,
    openDiff: vi.fn(),
    collapseDiff: vi.fn(),
    viewedFile: null,
    viewFile: vi.fn(),
    closeFile: vi.fn(),
    viewedArtifact: null,
    viewArtifact: vi.fn(),
    isArtifactExpanded: false,
    setArtifactExpanded: vi.fn(),
    changes: { changes: [], version: 1, reload: vi.fn() },
    headStats: null,
    headStatsFailed: false,
    targets: [],
    targetsFailed: false,
    filesPrefix: undefined,
  } as unknown as ReturnType<typeof useInspector>;
}

function makeProps(overrides: Partial<AppInspectorPaneProps> = {}): AppInspectorPaneProps {
  const inspector = makeInspector();
  const review: ReviewWiring = {
    review: {
      comments: [],
      add: vi.fn(),
      edit: vi.fn(),
      remove: vi.fn(),
      markSent: vi.fn(),
      sentInMessage: new Set(),
    } as unknown as ReviewWiring['review'],
    addReview: { inMessage: new Set(), blockedReason: undefined, add: vi.fn() },
    addArtifactReview: { inMessage: new Set(), blockedReason: undefined, add: vi.fn(), addCanvas: vi.fn() },
    forget: vi.fn(),
    slot: null,
    reviewOwner: undefined,
    blocksSend: false,
    isHeldFor: () => false,
    insertCanvasText: vi.fn(),
    sendFrom: vi.fn(),
    rearm: vi.fn(),
    onComposerText: vi.fn(),
    onComposerRestored: vi.fn(),
    onComposerGivenBack: vi.fn(),
  };

  return {
    inspectorTab: 'changes',
    inspectorTabs: ['changes', 'files', 'terminal'],
    inspector,
    windowWidth: 1400,
    isSidebarHidden: false,
    isBrowserExpanded: false,
    inspectorButtonRef: createRef<HTMLButtonElement>(),
    filesFolder: folder,
    activeSession: undefined,
    activeSessionId: '',
    activeSessionIdRef: { current: '' },
    activeAgent: undefined,
    activeInfo: undefined,
    isActiveRunning: false,
    isRepository: true,
    turnsEnded: 0,
    transcripts: {},
    transcriptStatus: {},
    currentMessages: [],
    isAcpBusy: () => false,
    isSessionBusy: () => false,
    repoPullRequests: [],
    openPullRequest: vi.fn(),
    githubProblem: undefined,
    onOpenGithubSettings: vi.fn(),
    onOpenPrivateSettings: vi.fn(),
    diffStats: undefined,
    review,
    taskTabs: { tabs: [], active: null, select: vi.fn() } as unknown as AppInspectorPaneProps['taskTabs'],
    backgroundTasks: { tasks: [], stop: vi.fn() },
    onJumpToMessage: vi.fn(),
    onInsertPaths: vi.fn(),
    onRevealFolder: vi.fn(),
    fileMarkers: new Map() as unknown as AppInspectorPaneProps['fileMarkers'],
    isComposerHidden: false,
    isComposerDisabled: false,
    composerRef: createRef(),
    onSendFromComposer: vi.fn(),
    sessionArtifacts: [],
    createdFiles: [],
    sessionCanvases: [],
    artifactComments: { comments: [] } as unknown as AppInspectorPaneProps['artifactComments'],
    onExpandArtifact: vi.fn(),
    canvasInsertText: vi.fn(),
    canvasInsertBlockedReason: undefined,
    privateCredits: {
      status: null,
      models: [],
      isLoading: false,
      refresh: vi.fn(),
      buy: vi.fn(),
      startTopup: vi.fn(),
    } as unknown as AppInspectorPaneProps['privateCredits'],
    onOpenUrl: vi.fn(),
    terminals: { tabsFor: () => [], open: vi.fn(), closeFolder: vi.fn(), liveCount: 0 } as unknown as AppInspectorPaneProps['terminals'],
    terminalDrawer: { startingFor: null, startShell: vi.fn() },
    onError: vi.fn(),
    onNotice: vi.fn(),
    ...overrides,
  };
}

describe('AppInspectorPane', () => {
  it('switches tab panels and returns focus to inspectorButtonRef when closed', () => {
    const inspector = makeInspector();
    const buttonRef = createRef<HTMLButtonElement>();
    const baseProps = makeProps({ inspector, inspectorButtonRef: buttonRef });

    const { rerender } = render(
      <>
        <button ref={buttonRef} type="button">
          Toggle inspector
        </button>
        <AppInspectorPane {...baseProps} />
      </>,
    );

    expect(screen.getByTestId('panel-changes').textContent).toBe('/w/repo');

    rerender(
      <>
        <button ref={buttonRef} type="button">
          Toggle inspector
        </button>
        <AppInspectorPane {...baseProps} inspectorTab="files" />
      </>,
    );
    expect(screen.getByTestId('panel-files').textContent).toBe('/w/repo');

    rerender(
      <>
        <button ref={buttonRef} type="button">
          Toggle inspector
        </button>
        <AppInspectorPane {...baseProps} inspectorTab="terminal" />
      </>,
    );
    expect(screen.getByTestId('panel-terminal').textContent).toBe('/w/repo');

    fireEvent.click(screen.getByRole('button', { name: /close inspector/i }));
    expect(inspector.close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(buttonRef.current);
  });
});
