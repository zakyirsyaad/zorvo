import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { FileViewer, type FileViewerProps } from "../components/files/FileViewer";
import { parseFileContent } from "../lib/file-content";
import type { PdfDocument } from "../lib/pdf-document";

const ROOT = "/Users/test/proj";

let fileResult: () => Promise<unknown>;
let previewResult: () => Promise<unknown>;

const mockInvoke = vi.fn((cmd: string, _args?: Record<string, unknown>) => {
  if (cmd === "read_workspace_file") return fileResult();
  if (cmd === "read_workspace_preview") return previewResult();
  return Promise.resolve(undefined);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

const renderPage = vi.fn();
const destroy = vi.fn();
let openResult: () => Promise<PdfDocument>;
vi.mock("../lib/pdf-document", () => ({ openPdf: () => openResult() }));

const bytesOf = (...values: number[]) => new Uint8Array(values).buffer;

async function renderViewer(overrides: Partial<FileViewerProps> = {}) {
  const props: FileViewerProps = {
    rootPath: ROOT,
    relativePath: "pdf/run-sheet.pdf",
    version: 0,
    onBack: vi.fn(),
    onInsertPath: vi.fn(),
    onInsertText: vi.fn(),
    ...overrides,
  };
  const view = await act(async () => render(<FileViewer {...props} />));
  return { props, ...view };
}

beforeEach(() => {
  mockInvoke.mockClear();
  renderPage.mockReset();
  destroy.mockReset();
  renderPage.mockImplementation(() => ({ done: Promise.resolve(), cancel: vi.fn() }));
  openResult = () => Promise.resolve({ pageCount: 3, firstPageRatio: 1.4, renderPage, destroy });
  fileResult = () => Promise.resolve({ kind: "preview", mime: "application/pdf", size: 288 * 1024 });
  previewResult = () => Promise.resolve(bytesOf(0x25, 0x50, 0x44, 0x46));
  URL.createObjectURL = vi.fn(() => "blob:fake-image");
  URL.revokeObjectURL = vi.fn();
});

describe("parseFileContent — previews", () => {
  it("reads a preview and a preview that is too large", () => {
    expect(parseFileContent({ kind: "preview", mime: "image/png", size: 3 })).toEqual({ kind: "preview", mime: "image/png", size: 3 });
    expect(parseFileContent({ kind: "previewTooLarge", mime: "application/pdf", size: 9, limit: 4 })).toEqual({
      kind: "previewTooLarge",
      mime: "application/pdf",
      size: 9,
      limit: 4,
    });
  });

  it("refuses a type the viewer cannot show, such as SVG", () => {
    expect(() => parseFileContent({ kind: "preview", mime: "image/svg+xml", size: 3 })).toThrow();
    expect(() => parseFileContent({ kind: "preview", mime: "text/html", size: 3 })).toThrow();
  });
});

describe("FileViewer — an image", () => {
  beforeEach(() => {
    fileResult = () => Promise.resolve({ kind: "preview", mime: "image/png", size: 2048 });
  });

  it("shows the picture from the bytes, with its type and size, never as markup", async () => {
    await renderViewer({ relativePath: "shots/home.png" });

    const image = await screen.findByRole("img", { name: "home.png" });
    expect(image).toHaveAttribute("src", "blob:fake-image");
    expect(image).toHaveClass("max-h-full", "max-w-full", "object-contain");
    expect(screen.getByText(/PNG image · 2 KB · Read only/)).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("read_workspace_preview", { root: ROOT, relative: "shots/home.png" });
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/png");
  });

  it("adds the picture's pixel size once it has loaded", async () => {
    await renderViewer({ relativePath: "shots/home.png" });
    const image = await screen.findByRole("img", { name: "home.png" });
    Object.defineProperty(image, "naturalWidth", { value: 1200 });
    Object.defineProperty(image, "naturalHeight", { value: 800 });

    fireEvent.load(image);

    expect(screen.getByText(/PNG image · 1200 × 800 px · 2 KB/)).toBeInTheDocument();
  });

  it("says so when the bytes are not a picture the window can draw", async () => {
    await renderViewer({ relativePath: "shots/home.png" });

    fireEvent.error(await screen.findByRole("img", { name: "home.png" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This file could not be shown.");
  });

  it("frees the picture's URL when the viewer closes", async () => {
    const { unmount } = await renderViewer({ relativePath: "shots/home.png" });
    await screen.findByRole("img", { name: "home.png" });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-image");
  });

  it("keeps add to prompt, open and copy path, and offers no line selection", async () => {
    const { props } = await renderViewer({ relativePath: "shots/home.png" });
    await screen.findByRole("img", { name: "home.png" });

    fireEvent.click(screen.getByRole("button", { name: "Add home.png to prompt" }));
    expect(props.onInsertPath).toHaveBeenCalledWith(`${ROOT}/shots/home.png`);
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(mockInvoke).toHaveBeenCalledWith("open_path", { root: ROOT, relative: "shots/home.png" });
    expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Contents of/ })).not.toBeInTheDocument();
  });
});

describe("FileViewer — a PDF", () => {
  it("draws every page from the bytes with its page count and size", async () => {
    await renderViewer();

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    expect(screen.getByRole("img", { name: "Page 1 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Page 3 of 3" })).toBeInTheDocument();
    expect(screen.getByText("PDF · 3 pages · 288 KB · Read only")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pages of run-sheet.pdf" })).toHaveAttribute("tabindex", "0");
    expect(renderPage).toHaveBeenCalledTimes(3);
    expect(renderPage.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
  });

  it("says 1 page for a one-page file", async () => {
    openResult = () => Promise.resolve({ pageCount: 1, firstPageRatio: 1.4, renderPage, destroy });

    await renderViewer();

    expect(await screen.findByText("PDF · 1 page · 288 KB · Read only")).toBeInTheDocument();
  });

  it("closes the document when the viewer goes away", async () => {
    const { unmount } = await renderViewer();
    await screen.findByRole("region", { name: "Pages of run-sheet.pdf" });

    unmount();

    expect(destroy).toHaveBeenCalled();
  });

  it("says why when the PDF cannot be opened", async () => {
    openResult = () => Promise.reject(new Error("Invalid PDF structure."));

    await renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("This PDF could not be shown: Invalid PDF structure.");
  });

  it("says why when a page cannot be drawn", async () => {
    renderPage.mockImplementation(() => ({ done: Promise.reject(new Error("Out of memory.")), cancel: vi.fn() }));

    await renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("Out of memory.");
  });

  it("gives a far page's canvas back and draws it again when it returns", async () => {
    const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      await renderViewer();
      await screen.findByRole("region", { name: "Pages of run-sheet.pdf" });
      expect(renderPage).not.toHaveBeenCalled();

      await act(async () => callbacks[0]([{ isIntersecting: true }]));
      expect(renderPage).toHaveBeenCalledTimes(1);
      const canvas = screen.getByRole("img", { name: "Page 1 of 3" }) as HTMLCanvasElement;
      canvas.width = 900;

      await act(async () => callbacks[0]([{ isIntersecting: false }]));
      expect(canvas.width).toBe(0);

      await act(async () => callbacks[0]([{ isIntersecting: true }]));
      expect(renderPage).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the header's actions", async () => {
    const { props } = await renderViewer();
    await screen.findByRole("region", { name: "Pages of run-sheet.pdf" });

    fireEvent.click(screen.getByRole("button", { name: "Add run-sheet.pdf to prompt" }));

    expect(props.onInsertPath).toHaveBeenCalledWith(`${ROOT}/pdf/run-sheet.pdf`);
    expect(screen.getByRole("button", { name: "Open in editor" })).toBeInTheDocument();
  });
});

describe("FileViewer — a refresh with a preview open", () => {
  const pdfBytes = () => bytesOf(0x25, 0x50, 0x44, 0x46);

  it("keeps the open PDF, and its page, while the same bytes are read again", async () => {
    const { rerender, props } = await renderViewer();
    await screen.findByRole("region", { name: "Pages of run-sheet.pdf" });
    const opens = vi.fn(openResult);
    openResult = opens;
    const region = screen.getByRole("region", { name: "Pages of run-sheet.pdf" });
    region.scrollTop = 500;

    let release: (bytes: ArrayBuffer) => void = () => {};
    previewResult = () => new Promise((resolve) => (release = resolve));
    await act(async () => rerender(<FileViewer {...props} version={1} />));

    // The read is in flight: the pages are still there, not "Loading…".
    expect(screen.getByRole("region", { name: "Pages of run-sheet.pdf" })).toBe(region);
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    await act(async () => release(pdfBytes()));

    expect(screen.getByRole("region", { name: "Pages of run-sheet.pdf" })).toBe(region);
    expect(region.scrollTop).toBe(500);
    expect(opens).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("opens the PDF again when the bytes changed", async () => {
    const { rerender, props } = await renderViewer();
    await screen.findByRole("region", { name: "Pages of run-sheet.pdf" });
    const opens = vi.fn(openResult);
    openResult = opens;
    previewResult = () => Promise.resolve(bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d));

    await act(async () => rerender(<FileViewer {...props} version={1} />));

    await waitFor(() => expect(opens).toHaveBeenCalledTimes(1));
    expect(destroy).toHaveBeenCalled();
  });

  it("drops a late answer for the file that was open before a quick switch", async () => {
    let releaseOld: (bytes: ArrayBuffer) => void = () => {};
    previewResult = () => new Promise((resolve) => (releaseOld = resolve));
    const { rerender, props } = await renderViewer({ relativePath: "old.png" });
    fileResult = () => Promise.resolve({ kind: "preview", mime: "image/png", size: 10 });
    previewResult = () => Promise.resolve(bytesOf(1, 2, 3));
    await act(async () => rerender(<FileViewer {...props} relativePath="new.png" />));
    await screen.findByRole("img", { name: "new.png" });
    vi.mocked(URL.createObjectURL).mockClear();

    await act(async () => releaseOld(bytesOf(9, 9, 9)));

    expect(screen.getByRole("img", { name: "new.png" })).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("tries a picture that failed to draw again once its file is read with other bytes", async () => {
    fileResult = () => Promise.resolve({ kind: "preview", mime: "image/png", size: 10 });
    const { rerender, props } = await renderViewer({ relativePath: "shot.png" });
    fireEvent.error(await screen.findByRole("img", { name: "shot.png" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    previewResult = () => Promise.resolve(bytesOf(7, 7, 7));

    await act(async () => rerender(<FileViewer {...props} version={1} />));

    expect(await screen.findByRole("img", { name: "shot.png" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FileViewer — other states", () => {
  it("says a PDF over the limit is too large to preview, with its size", async () => {
    fileResult = () => Promise.resolve({ kind: "previewTooLarge", mime: "application/pdf", size: 12 * 1024 * 1024, limit: 10 * 1024 * 1024 });

    await renderViewer();

    expect(await screen.findByText(/This PDF is too large to preview \(12 MB; the limit is 10 MB\)/)).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("read_workspace_preview", expect.anything());
  });

  it("says an image over the limit is too large to preview", async () => {
    fileResult = () => Promise.resolve({ kind: "previewTooLarge", mime: "image/png", size: 11 * 1024 * 1024, limit: 10 * 1024 * 1024 });

    await renderViewer({ relativePath: "big.png" });

    expect(await screen.findByText(/This image is too large to preview \(11 MB/)).toBeInTheDocument();
  });

  it("keeps today's message for any other binary file", async () => {
    fileResult = () => Promise.resolve({ kind: "binary", size: 2048 });

    await renderViewer({ relativePath: "a.zip" });

    expect(await screen.findByText("This file is binary (2 KB), so it is not shown.")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("read_workspace_preview", expect.anything());
  });

  it("shows the backend's reason when the bytes cannot be read", async () => {
    previewResult = () => Promise.reject("\"pdf/run-sheet.pdf\" is too large to preview");

    await renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("is too large to preview");
  });

  it("refuses bytes that are not binary data", async () => {
    previewResult = () => Promise.resolve({ not: "bytes" });

    await renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unexpected file contents from the backend");
  });
});
