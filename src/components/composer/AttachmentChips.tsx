import { useState } from "react";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import { fileNameOf, isImagePath } from "../../lib/attachments";
import { useAttachmentPreview } from "../../hooks/useAttachmentPreview";
import { ImagePreviewDialog } from "./ImagePreviewDialog";

export interface AttachmentChipsProps {
  paths: readonly string[];
  /** Shows a remove button on each attachment when given. */
  onRemove?: (path: string) => void;
}

const REMOVE_PLACEMENTS = {
  // An 18px circle inside the thumbnail's corner, as the canvas draws it.
  inside: "absolute right-1 top-1 flex size-4.5 items-center justify-center rounded-full border border-border bg-surface-3 text-fg-secondary hover:text-fg focus-ring",
  inline: "rounded-full bg-surface-3 text-fg-subtle hover:text-fg focus-ring",
} as const;

/** The remove button shared by a thumbnail (inside it) and a chip (after its name). */
function RemoveButton({ name, onRemove, placement = "inline" }: { name: string; onRemove: () => void; placement?: keyof typeof REMOVE_PLACEMENTS }) {
  return (
    <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className={REMOVE_PLACEMENTS[placement]}>
      <X size={placement === "inside" ? 10 : 12} />
    </button>
  );
}

/** An image attachment: its picture when it can be read, a chip when it cannot. */
function ImageAttachment({
  path,
  onRemove,
  onOpen,
}: {
  path: string;
  onRemove?: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const preview = useAttachmentPreview(path);
  const name = fileNameOf(path);

  if (preview.status === "ready") {
    return (
      <li title={path} className="relative">
        <button
          type="button"
          aria-label={`Open ${name}`}
          aria-haspopup="dialog"
          onClick={() => onOpen(path)}
          className="block overflow-hidden rounded-lg border border-border bg-ground focus-ring"
        >
          <img src={preview.src} alt={name} className="h-16 w-24 object-cover" />
        </button>
        {onRemove && <RemoveButton name={name} placement="inside" onRemove={() => onRemove(path)} />}
      </li>
    );
  }

  return (
    <li
      title={path}
      aria-busy={preview.status === "loading"}
      className="flex items-center gap-1 rounded-md bg-chip px-2 py-0.5 text-caption text-fg-secondary"
    >
      <ImageIcon size={11} className="text-fg-subtle" />
      <span className="max-w-48 truncate">{name}</span>
      {preview.status === "failed" && <span className="text-fg-subtle">Image not found</span>}
      {onRemove && <RemoveButton name={name} onRemove={() => onRemove(path)} />}
    </li>
  );
}

/** Files attached to a message, by name: images as thumbnails, other files as chips. */
export function AttachmentChips({ paths, onRemove }: AttachmentChipsProps) {
  const [openPath, setOpenPath] = useState<string | null>(null);

  return (
    <>
      <ul aria-label="Attachments" className="flex flex-wrap items-center gap-1.5">
        {paths.map((path) => {
          if (isImagePath(path)) {
            return <ImageAttachment key={path} path={path} onRemove={onRemove} onOpen={setOpenPath} />;
          }
          const name = fileNameOf(path);
          return (
            <li
              key={path}
              title={path}
              className="flex items-center gap-1 rounded-md bg-chip px-2 py-0.5 text-caption text-fg-secondary"
            >
              <FileText size={11} className="text-fg-subtle" />
              <span className="max-w-48 truncate">{name}</span>
              {onRemove && <RemoveButton name={name} onRemove={() => onRemove(path)} />}
            </li>
          );
        })}
      </ul>
      {openPath && <ImagePreviewDialog path={openPath} onClose={() => setOpenPath(null)} />}
    </>
  );
}