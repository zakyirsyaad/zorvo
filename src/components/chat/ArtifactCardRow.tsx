import { Button } from "../ui/Button";
import { ArtifactMark } from "../artifacts/ArtifactsPanel";
import { canvasCountLabel } from "../../lib/canvas";
import type { ArtifactCard } from "../../types";

export interface ArtifactCardRowProps {
  card: ArtifactCard;
  /** Removed once the artifact was deleted: the row stays as a record, with nothing to open. */
  state: "open" | "removed";
  /** Shows that version in the Artifacts tab; absent where there is no tab (a popout). */
  onOpen?: (card: ArtifactCard) => void;
}

/**
 * Zorvo's own row in the chat where the agent showed a page (its title, the version shown then, and
 * Open) or a canvas (its title and how many artboards it had then).
 */
export function ArtifactCardRow({ card, state, onOpen }: ArtifactCardRowProps) {
  const isRemoved = state === "removed";
  const detail = card.kind === "canvas" ? canvasCountLabel(card.artboards) : `Version ${card.version}`;
  const openLabel = card.kind === "canvas" ? `Open the canvas ${card.title}` : `Open ${card.title}, version ${card.version}`;
  return (
    <div data-artifact-card="" className="flex items-center gap-3 rounded-panel border border-border bg-surface-2 py-2.5 pr-2.5 pl-3">
      <ArtifactMark kind={card.kind === "canvas" ? "canvas" : "page"} />
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
