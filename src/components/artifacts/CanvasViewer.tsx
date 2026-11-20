import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle } from "lucide-react";
import { useCanvas } from "../../hooks/useCanvas";
import { enqueueArtifactViewCall } from "../../hooks/useArtifactView";
import { useLatest } from "../../hooks/useLatest";
import { artboardCount, canvasShellState } from "../../lib/canvas";
import { ArtifactPageBox } from "./ArtifactPageBox";
import { CanvasHeader } from "./CanvasHeader";

export interface CanvasViewerProps {
  sessionId: string;
  canvasKey: string;
  /** Moves when one of the session's turns ends, so the canvas is read again. */
  turnsEnded?: number;
  /** Each artboard's picture, by artboard id, for the artboards not drawn live. */
  thumbs?: ReadonlyMap<string, string>;
  /** Back to the Output list; absent when there is no list to go back to. */
  onBack?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
  /** Something of the viewer's parent is open over the canvas. */
  isCovered?: boolean;
}

/** What the backend says when the canvas's folder, or the session folder it was shown from, is gone. */
const FOLDER_NOT_FOUND = "Folder not found";
const NO_PICTURES: ReadonlyMap<string, string> = new Map();
const COULD_NOT_SHOW = "Zorvo could not show that canvas.";

/**
 * A canvas in the artifact view: Zorvo's wrapper page in the same native view a page uses, told what
 * to show with `canvas_view_apply` whenever the canvas, its files or its pictures change, and driven by
 * the header's commands. A `canvas.json` that cannot be read keeps the last layout under a bar.
 */
export function CanvasViewer({ sessionId, canvasKey, turnsEnded, thumbs = NO_PICTURES, onBack, isExpanded, onToggleExpanded, onError, isCovered = false }: CanvasViewerProps) {
  const canvas = useCanvas(sessionId, canvasKey, turnsEnded);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const onErrorRef = useLatest(onError);
  const { shown, read, selected, lastGood } = canvas;

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
  const isFolderGone = read?.error === FOLDER_NOT_FOUND;
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
          target={{ kind: "canvas", sessionId, key: canvasKey }}
          title={`The canvas ${title}`}
          isCovered={isMenuOpen || isCovered}
          onError={onError}
        />
      ) : (
        <div className="min-h-0 flex-1" />
      )}
    </div>
  );
}
