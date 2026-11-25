import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, Download, Maximize2, Minimize2, MoreHorizontal, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import { SEGMENTED_TRACK, segmentedItem } from "../ui/segmented-style";
import { useMotion, usePlayhead } from "../../hooks/useMotion";
import { formatClock, isOpenJob, jobLine, type FormatState } from "../../lib/motion";
import type { ViewedArtifact } from "../../lib/artifacts";
import { ArtifactPageBox } from "./ArtifactPageBox";

export interface MotionViewerProps {
  sessionId: string;
  motionKey: string;
  title: string;
  turnsEnded?: number;
  onBack?: () => void;
  onView: (view: ViewedArtifact | null) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
}

type Open = "export" | "more" | null;
/** What the box shows: the live preview, or the rendered MP4 of a format. */
type Shown = { kind: "preview" } | { kind: "render"; format: string };

const failure = (error: unknown, fallback: string) => (typeof error === "string" && error !== "" ? error : fallback);

function renderState(format: FormatState): string {
  if (!format.hasRender) return "Not rendered";
  return format.isUpToDate ? "Rendered" : "Out of date";
}

/** A format's rendered MP4, played in Zorvo's own document through `zorvo-media`. */
function RenderedVideo({ sessionId, motionKey, format, title, onError }: { sessionId: string; motionKey: string; format: string; title: string; onError: (message: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let isGone = false;
    invoke<string>("media_url_for_render", { sessionId, key: motionKey, format })
      .then((answer) => {
        if (!isGone && typeof answer === "string") setUrl(answer);
      })
      .catch((error) => onError(failure(error, "Zorvo could not play that video.")));
    return () => {
      isGone = true;
    };
  }, [sessionId, motionKey, format, onError]);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-2 p-2.5">
      {url && <video key={url} src={url} controls aria-label={`${title}, ${format}`} className="max-h-full max-w-full rounded-md" />}
    </div>
  );
}

