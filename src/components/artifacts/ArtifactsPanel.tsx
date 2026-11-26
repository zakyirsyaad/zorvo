import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Clapperboard, FileText, LayoutGrid, Palette, PanelsTopLeft, X } from "lucide-react";
import { FOLDER_NOT_FOUND, canvasCountLabel, type CanvasEntry } from "../../lib/canvas";
import { newestVersion, shownArtifactOf, shownCanvasOf, type ViewedArtifact } from "../../lib/artifacts";
import { fileNameAndFolder, pathInFolder, type CreatedFile } from "../../lib/created-files";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ArtifactCommentsState } from "../../hooks/useArtifactComments";
import type { AddArtifactReview } from "../../hooks/useReviewWiring";
import type { Artifact } from "../../types";
import { ArtifactViewer } from "./ArtifactViewer";
import { CanvasMenu } from "./CanvasMenu";
import { CanvasViewer } from "./CanvasViewer";
import { MotionViewer } from "./MotionViewer";
import { VideoViewer } from "./VideoViewer";
import { motionDetail, type MotionEntry, type VideoEntry } from "../../lib/motion";
import type { DesignSystemEntry } from "../../lib/design-systems";
import { IconButton } from "../ui/IconButton";
import { DesignSystemViewer } from "./DesignSystemViewer";

export interface ArtifactsPanelProps {
  sessionId: string;
  /** The session's artifacts, the most recently changed first. */
  artifacts: readonly Artifact[];
  /** The artifact the viewer shows; null shows the list (or the only artifact). */
  viewed: ViewedArtifact | null;
  onView: (view: ViewedArtifact | null) => void;
  /** The page takes the chat's place. */
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
  /** A notice that is not an error (a canvas export's count); absent, `onError` says it. */
  onNotice?: (message: string, tone: "info" | "warning") => void;
  /** The session's artifact comments, main window only. */
  comments?: ArtifactCommentsState;
  addReview?: AddArtifactReview;
  cwd?: string;
  /** The files the agent created in this session, the newest first, listed under the pages. */
  files?: readonly CreatedFile[];
  /** The agent's name, for the empty tab. */
  agentName?: string;
  /** The folder the file viewer shows, which a created file must be inside to open there. */
  filesRoot?: string;
  /** Opens a created file in the file viewer; given its path inside `filesRoot`. */
  onOpenFile?: (relative: string) => void;
  /** The canvases the session's agent showed, the most recently shown first. */
  canvases?: readonly CanvasEntry[];
  /** Moves when one of the session's turns ends, so an open canvas is read again. */
  turnsEnded?: number;
  /** Puts text in the message box (a canvas's Pick and Build); absent, those buttons are not offered. */
  onInsertText?: (text: string) => void;
  /** Why the message box cannot take text now. */
  insertBlockedReason?: string;
  /** The motions the session's agent showed, the most recently shown first. */
  motions?: readonly MotionEntry[];
  /** The video files the session's agent showed, the most recently shown first. */
  videos?: readonly VideoEntry[];
  /** The design systems the session's agent showed, the most recently shown first. */
  designSystems?: readonly DesignSystemEntry[];
}

/** The mark every artifact row and card carries; a canvas has its own. */
export function ArtifactMark({ kind = "page" }: { kind?: "page" | "canvas" | "video" | "design-system" }) {
  const icon =
    kind === "canvas" ? (
      <LayoutGrid size={14} />
    ) : kind === "video" ? (
      <Clapperboard size={14} />
    ) : kind === "design-system" ? (
      <Palette size={14} />
    ) : (
      <PanelsTopLeft size={14} />
    );
  return (
    <span aria-hidden="true" data-mark={kind} className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-fg-secondary">
      {icon}
    </span>
  );
}

/** A motion or a video the agent showed: a row that opens its viewer. */
function MediaRow({ title, detail, hint, onOpen }: { title: string; detail: string; hint: string; onOpen: () => void }) {
  return (
    <button type="button" title={hint} onClick={onOpen} className={`focus-ring ${ROW} transition-colors hover:bg-surface-hover`}>
      <ArtifactMark kind="video" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-fg">{title}</span>
        <span className="truncate text-caption text-fg-subtle">{detail}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
    </button>
  );
}

/** The mark of a created file's row. */
function FileMark() {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-fg-secondary">
      <FileText size={14} />
    </span>
  );
}

const ROW = "flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left";

