import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ArtifactsPanel, type ArtifactsPanelProps } from "../components/artifacts/ArtifactsPanel";
import { fakeTauriInvoke } from "./setup";
import { formatShortTime } from "../lib/relative-time";
import { ToastStack } from "../components/ui/Toast";
import type { Artifact } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const REPORT: Artifact = {
  id: "a-0123456789abcdef",
  title: "Session list performance",
  sourcePath: "/w/report.html",
  versions: [
    { n: 1, at: 1_000, bytes: 10 },
    { n: 2, at: 2_000, bytes: 11 },
    { n: 3, at: 3_000, bytes: 12 },
  ],
};
const STEPS: Artifact = { id: "a-1111111111111111", title: "Render steps", sourcePath: "/w/steps.html", versions: [{ n: 1, at: 500, bytes: 5 }] };
const RECT = { x: 880, y: 104, width: 540, height: 700 };

let spy: ReturnType<typeof vi.spyOn>;
const calls = (cmd: string) => spy.mock.calls.filter(([name]: unknown[]) => name === cmd).map(([, args]: unknown[]) => args);

beforeEach(() => {
  spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => fakeTauriInvoke(cmd, args));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function show(overrides: Partial<ArtifactsPanelProps> = {}) {
  const props: ArtifactsPanelProps = {
    sessionId: "s-1",
    artifacts: [REPORT, STEPS],
    viewed: null,
    onView: vi.fn(),
    isExpanded: false,
    onToggleExpanded: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ArtifactsPanel {...props} />) };
}

const viewingReport = { viewed: { artifactId: REPORT.id, version: null } };

describe("the list", () => {
  it("lists a session's artifacts and opens one", () => {
    const { props } = show();

    expect(screen.getByRole("button", { name: /Session list performance/ }).textContent).toContain("Version 3");
    fireEvent.click(screen.getByRole("button", { name: /Render steps/ }));

    expect(props.onView).toHaveBeenCalledWith({ artifactId: STEPS.id, version: null });
    expect(calls("artifact_view_show")).toEqual([]);
  });

  it("opens straight on the page when the session has one artifact", async () => {
    show({ artifacts: [REPORT] });

    expect(screen.getByRole("heading", { name: "Session list performance" })).toBeTruthy();
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Back to artifacts" })).toBeNull();
  });
});

