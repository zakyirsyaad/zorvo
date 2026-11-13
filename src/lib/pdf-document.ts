import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/** One page being drawn: `done` settles when it is on the canvas (or was cancelled). */
export interface PdfRender {
  done: Promise<void>;
  cancel: () => void;
}

/** A PDF opened for the viewer, drawn by the bundled renderer; nothing is fetched. */
export interface PdfDocument {
  pageCount: number;
  /** The first page's height over its width, to size the placeholders before a page is drawn. */
  firstPageRatio: number;
  /** Draws page `pageNumber` (1-based) fitted to `cssWidth` CSS pixels, sharp on this screen. */
  renderPage: (pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number) => PdfRender;
  destroy: () => void;
}

/**
 * The last render on each canvas. pdf.js refuses a second render on a canvas the first still holds, and a
 * cancelled one releases it only when its promise settles, so a redraw (the pane was resized) waits for it.
 */
const lastRender = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

/**
 * Opens `bytes` with pdf.js. The library and its worker load on first use, so the main bundle does not
 * carry them. The legacy build is used because the app's webview is whatever WebKit the Mac has.
 *
 * Settings that keep the page inside the CSP and away from the network: no eval (`script-src` has no
 * `unsafe-eval`), no XFA forms, no range or stream fetching (the bytes are already here).
 */
export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // pdf.js transfers the buffer to its worker; hand it a copy so the caller's bytes stay usable.
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
  });
  let pdf: PDFDocumentProxy;
  let firstView: { width: number; height: number };
  try {
    pdf = await loadingTask.promise;
    firstView = (await pdf.getPage(1)).getViewport({ scale: 1 });
  } catch (error) {
    // A corrupt or password-protected file still started a worker: end it, since nobody holds the task.
    void loadingTask.destroy();
    throw error;
  }
  return {
    pageCount: pdf.numPages,
    firstPageRatio: firstView.height / firstView.width,
    renderPage(pageNumber, canvas, cssWidth) {
      let task: { promise: Promise<unknown>; cancel: () => void } | null = null;
      let isCancelled = false;
      const previous = lastRender.get(canvas) ?? Promise.resolve();
      const done = previous.catch(() => undefined).then(() => pdf.getPage(pageNumber)).then(async (page) => {
        if (isCancelled) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This window cannot draw the page.");
        task = page.render({ canvasContext: context, canvas, viewport });
        await task.promise;
      });
      lastRender.set(canvas, done.catch(() => undefined));
      return {
        // A cancelled render rejects with a RenderingCancelledException; that is not a failure to show.
        done: done.catch((error: unknown) => {
          if (!isCancelled) throw error;
        }),
        cancel() {
          isCancelled = true;
          task?.cancel();
        },
      };
    },
    destroy() {
      void pdf.destroy();
    },
  };
}
