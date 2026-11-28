import { designSystemReadNow } from './useDesignSystem';
import { useMemo } from 'react';
import { agentNameOr } from '../lib/agent-name';
import {
  galleryRows,
  hasVersion,
  newestVersion,
  shownArtifactOf,
  shownCanvasOf,
} from '../lib/artifacts';
import { createdFilesOf } from '../lib/created-files';
import type { InspectorTab } from '../lib/inspector';
import type {
  AgentProfile,
  ArtifactCard,
  ArtifactComment,
  ChatMessage,
  Session,
} from '../types';
import { useArtifactComments, useArtifactCommentSweep } from './useArtifactComments';
import { useArtifactOpening } from './useArtifactOpening';
import { useArtifacts } from './useArtifacts';
import { canvasBoardsNow } from './useCanvas';
import type { InspectorState } from './useInspector';
import { useVisualSweep } from './useVisualSweep';

export interface ArtifactsWiringDeps {
  sessions: readonly Session[];
  activeSession: Session | undefined;
  activeSessionId: string;
  activeTranscript: readonly ChatMessage[] | undefined;
  agents: readonly AgentProfile[];
  inspector: Pick<
    InspectorState,
    'viewedArtifact' | 'viewArtifact' | 'show' | 'isArtifactExpanded' | 'setArtifactExpanded'
  >;
  inspectorTab: InspectorTab | null;
  isGalleryOpen: boolean;
  onSelectSession: (sessionId: string) => void;
  updateArtifactComments: (sessionId: string, change: (prev: ArtifactComment[]) => ArtifactComment[]) => void;
  forgetInMessage: (ids: readonly string[]) => void;
  onError: (message: string) => void;
}

/**
 * Joins artifacts, canvases, the cross-session gallery, artifact comments and
 * visual sweep around the session and inspector tab currently on screen.
 */