describe("the viewer", () => {
  it("asks the backend to show the page in its box, with ids and a rectangle only", async () => {
    const { container } = show(viewingReport);

    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    expect(calls("artifact_view_show")[0]).toEqual({ sessionId: "s-1", artifactId: REPORT.id, version: 3, ...RECT });
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("img", { name: "Session list performance" })).toBeTruthy();
  });

  it("hides the page while a notice lies over its box, even where no sampled point falls", async () => {
    // A toast near the bottom of a tall box can miss every sampled point; its rectangle is what counts.
    show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    const toast = render(
      <ToastStack>
        <span>Zorvo could not save that file.</span>
      </ToastStack>,
    );

    await waitFor(() => expect(calls("artifact_view_hide")).toContainEqual({ hidden: true }));
    toast.unmount();
    await waitFor(() => expect(calls("artifact_view_hide").at(-1)).toEqual({ hidden: false }));
  });

  it("keeps the page shown while a notice lies elsewhere in the window", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const isNotice = this.closest("[data-overlay]") !== null;
      const { x, y, width, height } = isNotice ? { x: 40, y: 700, width: 300, height: 60 } : RECT;
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
    });
    show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    render(
      <ToastStack>
        <span>Saved.</span>
      </ToastStack>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(calls("artifact_view_hide")).not.toContainEqual({ hidden: true });
  });

  it("goes back to the list", () => {
    const { props } = show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Back to artifacts" }));
    expect(props.onView).toHaveBeenCalledWith(null);
  });

  it("hides the page while the version menu is open, and picks a version from it", async () => {
    const { props } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Version 3 of 3" }));

    await waitFor(() => expect(calls("artifact_view_hide")).toContainEqual({ hidden: true }));
    const menu = screen.getByRole("menu", { name: "Versions" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Version 1/ }));
    expect(props.onView).toHaveBeenCalledWith({ artifactId: REPORT.id, version: 1 });
    await waitFor(() => expect(calls("artifact_view_hide").at(-1)).toEqual({ hidden: false }));
  });

  it("dates each version in the short form, so its name is never cut", () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Version 3 of 3" }));
    const rows = within(screen.getByRole("menu", { name: "Versions" })).getAllByRole("menuitemradio");
    expect(rows[0].textContent).toBe(`Version 3${formatShortTime(3_000)} · newest`);
    expect(rows[2].textContent).toBe(`Version 1${formatShortTime(1_000)}`);
  });

  it("picking the newest version follows it again", () => {
    const { props } = show({ viewed: { artifactId: REPORT.id, version: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Version 1 of 3" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Version 3/ }));
    expect(props.onView).toHaveBeenCalledWith({ artifactId: REPORT.id, version: null });
  });

  it("marks an older version and shows that version", async () => {
    show({ viewed: { artifactId: REPORT.id, version: 2 } });

    expect(screen.getByText("Older version")).toBeTruthy();
    await waitFor(() => expect(calls("artifact_view_show")[0]).toMatchObject({ version: 2 }));
  });

  it("shows a new version in place while it follows the newest", async () => {
    const { props, rerender } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    const next = { ...REPORT, versions: [...REPORT.versions, { n: 4, at: 4_000, bytes: 13 }] };

    rerender(<ArtifactsPanel {...props} artifacts={[next, STEPS]} />);

    await waitFor(() => expect(calls("artifact_view_show").at(-1)).toMatchObject({ version: 4 }));
  });

  it("keeps a pinned older version when a new one arrives", async () => {
    const { props, rerender } = show({ viewed: { artifactId: REPORT.id, version: 2 } });
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    const next = { ...REPORT, versions: [...REPORT.versions, { n: 4, at: 4_000, bytes: 13 }] };

    rerender(<ArtifactsPanel {...props} artifacts={[next, STEPS]} />);
    await act(async () => {});

    expect(calls("artifact_view_show")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Version 2 of 4" })).toBeTruthy();
  });

  it("makes a new view on Reload", async () => {
    show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(2));
  });

  it("says a pruned version is gone and asks for no page", async () => {
    show({ viewed: { artifactId: REPORT.id, version: 9 } });

    expect(screen.getByText("This version is no longer on this Mac.")).toBeTruthy();
    await act(async () => {});
    expect(calls("artifact_view_show")).toEqual([]);
  });

  it("closes the view when it goes away", async () => {
    const { unmount } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    unmount();
    await waitFor(() => expect(calls("artifact_view_close")).toHaveLength(1));
  });

  it("offers Expand beside the chat and Shrink in its place", () => {
    const { props, rerender } = show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(<ArtifactsPanel {...props} isExpanded />);

    expect(screen.getByRole("button", { name: "Shrink" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to artifacts" })).toBeNull();
  });

  it("tells the user when the page cannot be shown", async () => {
    spy.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      cmd === "artifact_view_show" ? Promise.reject("Zorvo could not show that page.") : fakeTauriInvoke(cmd, args),
    );
    const { props } = show(viewingReport);
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Zorvo could not show that page."));
  });
});

describe("a box that has no size yet", () => {
  const zero = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  const sized = { ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) };

  it("asks for the page only once the box shows (Settings and the gallery hide it without unmounting)", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(zero);
    show(viewingReport);
    await act(async () => {});
    expect(calls("artifact_view_show")).toEqual([]);

    rect.mockReturnValue(sized);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    expect(calls("artifact_view_show")[0]).toMatchObject({ version: 3, ...RECT });
  });

  it("asks for a new version that arrived while the box was hidden, when it shows again", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(sized);
    const { props, rerender } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    rect.mockReturnValue(zero);
    const next = { ...REPORT, versions: [...REPORT.versions, { n: 4, at: 4_000, bytes: 13 }] };
    rerender(<ArtifactsPanel {...props} artifacts={[next, STEPS]} />);
    await act(async () => {});
    expect(calls("artifact_view_show")).toHaveLength(1);

    rect.mockReturnValue(sized);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(calls("artifact_view_show").at(-1)).toMatchObject({ version: 4 }));
  });
});

