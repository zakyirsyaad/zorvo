import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import { CanvasViewer, type CanvasViewerProps } from "../components/artifacts/CanvasViewer";
import { FOLDER_NOT_FOUND } from "../lib/canvas";

// Each test is a session of its own: the hook remembers each canvas for the run.
let run = 0;
let SESSION = "s-viewer-0";
const KEY = "c-0123456789abcdef";
const ENTRY = { key: KEY, folder: "/w/design/checkout", relative: "design/checkout", title: "Checkout", shownAt: 1, artboards: 3 };
const CANVAS = {
  title: "Checkout",
  sections: [
    { id: "flow", title: "Flow", artboards: [{ id: "cart", title: "Cart", file: "cart.html", width: 1440, height: 900, group: null }] },
    {
      id: "pay",
      title: "Payment variants",
      artboards: [
        { id: "pay-a", title: "Payment A", file: "pay-a.html", width: 1440, height: 900, group: "pay" },
        { id: "pay-b", title: "Payment B", file: "pay-b.html", width: 1440, height: 900, group: "pay" },
      ],
    },
  ],
};
const readOf = (sha: string) => ({
  entry: ENTRY,
  canvas: CANVAS,
  error: null,
  boards: [
    { id: "cart", sha256: sha },
    { id: "pay-a", sha256: sha },
    { id: "pay-b", sha256: sha },
  ],
});
const RECT = { x: 880, y: 104, width: 540, height: 700 };
let answer: unknown = readOf("a".repeat(64));

const calls = (cmd: string) => invoke.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args);
function deliver(event: string, payload: unknown) {
  (listeners.get(event) ?? []).forEach((cb) => cb({ payload }));
}

beforeEach(() => {
  run += 1;
  SESSION = `s-viewer-${run}`;
  answer = readOf("a".repeat(64));
  invoke.mockImplementation((cmd) => Promise.resolve(cmd === "canvas_read" ? answer : undefined));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) });
});

afterEach(() => {
  invoke.mockReset();
  listeners.clear();
  vi.restoreAllMocks();
});

function show(overrides: Partial<CanvasViewerProps> = {}) {
  const props: CanvasViewerProps = {
    sessionId: SESSION,
    canvasKey: KEY,
    isExpanded: false,
    onToggleExpanded: vi.fn(),
    onBack: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const view = render(<CanvasViewer {...props} />);
  return { props, ...view, rerenderWith: (more: Partial<CanvasViewerProps>) => view.rerender(<CanvasViewer {...props} {...more} />) };
}

describe("the canvas viewer", () => {
  it("shows the canvas through its own view, with ids and a rectangle only", async () => {
    show();

    await waitFor(() => expect(calls("canvas_view_show")).toHaveLength(1));
    expect(calls("canvas_view_show")[0]).toEqual({ sessionId: SESSION, key: KEY, ...RECT });
    expect(screen.getByRole("heading", { name: "Checkout" })).toBeTruthy();
    expect(screen.getByText("3 artboards")).toBeTruthy();
  });

  it("sends apply when the read or the pictures change, not on every render", async () => {
    const { rerenderWith } = show();
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    const first = calls("canvas_view_apply")[0] as { sessionId: string; key: string; state: string };
    expect(first.sessionId).toBe(SESSION);
    expect(first.key).toBe(KEY);
    expect(JSON.parse(first.state).boards).toHaveLength(3);

    rerenderWith({ isCovered: false });
    // A picture for an old hash changes nothing.
    act(() => deliver("canvas-thumb", { sessionId: SESSION, key: KEY, artboardId: "cart", sha256: "9".repeat(64) }));
    await act(async () => {});
    expect(calls("canvas_view_apply")).toHaveLength(1);

    act(() => deliver("canvas-thumb", { sessionId: SESSION, key: KEY, artboardId: "cart", sha256: "a".repeat(64) }));
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(2));
    const withPicture = JSON.parse((calls("canvas_view_apply")[1] as { state: string }).state);
    expect(withPicture.boards.find((board: { id: string }) => board.id === "cart").thumb).toBe(`zorvo-artifact://localhost/thumb/${"a".repeat(64)}.png`);

    answer = readOf("b".repeat(64));
    act(() => deliver("artifacts-changed", { sessionId: SESSION }));
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(3));
  });

  it("drives the view from the header", async () => {
    show();
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Sections" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Payment variants/ }));

    await waitFor(() => expect(calls("canvas_view_command").map((args) => (args as { name: string }).name)).toEqual(["fit", "actual", "in", "out", "section:pay"]));
    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "zoom", zoom: 0.384 }));
    expect(screen.getByText("38%")).toBeTruthy();
  });

  it("shows the selected artboard's title with Focus, Previous and Next", async () => {
    show();
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Focus" })).toBeNull();

    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: "pay-b" }));

    expect(screen.getByText("Payment B")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous artboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Next artboard" }));
    await waitFor(() => expect(calls("canvas_view_command").map((args) => (args as { name: string }).name)).toEqual(["focus:pay-b", "prev", "next"]));
    // The next state keeps the selection, so the wrapper does not lose its outline.
    await waitFor(() => expect(JSON.parse((calls("canvas_view_apply").at(-1) as { state: string }).state).selected).toBe("pay-b"));
  });

  it("keeps the last layout under a bar that says why canvas.json could not be read", async () => {
    show();
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    answer = { entry: ENTRY, canvas: null, error: "sections[0].title: must not be empty", boards: [] };
    act(() => deliver("artifacts-changed", { sessionId: SESSION }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("could not be read: sections[0].title: must not be empty"));
    expect(screen.getByRole("status").textContent).toContain("You see the last layout that could be read.");
    expect(calls("canvas_view_apply")).toHaveLength(1);
  });

  it("says when the folder is gone and shows no view", async () => {
    answer = { entry: ENTRY, canvas: null, error: FOLDER_NOT_FOUND, boards: [] };
    show();

    await waitFor(() => expect(screen.getByText("Folder not found")).toBeTruthy());
    expect(calls("canvas_view_show")).toEqual([]);
  });
});
