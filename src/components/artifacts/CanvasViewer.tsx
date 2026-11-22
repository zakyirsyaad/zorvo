import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle } from "lucide-react";
import { useCanvas } from "../../hooks/useCanvas";
import { useCanvasMarks } from "../../hooks/useCanvasMarks";
import type { ArtifactCommentsState } from "../../hooks/useArtifactComments";
import type { AddArtifactReview } from "../../hooks/useReviewWiring";
import { enqueueArtifactViewCall } from "../../hooks/useArtifactView";
import { useLatest } from "../../hooks/useLatest";
import { FOLDER_NOT_FOUND, artboardCount, buildMessage, buildSectionMessage, canvasShellState, exportNotice, parseExportOutcome, pickMessage } from "../../lib/canvas";
import { ArtifactCommentStrip } from "./ArtifactCommentStrip";
import { ArtifactPageBox } from "./ArtifactPageBox";
import { CanvasHeader } from "./CanvasHeader";
import type { ExportFormat, ExportScope } from "./CanvasExportMenu";

export interface CanvasViewerProps {
  sessionId: string;
  canvasKey: string;
  /** Moves when one of the session's turns ends, so the canvas is read again. */
  turnsEnded?: number;
  /** Back to the Artifacts list; absent when there is no list to go back to. */
  onBack?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
  /** A notice that is not an error, such as how many artboards were exported; absent, `onError` says it. */
  onNotice?: (message: string, tone: "info" | "warning") => void;
  /** Something of the viewer's parent is open over the canvas. */
  isCovered?: boolean;
  /** The session's artifact comments; absent (a popout), no Comment button and no strip. */
  comments?: ArtifactCommentsState;
  addReview?: AddArtifactReview;
  /** The session's folder, for the artboard's file in a comment's message. */
  cwd?: string;
  /** Puts text in the session's message box, never sends it; absent (a popout), no Pick or Build. */
  onInsertText?: (text: string) => void;
  /** Why the message box cannot take text now. */
  insertBlockedReason?: string;
}

const COULD_NOT_SHOW = "Zorvo could not show that canvas.";
const COULD_NOT_EXPORT = "Zorvo could not export those artboards.";

/**
 * A canvas in the artifact view: Zorvo's wrapper page in the same native view a page uses, told what
 * to show with `canvas_view_apply` whenever the canvas, its files or its pictures change, and driven by
 * the header's commands. A `canvas.json` that cannot be read keeps the last layout under a bar.
 */
