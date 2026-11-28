import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, Maximize2, Minimize2, MoreHorizontal } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import type { ViewedArtifact } from "../../lib/artifacts";
import type { VideoEntry } from "../../lib/motion";

export interface VideoViewerProps {
  sessionId: string;
  video: VideoEntry;
  onBack?: () => void;
  onView: (view: ViewedArtifact | null) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
}

const failure = (error: unknown, fallback: string) => (typeof error === "string" && error !== "" ? error : fallback);

/**
 * A video file an agent showed (a Remotion render, say), played in Zorvo's own document. The file
 * stays where it is; `zorvo-media` serves it by a token, never by its path.
 */
export function VideoViewer({ sessionId, video, onBack, onView, isExpanded, onToggleExpanded, onError }: VideoViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    let isGone = false;
    setUrl(null);
    setIsMissing(false);
    invoke<string>("media_url_for_video", { sessionId, key: video.key })
      .then((answer) => {
        if (!isGone && typeof answer === "string") setUrl(answer);
      })
      .catch(() => {
        if (!isGone) setIsMissing(true);
      });
    return () => {
      isGone = true;
    };
  }, [sessionId, video.key]);

  const remove = () => {
    setIsMenuOpen(false);
    invoke("media_forget", { sessionId, key: video.key })
      .then(() => onView(null))
      .catch((error) => onError(failure(error, "Zorvo could not remove the video.")));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {onBack && !isExpanded && (
          <Button variant="ghost" size="sm" tone="secondary" aria-label="Back to artifacts" onClick={onBack} className="gap-0.5 pl-1">
            <ChevronLeft size={14} aria-hidden="true" />
            Artifacts
          </Button>
        )}
        <h3 title={video.relative} className="min-w-0 flex-1 truncate pl-1 text-ui font-semibold text-fg">
          {video.title}
        </h3>
        <IconButton label={isExpanded ? "Shrink" : "Expand"} size="row" onClick={onToggleExpanded}>
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <Popover
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          label="More actions"
          align="end"
          className="w-44"
          trigger={
            <IconButton label="More actions" size="row" aria-haspopup="menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(!isMenuOpen)}>
              <MoreHorizontal size={14} />
            </IconButton>
          }
        >
          <PopoverOption onSelect={remove}>Remove from Output</PopoverOption>
        </Popover>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-2 p-2.5">
        {isMissing ? (
          <p className="text-ui-sm text-fg-muted">{`Zorvo cannot play ${video.relative}. The file may have moved or changed.`}</p>
        ) : (
          url && <video key={url} src={url} controls aria-label={video.title} className="max-h-full max-w-full rounded-md" />
        )}
      </div>
      <p className="shrink-0 truncate border-t border-border px-3 py-2 text-caption text-fg-subtle">{video.relative}</p>
    </div>
  );
}
