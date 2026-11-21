import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Maximize2 } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { VisualDialog } from "./VisualDialog";
import { VisualFrame } from "./VisualFrame";
import { VisualMenu } from "./VisualMenu";
import { useNearScreen } from "../../hooks/useNearScreen";
import { useVisualDocument } from "../../hooks/useVisualDocument";
import { escapeVisible } from "../../lib/visible-text";
import type { ChatMessagePart } from "../../types";

export type VisualPart = Extract<ChatMessagePart, { kind: "visual" }>;

export interface VisualBlockProps {
  /** The session that holds the visual. Absent in a popout, which shows the title only. */
  sessionId?: string;
  part: VisualPart;
  agentName: string;
  /** True for a visual that arrives while you watch; history does not fade in. */
  isArriving?: boolean;
}

/** The hairline Zorvo draws around what an agent drew, so it never reads as Zorvo's own interface. */
const FRAME = "rounded-[10px] border border-border";
const NOTE = `${FRAME} flex items-center gap-3 px-4 py-3.5 text-ui text-fg-muted`;

/** A picture an agent put in its reply: Zorvo's header and frame around a document that cannot run. */
export function VisualBlock({ sessionId, part, agentName, isArriving = false }: VisualBlockProps) {
  const blockRef = useRef<HTMLDivElement>(null);
  const isNear = useNearScreen(blockRef);
  const visual = useVisualDocument(sessionId, part.id, isNear);
  const [isFolded, setIsFolded] = useState(false);
  const [height, setHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  // The frame box has 20px of padding on each side; the picture is drawn at the document's own width.
  const sizeOf = () => ({ width: (frameBoxRef.current?.clientWidth ?? 0) - 40, height });
  const closeDialog = () => {
    setIsExpanded(false);
    expandRef.current?.focus();
  };
  const title = escapeVisible(part.title);
  const isMainWindow = sessionId !== undefined;
  const isShown = visual.status === "ready";

  return (
    <div ref={blockRef} data-visual={part.id} className={`flex flex-col gap-1.5 select-none ${isArriving ? "motion-safe:animate-appear" : ""}`}>
      <div className="flex h-7 items-center gap-2">
        <span className="min-w-0 truncate text-ui-sm font-medium text-fg">{title}</span>
        <span className="shrink-0 text-caption text-fg-subtle">{isMainWindow ? `${agentName} made this visual` : "Shown in the main window."}</span>
        {/* What a copy or a download did. Always mounted, so a screen reader hears it change. */}
        <span aria-live="polite" data-testid="visual-status" className="min-w-0 flex-1 truncate text-right text-caption text-fg-muted">
          {status}
        </span>
        {isShown && (
          <IconButton ref={expandRef} size="sm" label="Expand" aria-haspopup="dialog" onClick={() => setIsExpanded(true)}>
            <Maximize2 size={14} aria-hidden="true" />
          </IconButton>
        )}
        {isShown && (
          <IconButton size="sm" label={isFolded ? "Unfold visual" : "Fold visual"} aria-expanded={!isFolded} onClick={() => setIsFolded((folded) => !folded)}>
            {isFolded ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </IconButton>
        )}
        {isShown && sessionId !== undefined && <VisualMenu sessionId={sessionId} id={part.id} kind={part.visualKind} sizeOf={sizeOf} onStatus={setStatus} />}
      </div>
      {isMainWindow && !isFolded && (
        <>
          {(visual.status === "idle" || visual.status === "loading") && (
            <div role="status" className={`${FRAME} flex items-center justify-center text-ui-sm text-fg-subtle`} style={{ height: height || 120 }}>
              Loading visual
            </div>
          )}
          {visual.status === "gone" && <div className={NOTE}>This visual is no longer available.</div>}
          {visual.status === "failed" && (
            <div className={NOTE}>
              <span className="flex-1">Zorvo could not show this visual.</span>
              <Button variant="outline" size="sm" onClick={visual.retry}>
                Try again
              </Button>
            </div>
          )}
          {visual.status === "ready" &&
            (isNear ? (
              <div ref={frameBoxRef} className={`${FRAME} overflow-hidden p-5`}>
                <VisualFrame document={visual.document} title={title} initialHeight={height} onHeight={setHeight} />
              </div>
            ) : (
              // Off screen the frame is unmounted; its place keeps the height so the chat does not jump.
              <div className={FRAME} aria-hidden="true">
                <div data-testid="visual-placeholder" className="m-5" style={{ height }} />
              </div>
            ))}
        </>
      )}
      {isExpanded && visual.status === "ready" && <VisualDialog title={title} document={visual.document} onClose={closeDialog} />}
    </div>
  );
}
