import { useEffect, useRef, useState } from "react";
import { useFilePreviewBytes } from "../../hooks/useFilePreviewBytes";
import { formatSize, PREVIEW_LABEL, type PreviewMime } from "../../lib/file-content";
import { openPdf, type PdfDocument } from "../../lib/pdf-document";

export interface FilePreviewProps {
  rootPath: string;
  relativePath: string;
  mime: PreviewMime;
  size: number;
  /** Moves when the folder's changes are read again; the file is read again then. */
  version: number;
}

/** Narrower than this and a page would be unreadable; the pane scrolls sideways instead. */
const MIN_PAGE_WIDTH_PX = 240;
/** Page padding on each side, in the scroll area. */
const PAGE_GUTTER_PX = 16;
/** How far outside the scroll area a page starts drawing, so scrolling rarely shows a blank one. */
const DRAW_AHEAD_PX = 600;

const PREVIEW_FAILED = "This file could not be shown.";

function InfoBar({ children }: { children: string }) {
  return (
    <div className="flex h-8 shrink-0 items-center border-b border-border pr-3 pl-4 text-caption text-fg-subtle">
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function Notice({ children, isError = false }: { children: string; isError?: boolean }) {
  return (
    <p role={isError ? "alert" : undefined} className={`px-3 py-4 text-ui-sm ${isError ? "text-danger" : "text-fg-muted"}`}>
      {children}
    </p>
  );
}

/** A Blob URL for `bytes`, revoked when they change or the view goes away. */
function useBlobUrl(bytes: Uint8Array, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // Copied into a plain ArrayBuffer so the Blob never aliases a view the caller may reuse.
    const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, mime]);
  return url;
}

function ImagePreview({ bytes, mime, name, size }: { bytes: Uint8Array; mime: PreviewMime; name: string; size: number }) {
  const url = useBlobUrl(bytes, mime);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [isBroken, setIsBroken] = useState(false);
  const facts = [PREVIEW_LABEL[mime], dimensions, formatSize(size), "Read only"].filter(Boolean).join(" · ");
  return (
    <>
      <InfoBar>{facts}</InfoBar>
      {isBroken ? (
        <Notice isError>{PREVIEW_FAILED}</Notice>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-ground p-4">
          {url && (
            <img
              src={url}
              alt={name}
              onLoad={(event) => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`)}
              onError={() => setIsBroken(true)}
              // Fitted to the pane, never enlarged past its own size.
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
      )}
    </>
  );
}

/** One page, drawn when it comes near the scroll area. */
function PdfPage({
  doc,
  pageNumber,
  width,
  scrollRef,
  onError,
}: {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onError: (message: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNear, setIsNear] = useState(typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const frame = frameRef.current;
    if (isNear || !frame) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsNear(true);
      },
      { root: scrollRef.current, rootMargin: `${DRAW_AHEAD_PX}px 0px` },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [isNear, scrollRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isNear || !canvas) return;
    const render = doc.renderPage(pageNumber, canvas, width);
    render.done.catch((error: unknown) => onError(error instanceof Error ? error.message : PREVIEW_FAILED));
    return () => render.cancel();
  }, [doc, pageNumber, width, isNear, onError]);

  return (
    <div ref={frameRef} style={{ width, minHeight: Math.round(width * doc.firstPageRatio) }} className="shrink-0 bg-surface-2 shadow-popover">
      <canvas ref={canvasRef} role="img" aria-label={`Page ${pageNumber} of ${doc.pageCount}`} className="block" />
    </div>
  );
}

function PdfPreview({ bytes, name, size }: { bytes: Uint8Array; name: string; size: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    let opened: PdfDocument | null = null;
    openPdf(bytes).then(
      (next) => {
        if (isCancelled) return next.destroy();
        opened = next;
        setDoc(next);
      },
      (error: unknown) => {
        if (!isCancelled) setFailure(error instanceof Error && error.message ? error.message : PREVIEW_FAILED);
      },
    );
    return () => {
      isCancelled = true;
      opened?.destroy();
      setDoc(null);
    };
  }, [bytes]);

  useEffect(() => {
    const area = scrollRef.current;
    if (!area) return;
    const measure = () => setWidth(Math.max(MIN_PAGE_WIDTH_PX, Math.floor(area.clientWidth - PAGE_GUTTER_PX * 2)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [doc]);

  const facts = [PREVIEW_LABEL["application/pdf"], doc && `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`, formatSize(size), "Read only"]
    .filter(Boolean)
    .join(" · ");
  if (failure !== null) return <Notice isError>{`This PDF could not be shown: ${failure}`}</Notice>;
  return (
    <>
      <InfoBar>{facts}</InfoBar>
      {doc === null ? (
        <Notice>Loading…</Notice>
      ) : (
        <div
          ref={scrollRef}
          role="region"
          tabIndex={0}
          aria-label={`Pages of ${name}`}
          className="focus-ring-inset flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto bg-ground p-4"
        >
          {width > 0 &&
            Array.from({ length: doc.pageCount }, (_, index) => (
              <PdfPage
                key={index}
                doc={doc}
                pageNumber={index + 1}
                width={width}
                scrollRef={scrollRef}
                onError={setFailure}
              />
            ))}
        </div>
      )}
    </>
  );
}

/** An image or a PDF from the workspace, read only, in the file viewer's body. */
export function FilePreview({ rootPath, relativePath, mime, size, version }: FilePreviewProps) {
  const read = useFilePreviewBytes(rootPath, relativePath, version);
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (read.status === "loading") return <Notice>Loading…</Notice>;
  if (read.status === "failed") return <Notice isError>{read.message}</Notice>;
  return mime === "application/pdf" ? (
    <PdfPreview bytes={read.bytes} name={name} size={size} />
  ) : (
    <ImagePreview bytes={read.bytes} mime={mime} name={name} size={size} />
  );
}
