import type { ComponentProps, RefObject } from 'react';
import type { AcpSessionInfo } from '../hooks/useAcpSessions';
import type { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import type { useInspector } from '../hooks/useInspector';
import type { NoticeTone } from '../hooks/useNotice';
import type { ReviewWiring } from '../hooks/useReviewWiring';
import type { useTerminalDrawer } from '../hooks/useTerminalDrawer';
import { agentNameOr } from '../lib/agent-name';
import { compactCommandOf } from '../lib/context-usage';
import { maxInspectorWidth, type InspectorTab } from '../lib/inspector';
import { replyBlockedReason } from '../lib/reply-quote';
import type { AgentProfile, ChatMessage, Session, Workspace } from '../types';
import { ActivityPanel } from './activity/ActivityPanel';
import { ArtifactsPanel } from './artifacts/ArtifactsPanel';
import { BrowserPanel } from './browser/BrowserPanel';
import { ChangesPanel } from './changes/ChangesPanel';
import type { ComposerHandle } from './ComposerDock';
import { ContextPanel } from './context/ContextPanel';
import { FilesPanel } from './FilesPanel';
import { Inspector } from './inspector/Inspector';
import { PrivateInspector } from './private/PrivateInspector';
import { TasksPanel } from './tasks/TasksPanel';
import { TerminalDrawer } from './terminal/TerminalDrawer';

export interface AppInspectorPaneProps {
  inspectorTab: InspectorTab;
  inspectorTabs: readonly InspectorTab[];
  inspector: ReturnType<typeof useInspector>;
  windowWidth: number;
  isSidebarHidden: boolean;
  isBrowserExpanded: boolean;
  inspectorButtonRef: RefObject<HTMLButtonElement | null>;
  filesFolder: Workspace | undefined;
  activeSession: Session | undefined;
  activeSessionId: string;
  activeSessionIdRef: RefObject<string>;
  activeAgent: AgentProfile | undefined;
  activeInfo: AcpSessionInfo | undefined;
  isActiveRunning: boolean;
  isRepository: boolean;
  turnsEnded: number;
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  transcriptStatus: Readonly<Record<string, 'ready' | 'failed'>>;
  currentMessages: ChatMessage[];
  isAcpBusy: (sessionId: string) => boolean;
  isSessionBusy: (sessionId: string) => boolean;
  repoPullRequests: ComponentProps<typeof ChangesPanel>['pullRequests'];
  openPullRequest: (url: string) => void;
  githubProblem: ComponentProps<typeof ChangesPanel>['githubProblem'];
  onOpenGithubSettings: () => void;
  onOpenPrivateSettings: () => void;
  diffStats: ComponentProps<typeof ChangesPanel>['diffStats'];
  review: ReviewWiring;
  taskTabs: ComponentProps<typeof TasksPanel>['tabs'];
  backgroundTasks: Pick<ReturnType<typeof useBackgroundTasks>, 'tasks' | 'stop'>;
  onJumpToMessage: (messageId: string) => void;
  onInsertPaths: (paths: string[]) => void;
  onRevealFolder: (path: string) => void;
  fileMarkers: ComponentProps<typeof FilesPanel>['markers'];
  isComposerHidden: boolean;
  isComposerDisabled: boolean;
  composerRef: RefObject<ComposerHandle | null>;
  onSendFromComposer: (sessionId: string, text: string) => void;
  sessionArtifacts: ComponentProps<typeof ArtifactsPanel>['artifacts'];
  createdFiles: NonNullable<ComponentProps<typeof ArtifactsPanel>['files']>;
  sessionCanvases: ComponentProps<typeof ArtifactsPanel>['canvases'];
  artifactComments: ComponentProps<typeof ArtifactsPanel>['comments'];
  onExpandArtifact: () => void;
  canvasInsertText: (text: string) => void;
  canvasInsertBlockedReason: string | undefined;
  privateCredits: ComponentProps<typeof PrivateInspector>['credits'];
  onOpenUrl: (url: string) => void;
  terminals: ComponentProps<typeof TerminalDrawer>['terminals'];
  terminalDrawer: Pick<ReturnType<typeof useTerminalDrawer>, 'startingFor' | 'startShell'>;
  onError: (message: string) => void;
  onNotice: (message: string | null, tone?: NoticeTone) => void;
}

/** Renders the right-hand inspector shell and the panel for the currently selected tab. */
export function AppInspectorPane({
  inspectorTab,
  inspectorTabs,
  inspector,
  windowWidth,
  isSidebarHidden,
  isBrowserExpanded,
  inspectorButtonRef,
  filesFolder,
  activeSession,
  activeSessionId,
  activeSessionIdRef,
  activeAgent,
  activeInfo,
  isActiveRunning,
  isRepository,
  turnsEnded,
  transcripts,
  transcriptStatus,
  currentMessages,
  isAcpBusy,
  isSessionBusy,
  repoPullRequests,
  openPullRequest,
  githubProblem,
  onOpenGithubSettings,
  onOpenPrivateSettings,
  diffStats,
  review,
  taskTabs,
  backgroundTasks,
  onJumpToMessage,
  onInsertPaths,
  onRevealFolder,
  fileMarkers,
  isComposerHidden,
  isComposerDisabled,
  composerRef,
  onSendFromComposer,
  sessionArtifacts,
  createdFiles,
  sessionCanvases,
  artifactComments,
  onExpandArtifact,
  canvasInsertText,
  canvasInsertBlockedReason,
  privateCredits,
  onOpenUrl,
  terminals,
  terminalDrawer,
  onError,
  onNotice,
}: AppInspectorPaneProps) {
  return (
    <Inspector
      tab={inspectorTab}
      tabs={inspectorTabs}
      width={inspectorTab === 'browser' ? inspector.browserWidth : inspector.width}
      maxWidth={maxInspectorWidth(windowWidth, !isSidebarHidden)}
      isExpanded={isBrowserExpanded}
      counts={{
        changes: inspector.changes.changes?.length,
        artifacts: sessionArtifacts.length + createdFiles.length || undefined,
        tasks: taskTabs.tabs.length || undefined,
      }}
      isViewingFile={inspectorTab === 'files' && inspector.viewedFile !== null}
      onSelect={inspector.show}
      onResize={inspectorTab === 'browser' ? inspector.setBrowserWidth : inspector.setWidth}
      onClose={() => {
        inspector.close();
        inspectorButtonRef.current?.focus();
      }}
    >
      {inspectorTab === 'changes' && filesFolder && (
        <ChangesPanel
          key={filesFolder.path}
          rootPath={filesFolder.path}
          rootName={filesFolder.name}
          changes={inspector.changes.changes}
          version={inspector.changes.version}
          onReload={inspector.changes.reload}
          pullRequests={repoPullRequests}
          onOpenPullRequest={openPullRequest}
          githubProblem={githubProblem}
          onOpenGithubSettings={onOpenGithubSettings}
          diffStats={diffStats}
          onOpenDiff={() => inspector.openDiff()}
          stats={inspector.headStats ?? undefined}
          statsFailed={inspector.headStatsFailed}
          targets={inspector.targets}
          targetsFailed={inspector.targetsFailed}
          review={activeSession ? review.review : undefined}
          addReview={activeSession ? review.addReview : undefined}
        />
      )}
      {inspectorTab === 'tasks' && activeSession && (
        <TasksPanel
          tabs={taskTabs}
          sessionId={activeSession.id}
          messages={transcripts[activeSession.id] ?? []}
          tasks={backgroundTasks.tasks}
          agentName={activeAgent?.name ?? 'The agent'}
          isBusy={isAcpBusy(activeSession.id)}
          onStop={backgroundTasks.stop}
        />
      )}
      {inspectorTab === 'activity' && activeSession && (
        <ActivityPanel
          key={activeSession.id}
          messages={transcripts[activeSession.id]}
          transcript={transcriptStatus[activeSession.id] ?? 'loading'}
          session={activeSession}
          isRepository={isRepository}
          isBusy={isSessionBusy(activeSession.id)}
          version={inspector.changes.version}
          headStats={inspector.headStats}
          headStatsFailed={inspector.headStatsFailed}
          onJump={onJumpToMessage}
          agentName={agentNameOr(activeAgent)}
          onShowChanges={() => inspector.show('changes')}
        />
      )}
      {inspectorTab === 'files' && filesFolder && (
        <FilesPanel
          key={filesFolder.path}
          rootPath={filesFolder.path}
          rootName={filesFolder.name}
          onInsertPath={(path) => onInsertPaths([path])}
          onRevealRoot={() => onRevealFolder(filesFolder.path)}
          markers={fileMarkers}
          viewedFile={inspector.viewedFile}
          onViewFile={inspector.viewFile}
          onCloseFile={inspector.closeFile}
          version={inspector.changes.version}
          filesPrefix={inspector.filesPrefix}
          // Lines go into the message box only when Reply could: shown, enabled, not holding another session's comments.
          onInsertText={
            replyBlockedReason({
              isComposerHidden,
              isComposerDisabled,
              isHeldElsewhere: review.isHeldFor(activeSessionId),
            })
              ? undefined
              : (text) => composerRef.current?.insertText(text)
          }
        />
      )}
      {inspectorTab === 'context' && activeSession && activeInfo?.usage && (
        <ContextPanel
          key={activeSession.id}
          sessionId={activeSession.id}
          agentId={activeSession.profileId}
          agentName={activeAgent?.name ?? 'The agent'}
          cwd={activeSession.cwd}
          usage={activeInfo.usage}
          turnUsage={activeInfo.turnUsage ?? []}
          turnsEnded={activeInfo.turnsEnded ?? 0}
          messages={currentMessages}
          // An ended session's agent is gone: the command would go to a closed connection.
          compactCommand={isActiveRunning ? compactCommandOf(activeInfo.commands) : null}
          isBusy={isAcpBusy(activeSession.id)}
          onCompact={(command) => onSendFromComposer(activeSession.id, `/${command}`)}
        />
      )}
      {inspectorTab === 'artifacts' && activeSession && (
        <ArtifactsPanel
          key={activeSession.id}
          sessionId={activeSession.id}
          artifacts={sessionArtifacts}
          viewed={inspector.viewedArtifact}
          onView={inspector.viewArtifact}
          isExpanded={false}
          onToggleExpanded={onExpandArtifact}
          onError={onError}
          onNotice={onNotice}
          comments={artifactComments}
          addReview={review.addArtifactReview}
          cwd={activeSession.cwd}
          files={createdFiles}
          canvases={sessionCanvases}
          turnsEnded={turnsEnded}
          onInsertText={canvasInsertText}
          insertBlockedReason={canvasInsertBlockedReason}
          filesRoot={filesFolder?.path}
          agentName={activeAgent?.name}
          onOpenFile={(relative) => {
            inspector.viewFile(relative);
            inspector.show('files');
          }}
        />
      )}
      {inspectorTab === 'private' && activeSession?.privateMode && (
        <PrivateInspector
          session={activeSession}
          credits={privateCredits}
          messages={currentMessages}
          onTopUp={onOpenPrivateSettings}
          onOpenUrl={onOpenUrl}
        />
      )}
      {inspectorTab === 'browser' && activeSession && (
        <BrowserPanel
          key={activeSession.id}
          sessionId={activeSession.id}
          isExpanded={isBrowserExpanded}
          onToggleExpanded={() => inspector.setBrowserExpanded(!isBrowserExpanded)}
          onError={onError}
          onAddContext={
            replyBlockedReason({
              isComposerHidden,
              isComposerDisabled,
              isHeldElsewhere: review.isHeldFor(activeSessionId),
            })
              ? undefined
              : (text) => {
                  if (activeSessionIdRef.current === activeSession.id) composerRef.current?.insertText(text);
                }
          }
        />
      )}
      {inspectorTab === 'terminal' && filesFolder && (
        <TerminalDrawer
          folderPath={filesFolder.path}
          folderName={filesFolder.name}
          terminals={terminals}
          startingFor={terminalDrawer.startingFor}
          onStartShell={terminalDrawer.startShell}
        />
      )}
    </Inspector>
  );
}
