import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener[]>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return Promise.resolve(() => {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
    });
  },
  emit: () => Promise.resolve(),
}));

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { useCanvas } from "../hooks/useCanvas";

const SESSION = "s-1";
const KEY = "c-0123456789abcdef";
const ENTRY = { key: KEY, folder: "/w/d", relative: "d", title: "Checkout", shownAt: 1, artboards: 1 };
const CANVAS = { title: "Checkout", sections: [{ id: "flow", title: "Flow", artboards: [{ id: "cart", title: "Cart", file: "cart.html", width: 1440, height: 900, group: null }] }] };
const GOOD = { entry: ENTRY, canvas: CANVAS, error: null, boards: [{ id: "cart", sha256: "a".repeat(64) }] };
const BROKEN = { entry: ENTRY, canvas: null, error: "sections[0].title: must not be empty", boards: [] };

function deliver(event: string, payload: unknown) {
  (listeners.get(event) ?? []).forEach((cb) => cb({ payload }));
}

const reads = () => invoke.mock.calls.filter(([cmd]) => cmd === "canvas_read");

afterEach(() => {
  invoke.mockReset();
  listeners.clear();
});

describe("useCanvas", () => {
  it("reads the canvas with its session and key", async () => {
    invoke.mockResolvedValue(GOOD);
    const { result } = renderHook(() => useCanvas(SESSION, KEY));

    await waitFor(() => expect(result.current.read?.canvas?.title).toBe("Checkout"));
    expect(invoke).toHaveBeenCalledWith("canvas_read", { sessionId: SESSION, key: KEY });
    expect(result.current.lastGood).toEqual(CANVAS);
  });

  it("keeps the last good canvas when a read cannot parse", async () => {
    // canvas_thumbs answers nothing here.
    invoke.mockResolvedValue(undefined);
    invoke.mockResolvedValueOnce(GOOD);
    const { result } = renderHook(() => useCanvas(SESSION, KEY));
    await waitFor(() => expect(result.current.lastGood).toEqual(CANVAS));

    invoke.mockResolvedValueOnce(BROKEN);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.read?.error).toBe(BROKEN.error));
    expect(result.current.lastGood).toEqual(CANVAS);
    expect(result.current.shown?.boards).toEqual(GOOD.boards);

    // An answer of another shape changes nothing.
    invoke.mockResolvedValueOnce({ nonsense: true });
    act(() => result.current.refresh());
    await waitFor(() => expect(reads()).toHaveLength(3));
    expect(result.current.read?.error).toBe(BROKEN.error);
    expect(result.current.lastGood).toEqual(CANVAS);
  });

  it("reads again on artifacts-changed, turn end and focus", async () => {
    invoke.mockResolvedValue(GOOD);
    const { rerender } = renderHook(({ turns }) => useCanvas(SESSION, KEY, turns), { initialProps: { turns: 0 } });
    await waitFor(() => expect(reads()).toHaveLength(1));

    act(() => deliver("artifacts-changed", { sessionId: "s-2" }));
    expect(reads()).toHaveLength(1);
    act(() => deliver("artifacts-changed", { sessionId: SESSION }));
    await waitFor(() => expect(reads()).toHaveLength(2));

    rerender({ turns: 1 });
    await waitFor(() => expect(reads()).toHaveLength(3));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(reads()).toHaveLength(4));
  });

  it("follows the selection and zoom the wrapper reports for this canvas only", async () => {
    invoke.mockResolvedValue(GOOD);
    const { result } = renderHook(() => useCanvas(SESSION, KEY));
    await waitFor(() => expect(result.current.read).not.toBeNull());

    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: "cart" }));
    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "zoom", zoom: 0.38 }));
    act(() => deliver("canvas-view", { sessionId: SESSION, key: "c-ffffffffffffffff", kind: "select", artboardId: "other" }));

    expect(result.current.selected).toBe("cart");
    expect(result.current.zoom).toBe(0.38);
    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: null }));
    expect(result.current.selected).toBeNull();
  });

  it("shows a picture when canvas-thumb arrives for the current hash only", async () => {
    const hash = "a".repeat(64);
    const old = "9".repeat(64);
    invoke.mockImplementation((cmd) =>
      Promise.resolve(cmd === "canvas_thumbs" ? [{ id: "cart", sha256: hash, ready: false }] : { ...GOOD, entry: { ...ENTRY, key: "c-1111111111111111" } }),
    );
    const key = "c-1111111111111111";
    const { result } = renderHook(() => useCanvas("s-thumbs", key));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("canvas_thumbs", { sessionId: "s-thumbs", key }));
    expect(result.current.thumbs.size).toBe(0);

    // An old hash, another canvas, another session: nothing.
    act(() => deliver("canvas-thumb", { sessionId: "s-thumbs", key, artboardId: "cart", sha256: old }));
    act(() => deliver("canvas-thumb", { sessionId: "s-thumbs", key: KEY, artboardId: "cart", sha256: hash }));
    act(() => deliver("canvas-thumb", { sessionId: "s-other", key, artboardId: "cart", sha256: hash }));
    expect(result.current.thumbs.size).toBe(0);

    act(() => deliver("canvas-thumb", { sessionId: "s-thumbs", key, artboardId: "cart", sha256: hash }));
    expect(result.current.thumbs.get("cart")).toBe(`zorvo-artifact://localhost/thumb/${hash}.png`);
  });

  it("shows the pictures canvas_thumbs says are ready", async () => {
    const key = "c-2222222222222222";
    invoke.mockImplementation((cmd) =>
      Promise.resolve(cmd === "canvas_thumbs" ? [{ id: "cart", sha256: "a".repeat(64), ready: true }, { id: "x", sha256: "nope", ready: true }] : GOOD),
    );
    const { result } = renderHook(() => useCanvas("s-ready", key));
    await waitFor(() => expect(result.current.thumbs.get("cart")).toBe(`zorvo-artifact://localhost/thumb/${"a".repeat(64)}.png`));
    expect(result.current.thumbs.size).toBe(1);
  });
});

describe("a second viewer of the same canvas", () => {
  it("starts with the canvas the first one read, so Expand keeps the view", async () => {
    invoke.mockResolvedValue(GOOD);
    const first = renderHook(() => useCanvas("s-expand", KEY));
    await waitFor(() => expect(first.result.current.shown).not.toBeNull());

    const second = renderHook(() => useCanvas("s-expand", KEY));
    expect(second.result.current.shown?.canvas).toEqual(CANVAS);
  });
});
