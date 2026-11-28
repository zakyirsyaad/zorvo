import { Button } from "../ui/Button";
import { ArtifactMark, designSystemDetail } from "../artifacts/ArtifactsPanel";
import { canvasCountLabel } from "../../lib/canvas";
import { motionDetail } from "../../lib/motion";
import type { ArtifactCard } from "../../types";

export interface ArtifactCardRowProps {
  card: ArtifactCard;
  /** Removed once the artifact was deleted: the row stays as a record, with nothing to open. */
  state: "open" | "removed";
  /** Shows that version in the Artifacts tab; absent where there is no tab (a popout). */
  onOpen?: (card: ArtifactCard) => void;
}

function detailOf(card: ArtifactCard): string {
  switch (card.kind) {
    case "canvas":
      return canvasCountLabel(card.artboards);
    case "motion":
      return motionDetail(card.duration, card.formats);
    case "video":
      return "Video file";
    case "design-system":
      return `Design system · ${designSystemDetail(card)}`;
    default:
      return `Version ${card.version}`;
  }
}

function openLabelOf(card: ArtifactCard): string {
  switch (card.kind) {
    case "canvas":
      return `Open the canvas ${card.title}`;
    case "motion":
    case "video":
      return `Open the video ${card.title}`;
    case "design-system":
      return `Open the design system ${card.title}`;
    default:
      return `Open ${card.title}, version ${card.version}`;
  }
}

function markOf(card: ArtifactCard): "page" | "canvas" | "video" | "design-system" {
  if (card.kind === "canvas" || card.kind === "design-system") return card.kind;
  return card.kind === "motion" || card.kind === "video" ? "video" : "page";
}

/**
 * Zorvo's own row in the chat where the agent showed a page (its title, the version shown then, and
 * Open), a canvas (its title and how many artboards it had then), or a motion or video (its length).
 */
export function ArtifactCardRow({ card, state, onOpen }: ArtifactCardRowProps) {
  const isRemoved = state === "removed";
  const detail = detailOf(card);
  const openLabel = openLabelOf(card);
  return (
    <div data-artifact-card="" className="flex items-center gap-3 rounded-panel border border-border bg-surface-2 py-2.5 pr-2.5 pl-3">
      <ArtifactMark kind={markOf(card)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-ui ${isRemoved ? "text-fg-muted" : "font-medium text-fg"}`}>{card.title}</span>
        <span className="text-caption text-fg-subtle">{detail}</span>
      </span>
      {isRemoved ? (
        <span className="shrink-0 pr-1.5 text-ui-sm text-fg-subtle">Removed</span>
      ) : (
        onOpen && (
          <Button variant="outline" size="sm" aria-label={openLabel} onClick={() => onOpen(card)}>
            Open
          </Button>
        )
      )}
    </div>
  );
}
