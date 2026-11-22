import { useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronLeft, Download, Maximize2, MessageSquarePlus, Minimize2, MoreHorizontal, RotateCw } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import { RenameField } from "../ui/RenameField";
import { hasVersion, newestVersion, versionLabel, type ViewedArtifact } from "../../lib/artifacts";
import { formatShortTime } from "../../lib/relative-time";
import type { Artifact } from "../../types";
import type { ArtifactCommentsState } from "../../hooks/useArtifactComments";
import type { AddArtifactReview } from "../../hooks/useReviewWiring";
import { ArtifactCommentStrip } from "./ArtifactCommentStrip";
import { ArtifactPageBox } from "./ArtifactPageBox";

export interface ArtifactViewerProps {
  sessionId: string;
  artifact: Artifact;
  /** The version shown; null follows the newest. */
  version: number | null;
  /** Back to the list; absent when there is no list to go back to. */
  onBack?: () => void;
  onView: (view: ViewedArtifact | null) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
  /** The session's artifact comments; absent (a popout), no Comment button and no strip. */
  comments?: ArtifactCommentsState;
  addReview?: AddArtifactReview;
  /** The session's folder, for the source path in a comment's message. */
  cwd?: string;
}

const NEWEST_ONLY = "Comments go on the newest version.";

type Open = "versions" | "export" | "more" | null;

const failure = (error: unknown, fallback: string) => (typeof error === "string" && error !== "" ? error : fallback);