describe("one viewer leaving as another arrives", () => {
  it("keeps the page when the same one moves to another box, as Expand and Shrink do", async () => {
    const first = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    // Expand: the viewer beside the chat leaves and the one in the chat's place arrives, in one step.
    first.unmount();
    show({ ...viewingReport, isExpanded: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // The page is moved, not made again: what was typed or scrolled in it stays.
    expect(calls("artifact_view_show")).toHaveLength(1);
    expect(calls("artifact_view_close")).toEqual([]);
    expect(calls("artifact_view_bounds")).toContainEqual(RECT);
    expect(calls("artifact_view_hide").at(-1)).toEqual({ hidden: false });
  });

  it("keeps the page for the box that is still there when an earlier box of the same page leaves", async () => {
    const first = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    // The second box arrives in a step of its own, before the first one leaves.
    show({ ...viewingReport, isExpanded: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    first.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(calls("artifact_view_close")).toEqual([]);
  });

  it("shows the new page without closing first, whatever the old one still had in flight", async () => {
    // A call that takes a while (the hide for the open menu): the next show must still go out after it, and it replaces the old page itself.
    let release: () => void = () => undefined;
    let isHeld = false;
    spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd !== "artifact_view_hide" || isHeld) return fakeTauriInvoke(cmd, args);
      isHeld = true;
      return new Promise((resolve) => (release = () => resolve(undefined)));
    });
    const { props, rerender } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Version 3 of 3" }));
    await waitFor(() => expect(calls("artifact_view_hide")).toHaveLength(1));

    // Another session's panel takes its place while that call is still out.
    rerender(<ArtifactsPanel {...props} key="other" sessionId="s-2" artifacts={[STEPS]} viewed={null} />);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(2));
    const order = spy.mock.calls.map(([cmd]: unknown[]) => cmd).filter((cmd: unknown) => cmd === "artifact_view_show" || cmd === "artifact_view_close");
    expect(order).toEqual(["artifact_view_show", "artifact_view_show"]);
  });
});

describe("export", () => {
  it("says what an exported page is, then saves with ids and the version only", async () => {
    show({ viewed: { artifactId: REPORT.id, version: 2 } });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    const panel = screen.getByRole("dialog", { name: "Export this page" });
    expect(panel.textContent).toContain("Saves Version 2 as one HTML file. An exported page opens in a browser without Zorvo's limits.");
    expect(calls("artifact_export")).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Choose where to save" }));
    await waitFor(() => expect(calls("artifact_export")).toEqual([{ sessionId: "s-1", artifactId: REPORT.id, version: 2 }]));
  });

  it("saves nothing on Cancel", () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Export this page" })).toBeNull();
    expect(calls("artifact_export")).toEqual([]);
  });
});

describe("the more menu", () => {
  it("asks before deleting, then deletes and returns to the list", async () => {
    const { props } = show(viewingReport);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete artifact" }));

    expect(calls("artifact_delete")).toEqual([]);
    const question = screen.getByRole("alertdialog", { name: "Delete artifact" });
    expect(question.textContent).toContain("Delete this artifact and its versions? This cannot be undone.");
    fireEvent.click(within(question).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls("artifact_delete")).toEqual([{ sessionId: "s-1", artifactId: REPORT.id }]));
    await waitFor(() => expect(props.onView).toHaveBeenCalledWith(null));
  });

  it("deletes nothing on Cancel", () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete artifact" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("artifact_delete")).toEqual([]);
  });

  it("renames", async () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename Session list performance" });
    fireEvent.change(field, { target: { value: "List speed" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls("artifact_rename")).toEqual([{ sessionId: "s-1", artifactId: REPORT.id, title: "List speed" }]));
  });
});