/** A motion an agent made: its live preview with a play head, its formats, its renders and Export. */
export function MotionViewer({ sessionId, motionKey, title, turnsEnded, onBack, onView, isExpanded, onToggleExpanded, onError }: MotionViewerProps) {
  const { read, error, jobs } = useMotion(sessionId, motionKey, turnsEnded);
  const [open, setOpen] = useState<Open>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: "preview" });
  const [isMuted, setIsMuted] = useState(false);
  const duration = read?.duration ?? 0;
  const playhead = usePlayhead(duration);
  const formats = read?.formats ?? [];
  const current = format && formats.some((listed) => listed.id === format) ? format : (formats[0]?.id ?? null);
  const name = read?.title ?? title;

  const command = (commandName: string, value?: number) => {
    invoke("motion_view_command", { sessionId, key: motionKey, name: commandName, ...(value === undefined ? {} : { value }) }).catch(() => undefined);
  };
  const togglePlay = () => {
    if (playhead.isPlaying) {
      playhead.pause();
      command("pause");
    } else {
      playhead.play();
      command("play");
    }
  };
  const seekTo = (t: number) => {
    playhead.seek(t);
    command("seek", t);
  };
  const chooseFormat = (id: string) => {
    setFormat(id);
    setShown({ kind: "preview" });
    playhead.seek(0);
    if (playhead.isPlaying) playhead.pause();
  };
  const toggleMute = () => {
    command(isMuted ? "unmute" : "mute");
    setIsMuted(!isMuted);
  };
  const exportFormats = (id: string | null) => {
    setOpen(null);
    invoke("motion_export", { sessionId, key: motionKey, format: id }).catch((answer) => onError(failure(answer, "Zorvo could not export the video.")));
  };
  const remove = () => {
    setOpen(null);
    invoke("media_forget", { sessionId, key: motionKey })
      .then(() => onView(null))
      .catch((answer) => onError(failure(answer, "Zorvo could not remove the motion.")));
  };

  const openJob = jobs.find(isOpenJob);
  const lastJob = openJob ?? jobs[jobs.length - 1];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {onBack && !isExpanded && (
          <Button variant="ghost" size="sm" tone="secondary" aria-label="Back to artifacts" onClick={onBack} className="gap-0.5 pl-1">
            <ChevronLeft size={14} aria-hidden="true" />
            Artifacts
          </Button>
        )}
        <h3 title={name} className="min-w-0 flex-1 truncate pl-1 text-ui font-semibold text-fg">
          {name}
        </h3>
        {formats.length > 1 && (
          <div role="radiogroup" aria-label="Format" className={SEGMENTED_TRACK}>
            {formats.map((listed) => (
              <button
                key={listed.id}
                type="button"
                role="radio"
                aria-checked={listed.id === current && shown.kind === "preview"}
                onClick={() => chooseFormat(listed.id)}
                className={segmentedItem(listed.id === current && shown.kind === "preview")}
              >
                {listed.id}
              </button>
            ))}
          </div>
        )}
        <IconButton label={isExpanded ? "Shrink" : "Expand"} size="row" onClick={onToggleExpanded}>
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <Popover
          isOpen={open === "export"}
          onClose={() => setOpen(null)}
          label="Export video"
          align="end"
          className="w-60"
          trigger={
            <IconButton label="Export" size="row" disabled={!read || formats.length === 0} aria-haspopup="menu" aria-expanded={open === "export"} onClick={() => setOpen(open === "export" ? null : "export")}>
              <Download size={14} />
            </IconButton>
          }
        >
          {current && <PopoverOption onSelect={() => exportFormats(current)}>{`This format (${current}) as MP4`}</PopoverOption>}
          {formats.length > 1 && <PopoverOption onSelect={() => exportFormats(null)}>All formats as MP4</PopoverOption>}
        </Popover>
        <Popover
          isOpen={open === "more"}
          onClose={() => setOpen(null)}
          label="More actions"
          align="end"
          className="w-44"
          trigger={
            <IconButton label="More actions" size="row" aria-haspopup="menu" aria-expanded={open === "more"} onClick={() => setOpen(open === "more" ? null : "more")}>
              <MoreHorizontal size={14} />
            </IconButton>
          }
        >
          <PopoverOption onSelect={remove}>Remove from Output</PopoverOption>
        </Popover>
      </div>
      {error && <p className="px-4 py-3 text-ui-sm text-fg-muted">Zorvo could not read this motion. Its folder may have moved.</p>}
      {read?.error && <p className="px-4 py-3 text-ui-sm text-status-attention">{`motion.json: ${read.error}`}</p>}
      {read && current && !read.error && (
        <>
          {shown.kind === "preview" ? (
            <ArtifactPageBox target={{ kind: "motion", sessionId, key: motionKey, format: current }} title={name} isCovered={open !== null} onError={onError} />
          ) : (
            <RenderedVideo sessionId={sessionId} motionKey={motionKey} format={shown.format} title={name} onError={onError} />
          )}
          {shown.kind === "preview" && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 py-1.5">
              <IconButton label={playhead.isPlaying ? "Pause" : "Play"} size="row" onClick={togglePlay}>
                {playhead.isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </IconButton>
              <span className="shrink-0 font-mono text-caption tabular-nums text-fg-muted">{`${formatClock(playhead.time)} / ${formatClock(duration)}`}</span>
              <input
                type="range"
                aria-label="Play head"
                min={0}
                max={duration}
                step={read.fps > 0 ? 1 / read.fps : 0.01}
                value={playhead.time}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="focus-ring min-w-0 flex-1 cursor-pointer accent-fg"
              />
              {read.tracks > 0 && (
                <IconButton label={isMuted ? "Unmute" : "Mute"} size="row" aria-pressed={isMuted} onClick={toggleMute}>
                  {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </IconButton>
              )}
            </div>
          )}
          <div className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-2">
            <p className="text-caption text-fg-subtle">Preview has no motion blur. Exports do.</p>
            <p role="status" className="text-caption text-fg-muted">
              {lastJob ? (lastJob.state === "failed" && lastJob.error ? `${jobLine(lastJob)}: ${lastJob.error}` : jobLine(lastJob)) : ""}
            </p>
            <ul aria-label="Rendered videos" className="flex flex-col">
              {formats.map((listed) => (
                <li key={listed.id} className="flex items-center gap-2 py-0.5 text-ui-sm">
                  <span className="min-w-0 flex-1 truncate text-fg-secondary">{`${listed.id} · ${listed.width} × ${listed.height}`}</span>
                  <span className={listed.hasRender && !listed.isUpToDate ? "text-status-attention" : "text-fg-subtle"}>{renderState(listed)}</span>
                  {listed.hasRender &&
                    (shown.kind === "render" && shown.format === listed.id ? (
                      <Button variant="ghost" size="sm" onClick={() => setShown({ kind: "preview" })}>
                        Back to preview
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" aria-label={`Play the ${listed.id} video`} onClick={() => setShown({ kind: "render", format: listed.id })}>
                        Play video
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