/** One artifact's page with what can be done to it: versions, reload, expand, export, rename, delete. */
export function ArtifactViewer({ sessionId, artifact, version, onBack, onView, isExpanded, onToggleExpanded, onError, comments, addReview, cwd }: ArtifactViewerProps) {
  const [open, setOpen] = useState<Open>(null);
  const [reload, setReload] = useState(0);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const newest = newestVersion(artifact);
  const shown = version ?? newest;
  const isStored = hasVersion(artifact, shown);
  const isOlder = shown !== newest;
  const label = versionLabel(shown, artifact);
  const toggle = (which: Exclude<Open, null>) => setOpen((current) => (current === which ? null : which));
  const olderReasonId = useId();
  const reloadPage = () => {
    // A new view starts with comment mode off; the button must say so too.
    if (comments?.isCommenting) comments.setCommenting(false);
    setReload((count) => count + 1);
  };

  const rename = (name: string | null) => {
    setIsRenaming(false);
    const title = name?.trim() ?? "";
    if (title === "" || title === artifact.title) return;
    invoke("artifact_rename", { sessionId, artifactId: artifact.id, title }).catch((error) =>
      onError(failure(error, "Zorvo could not rename the artifact.")),
    );
  };

  const remove = () => {
    setIsConfirmingDelete(false);
    invoke("artifact_delete", { sessionId, artifactId: artifact.id })
      .then(() => onView(null))
      .catch((error) => onError(failure(error, "Zorvo could not delete the artifact.")));
  };

  const save = () => {
    setOpen(null);
    invoke("artifact_export", { sessionId, artifactId: artifact.id, version: shown }).catch((error) =>
      onError(failure(error, "Zorvo could not save that file.")),
    );
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
        {isRenaming ? (
          <RenameField value={artifact.title} label={`Rename ${artifact.title}`} onDone={rename} className="min-w-0 flex-1" />
        ) : (
          <h3 title={artifact.title} className="min-w-0 flex-1 truncate pl-1 text-ui font-semibold text-fg">
            {artifact.title}
          </h3>
        )}
        {isOlder && <span className="shrink-0 whitespace-nowrap text-caption text-status-attention">Older version</span>}
        <Popover
          isOpen={open === "versions"}
          onClose={() => setOpen(null)}
          label="Versions"
          align="end"
          className="w-64"
          trigger={
            <Chip label={label} aria-haspopup="menu" aria-expanded={open === "versions"} onClick={() => toggle("versions")} className="shrink-0 whitespace-nowrap">
              {label}
              <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
            </Chip>
          }
        >
          {[...artifact.versions].reverse().map((listed) => (
            <PopoverOption
              key={listed.n}
              isRadio
              selected={listed.n === shown}
              trailing={listed.n === newest ? `${formatShortTime(listed.at)} · newest` : formatShortTime(listed.at)}
              onSelect={() => {
                setOpen(null);
                onView({ artifactId: artifact.id, version: listed.n === newest ? null : listed.n });
              }}
            >
              {`Version ${listed.n}`}
            </PopoverOption>
          ))}
        </Popover>
        <IconButton label="Reload" size="row" disabled={!isStored} onClick={reloadPage}>
          <RotateCw size={14} />
        </IconButton>
        {comments && (
          <IconButton
            label="Comment"
            size="row"
            aria-pressed={comments.isCommenting}
            disabled={isOlder || !isStored}
            title={isOlder ? NEWEST_ONLY : "Comment"}
            aria-describedby={isOlder ? olderReasonId : undefined}
            onClick={() => comments.setCommenting(!comments.isCommenting)}
          >
            <MessageSquarePlus size={14} />
          </IconButton>
        )}
        {comments && isOlder && (
          <span id={olderReasonId} className="sr-only">
            {NEWEST_ONLY}
          </span>
        )}
        <IconButton label={isExpanded ? "Shrink" : "Expand"} size="row" onClick={onToggleExpanded}>
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <Popover
          isOpen={open === "export"}
          onClose={() => setOpen(null)}
          label="Export this page"
          role="dialog"
          align="end"
          className="w-72"
          trigger={
            <IconButton label="Export" size="row" disabled={!isStored} aria-haspopup="dialog" aria-expanded={open === "export"} onClick={() => toggle("export")}>
              <Download size={14} />
            </IconButton>
          }
        >
          <div className="flex flex-col gap-1 p-2">
            <span className="text-ui font-semibold text-fg">Export this page</span>
            <span className="text-ui-sm text-fg-muted">
              {`Saves Version ${shown} as one HTML file. An exported page opens in a browser without Zorvo's limits.`}
            </span>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={save}>
                Choose where to save
              </Button>
            </div>
          </div>
        </Popover>
        <Popover
          isOpen={open === "more"}
          onClose={() => setOpen(null)}
          label="More actions"
          align="end"
          className="w-44"
          trigger={
            <IconButton label="More actions" size="row" aria-haspopup="menu" aria-expanded={open === "more"} onClick={() => toggle("more")}>
              <MoreHorizontal size={14} />
            </IconButton>
          }
        >
          <PopoverOption
            onSelect={() => {
              setOpen(null);
              setIsRenaming(true);
            }}
          >
            Rename
          </PopoverOption>
          <PopoverOption
            onSelect={() => {
              setOpen(null);
              setIsConfirmingDelete(true);
            }}
          >
            <span className="text-danger">Delete artifact</span>
          </PopoverOption>
        </Popover>
      </div>
      {isStored ? (
        <ArtifactPageBox
          target={{ sessionId, artifactId: artifact.id, version: shown, reload }}
          title={artifact.title}
          isCovered={open !== null}
          onError={onError}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
          <span className="text-ui font-semibold text-fg">This version is no longer on this Mac.</span>
          <span className="text-ui text-fg-muted">Choose another version above.</span>
        </div>
      )}
      {comments && addReview && (
        <ArtifactCommentStrip artifact={artifact} shownVersion={shown} cwd={cwd ?? ""} comments={comments} addReview={addReview} />
      )}
      {isConfirmingDelete && (
        <div role="alertdialog" aria-label="Delete artifact" className="flex shrink-0 flex-col gap-2.5 border-t border-border bg-surface-2 px-3.5 pt-3 pb-3.5">
          <span className="text-ui text-fg">Delete this artifact and its versions? This cannot be undone.</span>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={remove}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