/** A created file: it opens in the file viewer when it is inside the session's folder, else it is only named. */
function CreatedFileRow({ file, root, onOpenFile }: { file: CreatedFile; root?: string; onOpenFile?: (relative: string) => void }) {
  const { name, where } = fileNameAndFolder(file.path, root ?? "");
  const relative = root ? pathInFolder(file.path, root) : null;
  const content = (
    <>
      <FileMark />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-fg">{name}</span>
        <span className="truncate text-caption text-fg-subtle">
          {[where ? `New file · ${where}` : "New file", file.at === null ? null : formatRelativeTime(file.at)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </>
  );
  if (relative === null || !onOpenFile) {
    return (
      <div title={file.path} className={ROW}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" title={file.path} onClick={() => onOpenFile(relative)} className={`focus-ring ${ROW} transition-colors hover:bg-surface-hover`}>
      {content}
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
    </button>
  );
}

/**
 * A canvas the agent showed: its title, artboard count and folder, and its menu. One whose folder is
 * gone opens nothing and says so, as in the artboard.
 */
function CanvasRow({ sessionId, canvas, onOpen, onError }: { sessionId: string; canvas: CanvasEntry; onOpen: () => void; onError: (message: string) => void }) {
  const isGone = canvas.folderGone === true;
  const detail = [isGone ? "Canvas" : canvasCountLabel(canvas.artboards), canvas.relative].filter(Boolean).join(" · ");
  const content = (
    <>
      <ArtifactMark kind="canvas" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-ui ${isGone ? "text-fg-muted" : "text-fg"}`}>{canvas.title}</span>
        <span className="truncate text-caption text-fg-subtle">{detail}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-1">
      {isGone ? (
        <div title={canvas.folder} className={`${ROW} min-w-0 flex-1`}>
          {content}
          <span className="shrink-0 pr-1.5 text-ui-sm text-fg-subtle">{FOLDER_NOT_FOUND}</span>
        </div>
      ) : (
        <button type="button" title={canvas.folder} onClick={onOpen} className={`focus-ring ${ROW} min-w-0 flex-1 transition-colors hover:bg-surface-hover`}>
          {content}
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      )}
      <CanvasMenu sessionId={sessionId} canvasKey={canvas.key} title={canvas.title} onError={onError} />
    </div>
  );
}

/** "42 tokens · 12 components". */
export function designSystemDetail(system: Pick<DesignSystemEntry, "tokens" | "components">): string {
  const tokens = `${system.tokens} ${system.tokens === 1 ? "token" : "tokens"}`;
  const components = `${system.components} ${system.components === 1 ? "component" : "components"}`;
  return `${tokens} · ${components}`;
}

/** A design system the agent showed: a row that opens it, and Remove, which only forgets it. */
function DesignSystemRow({ sessionId, system, onOpen, onError }: { sessionId: string; system: DesignSystemEntry; onOpen: () => void; onError: (message: string) => void }) {
  const remove = () => {
    invoke("ds_forget", { sessionId, key: system.key }).catch(() => onError("Zorvo could not remove that design system."));
  };
  return (
    <div className="flex items-center gap-1">
      <button type="button" title={system.folder} onClick={onOpen} className={`focus-ring ${ROW} min-w-0 flex-1 transition-colors hover:bg-surface-hover`}>
        <ArtifactMark kind="design-system" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui text-fg">{system.title}</span>
          <span className="truncate text-caption text-fg-subtle">{`Design system · ${designSystemDetail(system)}`}</span>
        </span>
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
      </button>
      <IconButton label={`Remove ${system.title} from Artifacts`} size="row" onClick={remove}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

/** The Artifacts tab: the pages and canvases this session's agent showed, one of them open, and the files it created. */
export function ArtifactsPanel({
  sessionId,
  artifacts,
  viewed,
  onView,
  isExpanded,
  onToggleExpanded,
  onError,
  onNotice,
  comments,
  addReview,
  cwd,
  files = [],
  agentName = "The agent",
  filesRoot,
  onOpenFile,
  canvases = [],
  turnsEnded,
  onInsertText,
  insertBlockedReason,
  motions = [],
  videos = [],
  designSystems = [],
}: ArtifactsPanelProps) {
  // A single page, canvas, motion, video or design system opens by itself, unless something else is listed beside it.
  const mediaCount = motions.length + videos.length + designSystems.length;
  const rowCount = artifacts.length + canvases.length + files.length + mediaCount;
  const isOnly = rowCount === 1;
  const open = shownArtifactOf(artifacts, viewed, files.length + canvases.length + mediaCount);
  const openCanvas = shownCanvasOf(canvases, viewed, artifacts.length + files.length + mediaCount);
  const openMotion = viewed?.motionKey
    ? motions.find((motion) => motion.key === viewed.motionKey)
    : !viewed && isOnly && motions.length === 1
      ? motions[0]
      : undefined;
  const openVideo = viewed?.videoKey
    ? videos.find((video) => video.key === viewed.videoKey)
    : !viewed && isOnly && videos.length === 1
      ? videos[0]
      : undefined;

  const openSystem = viewed?.designSystemKey
    ? designSystems.find((system) => system.key === viewed.designSystemKey)
    : !viewed && isOnly && designSystems.length === 1
      ? designSystems[0]
      : undefined;

  if (openSystem) {
    return (
      <DesignSystemViewer
        key={openSystem.key}
        sessionId={sessionId}
        designSystemKey={openSystem.key}
        cwd={cwd}
        turnsEnded={turnsEnded}
        onBack={isOnly ? undefined : () => onView(null)}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onError={onError}
        onInsertText={onInsertText}
        insertBlockedReason={insertBlockedReason}
      />
    );
  }

  if (openMotion) {
    return (
      <MotionViewer
        key={openMotion.key}
        sessionId={sessionId}
        motionKey={openMotion.key}
        title={openMotion.title}
        turnsEnded={turnsEnded}
        onBack={isOnly ? undefined : () => onView(null)}
        onView={onView}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onError={onError}
      />
    );
  }

  if (openVideo) {
    return (
      <VideoViewer
        key={openVideo.key}
        sessionId={sessionId}
        video={openVideo}
        onBack={isOnly ? undefined : () => onView(null)}
        onView={onView}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onError={onError}
      />
    );
  }

  if (openCanvas) {
    return (
      <CanvasViewer
        // Another canvas starts with its menus closed.
        key={openCanvas.key}
        sessionId={sessionId}
        canvasKey={openCanvas.key}
        turnsEnded={turnsEnded}
        onBack={isOnly ? undefined : () => onView(null)}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onError={onError}
        onNotice={onNotice}
        comments={comments}
        addReview={addReview}
        cwd={cwd}
        onInsertText={onInsertText}
        insertBlockedReason={insertBlockedReason}
      />
    );
  }

  if (open) {
    return (
      <ArtifactViewer
        // Another artifact starts with its menus closed and its own reload count.
        key={open.id}
        sessionId={sessionId}
        artifact={open}
        version={viewed?.version ?? null}
        onBack={isOnly ? undefined : () => onView(null)}
        onView={onView}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onError={onError}
        comments={comments}
        addReview={addReview}
        cwd={cwd}
      />
    );
  }

  if (rowCount === 0) {
    return (
      <p className="px-4 py-3.5 text-ui-sm text-fg-muted">
        {`Nothing yet. Pages and files ${agentName} makes in this session show here.`}
      </p>
    );
  }

  return (
    <ul aria-label="Artifacts" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2.5">
      {artifacts.map((artifact) => {
        const newest = newestVersion(artifact);
        const at = artifact.versions.find((version) => version.n === newest)?.at ?? 0;
        return (
          <li key={artifact.id}>
            <button
              type="button"
              onClick={() => onView({ artifactId: artifact.id, version: null })}
              className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left transition-colors hover:bg-surface-hover"
            >
              <ArtifactMark />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui text-fg">{artifact.title}</span>
                <span className="truncate text-caption text-fg-subtle">{`Version ${newest} · ${formatRelativeTime(at)}`}</span>
              </span>
              <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
            </button>
          </li>
        );
      })}
      {motions.map((motion) => (
        <li key={motion.key}>
          <MediaRow
            title={motion.title}
            detail={`${motionDetail(motion.duration, motion.formats.length)} · ${motion.relative}`}
            hint={motion.folder}
            onOpen={() => onView({ motionKey: motion.key })}
          />
        </li>
      ))}
      {videos.map((video) => (
        <li key={video.key}>
          <MediaRow title={video.title} detail={`Video file · ${video.relative}`} hint={video.path} onOpen={() => onView({ videoKey: video.key })} />
        </li>
      ))}
      {designSystems.map((system) => (
        <li key={system.key}>
          <DesignSystemRow sessionId={sessionId} system={system} onOpen={() => onView({ designSystemKey: system.key })} onError={onError} />
        </li>
      ))}
      {canvases.map((canvas) => (
        <li key={canvas.key}>
          <CanvasRow sessionId={sessionId} canvas={canvas} onOpen={() => onView({ canvasKey: canvas.key })} onError={onError} />
        </li>
      ))}
      {files.map((file) => (
        <li key={file.path}>
          <CreatedFileRow file={file} root={filesRoot} onOpenFile={onOpenFile} />
        </li>
      ))}
    </ul>
  );
}
