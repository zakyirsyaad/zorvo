import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAttachmentPreview } from "../../hooks/useAttachmentPreview";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { fileNameOf } from "../../lib/attachments";
import { formatSize } from "../../lib/file-content";
import { IconButton } from "../ui/IconButton";

export interface ImagePreviewDialogProps {
  path: string;
  /** The file's size, when the caller knows it; the meta line then ends with it. */
  bytes?: number;
  onClose: () => void;
}

/** "1280 × 800 · 214 KB": the picture's own size once it has loaded, then the file's when known. */
function metaLine(size: { width: number; height: number } | null, bytes: number | undefined): string | null {
  if (!size) return null;
  const dimensions = `${size.width} × ${size.height}`;
  return bytes === undefined ? dimensions : `${dimensions} · ${formatSize(bytes)}`;
}

/** An attached image at full size, over the app, until it is closed. */
export function ImagePreviewDialog({ path, bytes, onClose }: ImagePreviewDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const preview = useAttachmentPreview(path);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const name = fileNameOf(path);
  const meta = metaLine(size, bytes);
  useFocusTrap(dialogRef);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full max-w-[520px] flex-col rounded-xl border border-border bg-surface-2 text-fg-secondary shadow-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 py-2.5 pr-3 pl-4">
          <div className="flex min-w-0 flex-col">
            <h2 id={titleId} className="truncate text-ui font-medium text-fg" title={path}>
              {name}
            </h2>
            {meta && <p className="text-caption text-fg-subtle">{meta}</p>}
          </div>
          <IconButton ref={closeRef} label="Close preview" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="mx-3 mb-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-ground">
          {preview.status === "ready" ? (
            <img
              src={preview.src}
              alt={name}
              onLoad={(event) =>
                setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              }
              className="max-h-[70vh] max-w-full object-contain"
            />
          ) : (
            <p className="px-4 py-10 text-caption text-fg-subtle">
              {preview.status === "failed" ? "Image not found" : "Loading…"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