export function CanvasViewer({
  sessionId,
  canvasKey,
  turnsEnded,
  onBack,
  isExpanded,
  onToggleExpanded,
  onError,
  onNotice,
  isCovered = false,
  comments,
  addReview,
  cwd,
  onInsertText,
  insertBlockedReason,
}: CanvasViewerProps) {
  const canvas = useCanvas(sessionId, canvasKey, turnsEnded);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // A new number makes a new view: a canvas whose view ended (a flood, a dead page) or hangs comes back.
  const [reload, setReload] = useState(0);
  const onErrorRef = useLatest(onError);
  const { shown, read, selected, lastGood, thumbs } = canvas;
  useCanvasMarks(sessionId, canvasKey, comments?.comments, shown?.boards, onError);

  // A string, so an equal state (a new but empty picture map, a render) sends nothing.
  const state = useMemo(() => (shown === null ? null : canvasShellState(shown, sessionId, thumbs, selected)), [shown, sessionId, thumbs, selected]);
  useEffect(() => {
    if (state === null) return;
    enqueueArtifactViewCall(
      () => invoke("canvas_view_apply", { sessionId, key: canvasKey, state }),
      () => onErrorRef.current(COULD_NOT_SHOW),
    );
  }, [state, sessionId, canvasKey, onErrorRef]);

  const command = (name: string) => {
    const full = name === "focus" ? (selected === null ? null : `focus:${selected}`) : name;
    if (full === null) return;
    enqueueArtifactViewCall(() => invoke("canvas_view_command", { sessionId, key: canvasKey, name: full }));
  };

  const title = lastGood?.title ?? read?.entry.title ?? "";
  const count = lastGood ? artboardCount(lastGood) : (read?.entry.artboards ?? 0);
  const selectedTitle = selected === null ? null : (lastGood?.sections.flatMap((section) => section.artboards).find((board) => board.id === selected)?.title ?? null);
  const selectedBoard = selected === null ? null : (lastGood?.sections.flatMap((section) => section.artboards).find((board) => board.id === selected) ?? null);
  const folder = shown?.entry.relative ?? read?.entry.relative ?? "";
  const handoff =
    onInsertText && lastGood
      ? {
          blockedReason: insertBlockedReason,
          canPick: selectedBoard?.group != null,
          onPick: () => selectedBoard && onInsertText(pickMessage(lastGood, folder, selectedBoard)),
          onBuild: () => selectedBoard && onInsertText(buildMessage(folder, selectedBoard)),
          onBuildSection: (id: string) => {
            const section = lastGood.sections.find((candidate) => candidate.id === id);
            if (section) onInsertText(buildSectionMessage(lastGood, folder, section));
          },
        }
      : undefined;
  const exportArtboards = (scope: ExportScope, format: ExportFormat) => {
    if (scope === "selected" && selected === null) return;
    const artboardIds = scope === "selected" ? [selected] : null;
    setIsExporting(true);
    invoke("canvas_export", { sessionId, key: canvasKey, artboardIds, format })
      .then((answer) => {
        const outcome = parseExportOutcome(answer);
        if (outcome === null) return;
        const { message, tone } = exportNotice(outcome, lastGood);
        if (onNotice) onNotice(message, tone);
        else onError(message);
      })
      .catch((error: unknown) => onError(typeof error === "string" ? error : COULD_NOT_EXPORT))
      .finally(() => setIsExporting(false));
  };
  const isFolderGone = read?.error === FOLDER_NOT_FOUND;
  const reloadCanvas = () => {
    // A new view starts with comment mode off; the button must say so too.
    if (comments?.isCommenting) comments.setCommenting(false);
    setReload((count) => count + 1);
  };
  const error = read?.error && !isFolderGone ? read.error : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CanvasHeader
        title={title}
        count={count}
        sections={lastGood?.sections ?? []}
        zoom={canvas.zoom}
        selectedTitle={selectedTitle}
        onBack={onBack}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onCommand={command}
        onMenuOpen={setIsMenuOpen}
        handoff={handoff}
        onReload={shown !== null && !isFolderGone ? reloadCanvas : undefined}
        exporting={shown !== null && !isFolderGone ? { isExporting, onExport: exportArtboards } : undefined}
        commenting={
          comments && shown !== null
            ? {
                isCommenting: comments.isCommenting,
                setCommenting: comments.setCommenting,
                onCommentOnArtboard: () => selected !== null && comments.startArtboardComment(selected),
              }
            : undefined
        }
      />
      {error !== null && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-attention-border bg-attention-surface px-3 py-2 text-ui-sm text-fg">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-status-attention" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="break-words">
              <span className="font-mono">canvas.json</span>
              {` could not be read: ${error}`}
            </span>
            <span className="text-fg-muted">
              {shown === null ? "It shows once the agent fixes the file." : "You see the last layout that could be read. It updates when the agent fixes the file."}
            </span>
          </span>
        </div>
      )}
      {isFolderGone ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
          <span className="text-ui font-semibold text-fg">Folder not found</span>
          <span className="text-ui text-fg-muted">The canvas's folder was moved or deleted.</span>
        </div>
      ) : shown !== null ? (
        <ArtifactPageBox
          target={{ kind: "canvas", sessionId, key: canvasKey, reload }}
          title={`The canvas ${title}`}
          isCovered={isMenuOpen || isCovered}
          onError={onError}
        />
      ) : (
        <div className="min-h-0 flex-1" />
      )}
      {comments && addReview && shown?.canvas && !isFolderGone && (
        <ArtifactCommentStrip
          canvasSource={{ entry: shown.entry, canvas: shown.canvas, boards: shown.boards }}
          cwd={cwd ?? ""}
          comments={comments}
          addReview={addReview}
        />
      )}
    </div>
  );
}
