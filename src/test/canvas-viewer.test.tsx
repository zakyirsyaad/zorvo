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
import type { ArtifactCommentsState } from "../hooks/useArtifactComments";
import type { AddArtifactReview } from "../hooks/useReviewWiring";
import type { ArtifactComment } from "../types";

function commentsState(overrides: Partial<ArtifactCommentsState> = {}): ArtifactCommentsState {
  return {
    sessionId: SESSION,
    comments: [],
    isCommenting: false,
    setCommenting: vi.fn(),
    candidate: null,
    candidateBody: () => "",
    setCandidateBody: vi.fn(),
    cancelCandidate: vi.fn(),
    saveCandidate: vi.fn(() => "saved" as const),
    startArtboardComment: vi.fn(),
    missing: new Set(),
    canvasMissing: new Map(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    clearSent: vi.fn(),
    ...overrides,
  };
}
const addReview = (): AddArtifactReview => ({ inMessage: new Set(), blockedReason: undefined, add: vi.fn(), addCanvas: vi.fn() });

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

  it("reloads a live artboard when its key changes, a shared file's or its size's change included", async () => {
    show();
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    const urlOf = (call: unknown, id: string) => JSON.parse((call as { state: string }).state).boards.find((board: { id: string }) => board.id === id).url;
    const before = urlOf(calls("canvas_view_apply")[0], "cart");
    expect(before).toContain(`?v=${"a".repeat(12)}`);

    // The backend's key moved (shared.css changed): only the frame's address tells the wrapper to load it again.
    answer = { ...readOf("a".repeat(64)), boards: [{ id: "cart", sha256: "c".repeat(64) }, { id: "pay-a", sha256: "a".repeat(64) }, { id: "pay-b", sha256: "a".repeat(64) }] };
    act(() => deliver("artifacts-changed", { sessionId: SESSION }));

    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(2));
    const after = calls("canvas_view_apply")[1];
    expect(urlOf(after, "cart")).toContain(`?v=${"c".repeat(12)}`);
    expect(urlOf(after, "cart")).not.toBe(before);
    expect(urlOf(after, "pay-a")).toBe(urlOf(calls("canvas_view_apply")[0], "pay-a"));
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

  it("offers the export menu items for a selection and for the whole canvas", async () => {
    show();
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));

    // No selection: only the whole canvas.
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["All artboards as PNG", "Whole canvas as PDF"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Whole canvas as PDF" }));
    await waitFor(() => expect(calls("canvas_export")).toEqual([{ sessionId: SESSION, key: KEY, artboardIds: null, format: "pdf" }]));

    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: "pay-b" }));
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "This artboard as PNG",
      "This artboard as PDF",
      "All artboards as PNG",
      "Whole canvas as PDF",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "This artboard as PNG" }));
    await waitFor(() => expect(calls("canvas_export").at(-1)).toEqual({ sessionId: SESSION, key: KEY, artboardIds: ["pay-b"], format: "png" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "All artboards as PNG" }));
    await waitFor(() => expect(calls("canvas_export").at(-1)).toEqual({ sessionId: SESSION, key: KEY, artboardIds: null, format: "png" }));
  });

  it("says how many were exported and which could not be drawn", async () => {
    let outcome: unknown = { written: 3, failed: [] };
    invoke.mockImplementation((cmd) => (cmd === "canvas_export" ? Promise.resolve(outcome) : Promise.resolve(cmd === "canvas_read" ? answer : undefined)));
    const onNotice = vi.fn();
    const { props } = show({ onNotice });
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    const exportAll = async () => {
      await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Export" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "All artboards as PNG" }));
    };

    await exportAll();
    await waitFor(() => expect(onNotice).toHaveBeenLastCalledWith("Exported 3 artboards.", "info"));

    outcome = { written: 1, failed: ["pay-a", "pay-b"] };
    await exportAll();
    await waitFor(() => expect(onNotice).toHaveBeenLastCalledWith("Exported 1 artboard. 2 could not be drawn: Payment A, Payment B.", "warning"));

    // Cancelled in the dialog: nothing to say.
    outcome = null;
    await exportAll();
    await waitFor(() => expect(calls("canvas_export")).toHaveLength(3));
    expect(onNotice).toHaveBeenCalledTimes(2);

    invoke.mockImplementation((cmd) => (cmd === "canvas_export" ? Promise.reject("Zorvo could not save that file.") : Promise.resolve(cmd === "canvas_read" ? answer : undefined)));
    await exportAll();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Zorvo could not save that file."));
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

  it("offers Comment on artboard for the selected artboard", async () => {
    const comments = commentsState();
    show({ comments, addReview: addReview(), cwd: "/w" });
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Comment on artboard" })).toBeNull();

    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: "pay-b" }));
    fireEvent.click(screen.getByRole("button", { name: "Comment on artboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(comments.startArtboardComment).toHaveBeenCalledWith("pay-b");
    expect(comments.setCommenting).toHaveBeenCalledWith(true);
  });

  it("hides Comment on artboard while comment mode is on", async () => {
    show({ comments: commentsState({ isCommenting: true }), addReview: addReview(), cwd: "/w" });
    await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: "pay-b" }));

    expect(screen.getByRole("button", { name: "Comment" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Comment on artboard" })).toBeNull();
  });

  it("sends an artboard's marks when its frame loads and when its comments change", async () => {
    const onBoard: ArtifactComment = {
      id: "ac-1",
      artifactId: KEY,
      version: 0,
      anchor: { kind: "text", quote: "Pay now", before: "", after: "" },
      body: "Wider.",
      createdAt: 1,
      canvas: { key: KEY, artboardId: "pay-b", fileHash: "a".repeat(64) },
    };
    const { rerenderWith } = show({ comments: commentsState({ comments: [onBoard] }), addReview: addReview(), cwd: "/w" });
    const marks = [{ n: 1, anchor: onBoard.anchor }];
    await waitFor(() => expect(calls("canvas_view_marks")).toEqual([{ sessionId: SESSION, key: KEY, artboardId: "pay-b", marks }]));

    act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "board-loaded", artboardId: "pay-b" }));
    await waitFor(() => expect(calls("canvas_view_marks")).toHaveLength(2));

    rerenderWith({ comments: commentsState({ comments: [] }), addReview: addReview(), cwd: "/w" });
    await waitFor(() => expect(calls("canvas_view_marks").at(-1)).toEqual({ sessionId: SESSION, key: KEY, artboardId: "pay-b", marks: [] }));
    expect(calls("canvas_view_marks")).toHaveLength(3);
  });

  describe("Pick and Build this", () => {
    const select = async (id: string) => {
      await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
      act(() => deliver("canvas-view", { sessionId: SESSION, key: KEY, kind: "select", artboardId: id }));
    };

    it("puts the Pick text in the box once, and sends nothing", async () => {
      const onInsertText = vi.fn();
      show({ onInsertText });
      await select("pay-b");
      fireEvent.click(screen.getByRole("button", { name: "Pick" }));

      expect(onInsertText).toHaveBeenCalledTimes(1);
      expect(onInsertText).toHaveBeenCalledWith(
        "Use variant Payment B (`design/checkout/pay-b.html`) from the Checkout canvas. Drop the other pay variants: `pay-a.html`.",
      );
      expect(calls("acp_prompt")).toEqual([]);
    });

    it("offers no Pick for an artboard without a group", async () => {
      show({ onInsertText: vi.fn() });
      await select("cart");

      expect(screen.queryByRole("button", { name: "Pick" })).toBeNull();
      expect(screen.getByRole("button", { name: "Build this" })).toBeTruthy();
    });

    it("puts the Build this text in the box once", async () => {
      const onInsertText = vi.fn();
      show({ onInsertText });
      await select("pay-b");
      fireEvent.click(screen.getByRole("button", { name: "Build this" }));

      expect(onInsertText).toHaveBeenCalledTimes(1);
      expect(onInsertText).toHaveBeenCalledWith("Build the Payment B screen from `design/checkout/pay-b.html` (1440 × 900) in this repository.");
    });

    it("builds a section from the Sections menu", async () => {
      const onInsertText = vi.fn();
      show({ onInsertText });
      await waitFor(() => expect(calls("canvas_view_apply")).toHaveLength(1));
      fireEvent.click(screen.getByRole("button", { name: "Sections" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Build section Flow" }));

      expect(onInsertText).toHaveBeenCalledWith(
        "Build the screens of the Flow section of the Checkout canvas in this repository, in this order:\n- Cart: `design/checkout/cart.html` (1440 × 900)",
      );
    });

    it("disables the buttons with the reason when the box cannot take text", async () => {
      const onInsertText = vi.fn();
      show({ onInsertText, insertBlockedReason: "There is no message box for this session." });
      await select("pay-b");

      const build = screen.getByRole("button", { name: "Build this" }) as HTMLButtonElement;
      expect(build.disabled).toBe(true);
      expect(build.title).toBe("There is no message box for this session.");
      expect((screen.getByRole("button", { name: "Pick" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("has no buttons without an inserter (a popout)", async () => {
      show();
      await select("pay-b");
      expect(screen.queryByRole("button", { name: "Build this" })).toBeNull();
    });
  });
});
