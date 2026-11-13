import { describe, it, expect, vi, beforeEach } from "vitest";

const destroyTask = vi.fn(() => Promise.resolve());
let outcome: () => Promise<unknown>;

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: outcome(), destroy: destroyTask }),
}));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/worker.mjs" }));

import { openPdf } from "../lib/pdf-document";

const page = { getViewport: () => ({ width: 100, height: 140 }) };

beforeEach(() => {
  destroyTask.mockClear();
});

describe("openPdf", () => {
  it("destroys the loading task when the file cannot be opened", async () => {
    outcome = () => Promise.reject(new Error("Invalid PDF structure."));

    await expect(openPdf(new Uint8Array([1]))).rejects.toThrow("Invalid PDF structure.");

    expect(destroyTask).toHaveBeenCalledTimes(1);
  });

  it("destroys the loading task when the first page cannot be read", async () => {
    outcome = () => Promise.resolve({ numPages: 2, getPage: () => Promise.reject(new Error("No page.")) });

    await expect(openPdf(new Uint8Array([1]))).rejects.toThrow("No page.");

    expect(destroyTask).toHaveBeenCalledTimes(1);
  });

  it("keeps the task alive for a file that opens, and ends it when the document is destroyed", async () => {
    const destroyDocument = vi.fn(() => Promise.resolve());
    outcome = () => Promise.resolve({ numPages: 2, getPage: () => Promise.resolve(page), destroy: destroyDocument });

    const doc = await openPdf(new Uint8Array([1]));

    expect(doc.pageCount).toBe(2);
    expect(doc.firstPageRatio).toBeCloseTo(1.4);
    expect(destroyTask).not.toHaveBeenCalled();
    doc.destroy();
    expect(destroyDocument).toHaveBeenCalled();
  });
});
