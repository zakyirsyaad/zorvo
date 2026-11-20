import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBrowserView } from "../hooks/useBrowserView";

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
const images: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];
beforeEach(() => {
  images.length = 0;
  vi.stubGlobal("Image", class { onload = null; onerror = null; src = ""; constructor() { images.push(this); } });
});
afterEach(async () => { await act(async () => cleanup()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function boxRef() {
  const box = document.createElement("div");
  box.getBoundingClientRect = () => ({ x: 10, y: 50, width: 560, height: 600 }) as DOMRect;
  return { current: box };
}
const snapshot = { mimeType: "image/png", base64: "aGVsbG8=" };

it("decodes one frame before hiding the page for a menu and drops it after restoring native rendering", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async command => command === "browser_execute" ? pending : undefined);
  const preview = vi.fn();
  const failed = vi.fn();
  const ref = boxRef();
  const { rerender } = renderHook(({ covered }) => useBrowserView(ref, "s1", "t1", !covered, vi.fn(), { key: "page/menu", covered, onPreview: preview, onCaptureFailed: failed }), { initialProps: { covered: false } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", expect.objectContaining({ visible: true }), undefined));
  preview.mockClear();
  invoke.mockClear();
  rerender({ covered: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "screenshot", tabId: "t1", engine: "webkit" } }, undefined));
  expect(invoke.mock.calls.some(([command]) => command === "browser_bounds")).toBe(false);
  await act(async () => { finish(snapshot); });
  expect(preview).not.toHaveBeenCalled();
  await act(async () => { images[0].onload?.(); });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", { sessionId: "s1", tabId: "t1", bounds: null, visible: false }, undefined));
  expect(preview).toHaveBeenCalledWith("data:image/png;base64,aGVsbG8=");
  rerender({ covered: true });
  expect(invoke.mock.calls.filter(([command]) => command === "browser_execute")).toHaveLength(1);
  rerender({ covered: false });
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(null));
  expect(failed).not.toHaveBeenCalled();
});

it("keeps the native view visible when capturing the menu backdrop fails", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async command => {
    if (command === "browser_execute") throw new Error("snapshot failed");
  });
  const failed = vi.fn();
  const error = vi.fn();
  const ref = boxRef();
  const { rerender } = renderHook(({ covered }) => useBrowserView(ref, "s1", "t1", !covered, error, { key: "page/menu", covered, onPreview: vi.fn(), onCaptureFailed: failed }), { initialProps: { covered: false } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", expect.objectContaining({ visible: true }), undefined));
  invoke.mockClear();
  rerender({ covered: true });
  await waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(error).toHaveBeenCalledWith("Error: snapshot failed");
  expect(invoke.mock.calls.some(([command]) => command === "browser_bounds")).toBe(false);
});

it("does not publish a menu frame after its session has unmounted", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async command => command === "browser_execute" ? pending : undefined);
  const preview = vi.fn();
  const ref = boxRef();
  const { rerender, unmount } = renderHook(({ covered }) => useBrowserView(ref, "s1", "t1", !covered, vi.fn(), { key: "page/menu", covered, onPreview: preview, onCaptureFailed: vi.fn() }), { initialProps: { covered: false } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", expect.objectContaining({ visible: true }), undefined));
  preview.mockClear();
  rerender({ covered: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", expect.anything(), undefined));
  unmount();
  await act(async () => { finish(snapshot); });
  expect(images).toHaveLength(0);
  expect(preview).not.toHaveBeenCalled();
});

it("does not hide a new document when a previous document's capture resolves", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async command => command === "browser_execute" ? pending : undefined);
  const preview = vi.fn();
  const failed = vi.fn();
  const ref = boxRef();
  const { rerender } = renderHook(({ covered, page }) => useBrowserView(ref, "s1", "t1", !covered, vi.fn(), { key: page, covered, onPreview: preview, onCaptureFailed: failed }), { initialProps: { covered: false, page: "first" } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", expect.objectContaining({ visible: true }), undefined));
  preview.mockClear();
  invoke.mockClear();
  rerender({ covered: true, page: "first" });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", expect.anything(), undefined));
  rerender({ covered: false, page: "next" });
  await act(async () => { finish(snapshot); });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", expect.objectContaining({ visible: true }), undefined));
  expect(invoke.mock.calls.some(([, args]) => args?.visible === false)).toBe(false);
  expect(preview.mock.calls.every(([source]) => source === null)).toBe(true);
  expect(images).toHaveLength(0);
  expect(failed).not.toHaveBeenCalled();
});