describe("comments", () => {
  const commentsState = (overrides: Partial<import("../hooks/useArtifactComments").ArtifactCommentsState> = {}) => ({
    sessionId: "s-1",
    comments: [],
    isCommenting: false,
    setCommenting: vi.fn(),
    candidate: null,
    candidateBody: () => "",
    setCandidateBody: vi.fn(),
    cancelCandidate: vi.fn(),
    saveCandidate: vi.fn(() => "saved" as const),
    missing: new Set<number>(),
    startArtboardComment: vi.fn(),
    canvasMissing: new Map(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    clearSent: vi.fn(),
    ...overrides,
  });
  const addReview = () => ({ inMessage: new Set<string>(), blockedReason: undefined, add: vi.fn(), addCanvas: vi.fn() });

  it("Comment is off on an older version, with the reason", () => {
    show({ viewed: { artifactId: REPORT.id, version: 2 }, comments: commentsState(), addReview: addReview(), cwd: "/w" });

    const button = screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Comments go on the newest version.")).toBeTruthy();
  });

  it("pressing Comment calls setCommenting(true)", () => {
    const comments = commentsState();
    show({ ...viewingReport, comments, addReview: addReview(), cwd: "/w" });

    const button = screen.getByRole("button", { name: "Comment" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);

    expect(comments.setCommenting).toHaveBeenCalledWith(true);
  });

  it("Reload turns comment mode off first", () => {
    const comments = commentsState({ isCommenting: true });
    show({ ...viewingReport, comments, addReview: addReview(), cwd: "/w" });

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(comments.setCommenting).toHaveBeenCalledWith(false);
  });

  it("Expand keeps comment mode and the half-written candidate", () => {
    const candidate = {
      page: { sessionId: "s-1", artifactId: REPORT.id, version: 3 },
      anchor: { kind: "text" as const, quote: "Annual", before: "", after: "" },
      isPickHeld: false,
    };
    const comments = commentsState({ isCommenting: true, candidate, candidateBody: () => "Half written" });
    const { unmount } = show({ ...viewingReport, comments, addReview: addReview(), cwd: "/w" });
    unmount();

    show({ ...viewingReport, isExpanded: true, comments, addReview: addReview(), cwd: "/w" });

    expect(screen.getByRole("button", { name: "Comment" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox", { name: /Comment on/ }) as HTMLTextAreaElement).value).toBe("Half written");
  });

  it("no strip or button without comments state", () => {
    show(viewingReport);

    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Comments on this page" })).toBeNull();
  });
});

describe("the Artifacts tab's files and empty state", () => {
  const MADE = [
    { path: "/w/zorvo/src/lib/pr-chip.ts", at: Date.now() - 6 * 60_000 },
    { path: "/elsewhere/notes.md", at: Date.now() - 7 * 60_000 },
  ];

  it("says what will show there while the agent has made nothing", () => {
    show({ artifacts: [], files: [], agentName: "Claude Code" });
    expect(screen.getByText("Nothing yet. Pages and files Claude Code makes in this session show here.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Artifacts" })).toBeNull();
  });

  it("lists the files the agent made under its pages, and opens one inside the folder in the file viewer", () => {
    const onOpenFile = vi.fn();
    show({ artifacts: [REPORT], files: MADE, filesRoot: "/w/zorvo", onOpenFile });

    const rows = within(screen.getByRole("list", { name: "Artifacts" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain(REPORT.title);
    expect(rows[1].textContent).toContain("pr-chip.ts");
    expect(rows[1].textContent).toContain("New file · src/lib");

    fireEvent.click(within(rows[1]).getByRole("button"));
    expect(onOpenFile).toHaveBeenCalledWith("src/lib/pr-chip.ts");
    // A file outside the folder is named, not offered.
    expect(within(rows[2]).queryByRole("button")).toBeNull();
    expect(rows[2].textContent).toContain("notes.md");
  });

  it("says no time for a file whose time is not known", () => {
    show({ artifacts: [], files: [{ path: "/w/zorvo/src/replayed.ts", at: null }], filesRoot: "/w/zorvo" });
    const row = within(screen.getByRole("list", { name: "Artifacts" })).getByRole("listitem");
    expect(row.textContent).toContain("New file · src");
    expect(row.textContent).not.toMatch(/ago|now/i);
  });

  it("opens a single page by itself only when no file is listed beside it", () => {
    show({ artifacts: [REPORT], files: MADE, filesRoot: "/w/zorvo" });
    expect(screen.getByRole("list", { name: "Artifacts" })).toBeTruthy();
  });
});


describe("canvases", () => {
  const CANVAS_KEY = "c-0123456789abcdef";
  const ENTRY = { key: CANVAS_KEY, folder: "/w/design/checkout", relative: "design/checkout", title: "Checkout", shownAt: 4_000, artboards: 12 };
  const READ = {
    entry: ENTRY,
    canvas: { title: "Checkout", sections: [{ id: "flow", title: "Flow", artboards: [{ id: "cart", title: "Cart", file: "cart.html", width: 1440, height: 900, group: null }] }] },
    error: null,
    boards: [{ id: "cart", sha256: "a".repeat(64) }],
  };

  it("lists a canvas in the Artifacts tab and opens it", async () => {
    spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => (cmd === "canvas_read" ? Promise.resolve(READ) : fakeTauriInvoke(cmd, args)));
    const { props, rerender } = show({ canvases: [ENTRY] });

    const row = screen.getByRole("button", { name: /^Checkout/ });
    expect(row.textContent).toContain("Canvas · 12 artboards · design/checkout");
    fireEvent.click(row);
    expect(props.onView).toHaveBeenCalledWith({ canvasKey: CANVAS_KEY });

    rerender(<ArtifactsPanel {...props} canvases={[ENTRY]} viewed={{ canvasKey: CANVAS_KEY }} />);
    await waitFor(() => expect(calls("canvas_view_show")).toHaveLength(1));
    expect(calls("canvas_view_show")[0]).toEqual({ sessionId: "s-1", key: CANVAS_KEY, ...RECT });
    expect(calls("artifact_view_show")).toEqual([]);
  });

  it("says when a canvas's folder is gone", () => {
    show({ canvases: [{ ...ENTRY, folderGone: true }] });

    // As in the artboard, a row whose folder is gone opens nothing: only its menu is left.
    expect(screen.queryByRole("button", { name: /^Checkout/ })).toBeNull();
    const row = within(screen.getByRole("list", { name: "Artifacts" }))
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("Checkout"))!;
    expect(row.textContent).toContain("Canvas · design/checkout");
    expect(row.textContent).not.toContain("12 artboards");
    expect(row.textContent).toContain("Folder not found");
  });

  it("removes a canvas from its menu", async () => {
    const { props } = show({ canvases: [ENTRY] });

    fireEvent.click(screen.getByRole("button", { name: "More actions for Checkout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Remove/ }));

    await waitFor(() => expect(calls("canvas_forget")).toEqual([{ sessionId: "s-1", key: CANVAS_KEY }]));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("does not open a single page by itself while a canvas is listed", () => {
    show({ artifacts: [REPORT], canvases: [ENTRY] });
    expect(screen.getByRole("list", { name: "Artifacts" })).toBeTruthy();
  });
});

describe("motions and videos", () => {
  const MOTION = { key: "m-0123456789abcdef", folder: "/w/promo", relative: "promo", title: "Promo", shownAt: 5, duration: 15, formats: ["wide", "tall"] };
  const VIDEO = { key: "v-0123456789abcdef", path: "/w/out/reel.mp4", relative: "out/reel.mp4", title: "Reel", shownAt: 4 };

  it("lists them and opens each by its key", () => {
    const { props } = show({ motions: [MOTION], videos: [VIDEO] });
    expect(screen.getByText("Video · 15 s · 2 formats · promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/ }));
    expect(props.onView).toHaveBeenCalledWith({ motionKey: MOTION.key });
    fireEvent.click(screen.getByRole("button", { name: /Reel/ }));
    expect(props.onView).toHaveBeenCalledWith({ videoKey: VIDEO.key });
  });

  it("shows a motion's preview, formats and renders", async () => {
    spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "motion_read") {
        return Promise.resolve({
          entry: MOTION,
          title: "Promo",
          duration: 15,
          fps: 60,
          poster: 5,
          tracks: 1,
          formats: [
            { id: "wide", width: 1920, height: 1080, hasRender: true, isUpToDate: true },
            { id: "tall", width: 1080, height: 1920, hasRender: false, isUpToDate: false },
          ],
          jobs: [],
          error: null,
          warnings: [],
        });
      }
      return fakeTauriInvoke(cmd, args);
    });
    show({ artifacts: [], motions: [MOTION], viewed: { motionKey: MOTION.key } });
    expect(await screen.findByRole("radio", { name: "wide" })).toBeTruthy();
    expect(screen.getByText("Preview has no motion blur. Exports do.")).toBeTruthy();
    expect(screen.getByText("Rendered")).toBeTruthy();
    expect(screen.getByText("Not rendered")).toBeTruthy();
    await waitFor(() => expect(calls("motion_view_show").length).toBeGreaterThan(0));
    expect(calls("motion_view_show")[0]).toMatchObject({ sessionId: "s-1", key: MOTION.key, format: "wide" });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(calls("motion_view_command")).toContainEqual({ sessionId: "s-1", key: MOTION.key, name: "play" });
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
  });
});