export function useArtifactsWiring({
  sessions,
  activeSession,
  activeSessionId,
  activeTranscript,
  agents,
  inspector,
  inspectorTab,
  isGalleryOpen,
  onSelectSession,
  updateArtifactComments,
  forgetInMessage,
  onError,
}: ArtifactsWiringDeps) {
  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const artifacts = useArtifacts(sessionIds);
  const sessionArtifacts = useMemo(
    () => (activeSession ? artifacts.bySession.get(activeSession.id) ?? [] : []),
    [artifacts.bySession, activeSession],
  );
  const sessionCanvases = useMemo(
    () => (activeSession ? artifacts.canvasesBySession.get(activeSession.id) ?? [] : []),
    [artifacts.canvasesBySession, activeSession],
  );
  const sessionMotions = useMemo(
    () => (activeSession ? artifacts.motionsBySession.get(activeSession.id) ?? [] : []),
    [artifacts.motionsBySession, activeSession],
  );
  const sessionVideos = useMemo(
    () => (activeSession ? artifacts.videosBySession.get(activeSession.id) ?? [] : []),
    [artifacts.videosBySession, activeSession],
  );
  const sessionDesignSystems = useMemo(
    () => (activeSession ? artifacts.designSystemsBySession.get(activeSession.id) ?? [] : []),
    [artifacts.designSystemsBySession, activeSession],
  );
  // Motions, videos and design systems each open by themselves when nothing else is listed.
  const sessionMediaCount = sessionMotions.length + sessionVideos.length + sessionDesignSystems.length;
  const activeCwd = activeSession?.cwd;
  const createdFiles = useMemo(
    () => createdFilesOf(activeTranscript ?? [], activeCwd),
    [activeTranscript, activeCwd],
  );

  const onArtifactShown = useArtifactOpening({
    activeSessionId: activeSession?.id ?? null,
    viewed: inspector.viewedArtifact,
    showTab: () => inspector.show('artifacts'),
    view: inspector.viewArtifact,
  });

  const gallery = useMemo(
    () =>
      galleryRows(
        sessions,
        artifacts.bySession,
        (profileId) => agentNameOr(agents.find((agent) => agent.id === profileId)),
        artifacts.canvasesBySession,
        artifacts.designSystemsBySession,
      ),
    [sessions, artifacts.bySession, artifacts.canvasesBySession, artifacts.designSystemsBySession, agents],
  );
  const isGalleryShown = isGalleryOpen && gallery.length > 0;

  const openFromGallery = (sessionId: string, artifactId: string) => {
    onSelectSession(sessionId);
    // For the session about to show, whose id is its view: the one on screen now may be another.
    inspector.viewArtifact({ artifactId, version: null }, sessionId);
    inspector.show('artifacts');
  };

  const openDesignSystemFromGallery = (sessionId: string, designSystemKey: string) => {
    onSelectSession(sessionId);
    inspector.viewArtifact({ designSystemKey }, sessionId);
    inspector.show('artifacts');
  };

  const openCanvasFromGallery = (sessionId: string, canvasKey: string) => {
    onSelectSession(sessionId);
    inspector.viewArtifact({ canvasKey }, sessionId);
    inspector.show('artifacts');
  };

  // Artifact ids, canvas, motion and video keys never look alike, so one set tells a card whether its output is still listed.
  const artifactIds = useMemo(
    () =>
      new Set([
        ...sessionArtifacts.map((artifact) => artifact.id),
        ...sessionCanvases.map((canvas) => canvas.key),
        ...sessionMotions.map((motion) => motion.key),
        ...sessionVideos.map((video) => video.key),
        ...sessionDesignSystems.map((system) => system.key),
      ]),
    [sessionArtifacts, sessionCanvases, sessionMotions, sessionVideos, sessionDesignSystems],
  );

  /** A chat card's Open: the version it marks, in the Artifacts tab (the newest is followed, not pinned), or the canvas. */
  const openArtifactCard = (card: ArtifactCard) => {
    if (card.kind === 'motion') {
      if (!sessionMotions.some((motion) => motion.key === card.motionKey)) return;
      inspector.viewArtifact({ motionKey: card.motionKey });
      inspector.show('artifacts');
      return;
    }
    if (card.kind === 'video') {
      if (!sessionVideos.some((video) => video.key === card.videoKey)) return;
      inspector.viewArtifact({ videoKey: card.videoKey });
      inspector.show('artifacts');
      return;
    }
    if (card.kind === 'design-system') {
      if (!sessionDesignSystems.some((system) => system.key === card.designSystemKey)) return;
      inspector.viewArtifact({ designSystemKey: card.designSystemKey });
      inspector.show('artifacts');
      return;
    }
    if (card.kind === 'canvas') {
      if (!sessionCanvases.some((canvas) => canvas.key === card.canvasKey)) return;
      inspector.viewArtifact({ canvasKey: card.canvasKey });
      inspector.show('artifacts');
      return;
    }
    const artifact = sessionArtifacts.find((candidate) => candidate.id === card.artifactId);
    if (!artifact) return;
    inspector.viewArtifact({
      artifactId: card.artifactId,
      version: card.version === newestVersion(artifact) ? null : card.version,
    });
    inspector.show('artifacts');
  };

  const isArtifactExpanded =
    inspector.isArtifactExpanded &&
    inspectorTab === 'artifacts' &&
    sessionArtifacts.length + sessionCanvases.length + sessionMediaCount > 0;

  const shownArtifact =
    inspectorTab === 'artifacts'
      ? shownArtifactOf(sessionArtifacts, inspector.viewedArtifact, createdFiles.length + sessionCanvases.length + sessionMediaCount)
      : undefined;
  const viewedVersion =
    inspector.viewedArtifact?.artifactId === shownArtifact?.id ? inspector.viewedArtifact?.version : null;
  const shownVersion = shownArtifact ? (viewedVersion ?? newestVersion(shownArtifact)) : 0;
  const shownPage =
    activeSession && shownArtifact && hasVersion(shownArtifact, shownVersion)
      ? { sessionId: activeSession.id, artifactId: shownArtifact.id, version: shownVersion }
      : null;

  const shownCanvasEntry =
    inspectorTab === 'artifacts' && !shownArtifact
      ? shownCanvasOf(sessionCanvases, inspector.viewedArtifact, sessionArtifacts.length + createdFiles.length + sessionMediaCount)
      : undefined;
  const shownCanvas = useMemo(() => {
    if (!activeSession || !shownCanvasEntry) return null;
    const { key } = shownCanvasEntry;
    const sessionId = activeSession.id;
    return { sessionId, key, boardsNow: () => canvasBoardsNow(sessionId, key) };
  }, [activeSession, shownCanvasEntry]);

  const shownSystemKey =
    inspectorTab === 'artifacts' && !shownArtifact && !shownCanvasEntry
      ? (inspector.viewedArtifact?.designSystemKey ??
        (!inspector.viewedArtifact && sessionDesignSystems.length === 1 && sessionArtifacts.length + sessionCanvases.length + createdFiles.length + sessionMotions.length + sessionVideos.length === 0
          ? sessionDesignSystems[0].key
          : undefined))
      : undefined;
  const shownDesignSystem = useMemo(() => {
    if (!activeSession || !shownSystemKey || !sessionDesignSystems.some((system) => system.key === shownSystemKey)) return null;
    const sessionId = activeSession.id;
    const key = shownSystemKey;
    return { sessionId, key, readNow: () => designSystemReadNow(sessionId, key) };
  }, [activeSession, shownSystemKey, sessionDesignSystems]);

  const artifactComments = useArtifactComments({
    sessionId: activeSession?.id,
    comments: activeSession?.artifactComments,
    update: updateArtifactComments,
    shownPage,
    shownCanvas,
    shownDesignSystem,
    forget: forgetInMessage,
    onError,
  });

  useVisualSweep(activeSessionId, activeSessionId ? (activeTranscript ?? null) : null);
  useArtifactCommentSweep(
    sessions,
    artifacts.bySession,
    artifacts.canvasesBySession,
    artifacts.readSessions,
    updateArtifactComments,
    forgetInMessage,
    artifacts.designSystemsBySession,
  );

  const expandArtifact = () => {
    // A page that opened by itself is pinned when it takes the chat's place: a file the agent
    // makes meanwhile would otherwise turn the tab back into a list under the expanded page,
    // and comments would lose the page they are on.
    if (!inspector.viewedArtifact && shownArtifact) {
      inspector.viewArtifact({ artifactId: shownArtifact.id, version: null });
    }
    const onlyCanvas =
      sessionCanvases.length === 1 && sessionArtifacts.length === 0 && createdFiles.length === 0 && sessionMediaCount === 0
        ? sessionCanvases[0]
        : undefined;
    if (!inspector.viewedArtifact && onlyCanvas) {
      inspector.viewArtifact({ canvasKey: onlyCanvas.key });
    }
    // And a motion or a video that is the only thing listed.
    const isOnlyMedia =
      sessionMediaCount === 1 && sessionCanvases.length === 0 && sessionArtifacts.length === 0 && createdFiles.length === 0;
    if (!inspector.viewedArtifact && isOnlyMedia && sessionMotions[0]) inspector.viewArtifact({ motionKey: sessionMotions[0].key });
    if (!inspector.viewedArtifact && isOnlyMedia && sessionVideos[0]) inspector.viewArtifact({ videoKey: sessionVideos[0].key });
    if (!inspector.viewedArtifact && isOnlyMedia && sessionDesignSystems[0]) inspector.viewArtifact({ designSystemKey: sessionDesignSystems[0].key });
    inspector.setArtifactExpanded(true);
  };

  return {
    sessionArtifacts,
    sessionCanvases,
    sessionMotions,
    sessionVideos,
    sessionDesignSystems,
    createdFiles,
    onArtifactShown,
    gallery,
    isGalleryShown,
    openFromGallery,
    openCanvasFromGallery,
    openDesignSystemFromGallery,
    artifactIds,
    openArtifactCard,
    isArtifactExpanded,
    artifactComments,
    expandArtifact,
  };
}
