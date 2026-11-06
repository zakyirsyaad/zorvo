import { useState, type ComponentProps } from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, renderHook, screen, fireEvent, act, within, type RenderResult } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import App from "../App";
import { ChangesPanel } from "../components/changes/ChangesPanel";
import { DiffView } from "../components/changes/DiffView";
import { useCommentedFileReads } from "../hooks/useCommentedFileReads";
import { useReviewComments } from "../hooks/useReviewComments";
import type { DiffTargetId, FileStat } from "../lib/diff-stats";
import { lineHash } from "../lib/review-comments";
import type { ReviewComment } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

const FILE = "src/app.ts";
const DIFF = "@@ -41,2 +41,2 @@\n the context\n-old line\n+const x\n";
const LIMIT_TEXT = "This session has 200 comments. Clear sent comments or delete some first.";
const GONE_TEXT = "This line is no longer here in the diff.";

const statOf = (path: string, fingerprint = "f1"): FileStat => ({
  path,
  oldPath: null,
  kind: "modified",
  added: 1,
  removed: 1,
  isBinary: false,
  fingerprint,
});

const commentOf = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c-1",
  file: FILE,
  side: "new",
  line: 42,
  lineHash: lineHash("const x"),
  quote: "const x",
  target: "head",
  body: "Use AuthError here.",
  createdAt: 1,
  ...overrides,
});

/** The session state a test watches: its comments, per session, and which sessions were written to. */
function storeOf(comments: Record<string, ReviewComment[]> = {}) {
  return { comments, written: [] as string[] };
}
type Store = ReturnType<typeof storeOf>;

type RepoOptions = {
  stats?: FileStat[] | ((target: string) => FileStat[]);
  diff?: string | ((file: string, target: string) => string | Promise<string>);
  base?: { name: string } | null;
};

function mockRepo({ stats = [statOf(FILE)], diff = DIFF, base = null }: RepoOptions = {}) {
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    const { file, target } = (args ?? {}) as { file: string; target: string };
    if (cmd === "session_diff_targets") return Promise.resolve({ base, root: "/w", prefix: "" });
    if (cmd === "session_diff_stats") return Promise.resolve(typeof stats === "function" ? stats(target) : stats);
    if (cmd === "session_diff_stats_since") return Promise.resolve(typeof stats === "function" ? stats("start") : stats);
    if (cmd === "session_file_diff") return Promise.resolve(typeof diff === "function" ? diff(file, target) : diff);
    return Promise.resolve(undefined);
  });
}

function Harness({ store, sessionId = "s-a", version = 1, view }: {
  store: Store;
  sessionId?: string;
  version?: number;
  view?: Partial<ComponentProps<typeof DiffView>>;
}) {
  const [, redraw] = useState(0);
  const update = (id: string, change: (prev: ReviewComment[]) => ReviewComment[]) => {
    store.written.push(id);
    store.comments = { ...store.comments, [id]: change(store.comments[id] ?? []) };
    redraw((n) => n + 1);
  };
  const review = useReviewComments(sessionId, store.comments[sessionId], update);
  return (
    <DiffView
      key={`${sessionId}:/w`}
      rootPath="/w"
      version={version}
      isExpanded={false}
      onToggleExpanded={() => {}}
      onClose={() => {}}
      onError={() => {}}
      review={review}
      {...view}
    />
  );
}

async function renderPanel(store = storeOf(), view?: ComponentProps<typeof Harness>["view"]) {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(<Harness store={store} view={view} />);
  });
  return result as RenderResult;
}

const row = (name: RegExp | string) => screen.getByRole("row", { name });
const addedRow = () => row(/^Line 42, added/);
const controls = () => screen.queryAllByRole("button", { name: /^Comment on line/ });

async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

async function openBox(target: HTMLElement, lineLabel: string) {
  fireEvent.mouseOver(target);
  await press(lineLabel);
}

function type(name: string, text: string) {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value: text } });
}

const saved = (store: Store, sessionId = "s-a") => store.comments[sessionId] ?? [];

// jsdom lays nothing out, and has no scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.restoreAllMocks());

describe("Where comments are offered", () => {
  it("the Changes panel without a session's comments shows no comment controls", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      Promise.resolve(cmd === "session_file_diff" ? DIFF : undefined),
    );
    render(
      <ChangesPanel
        rootPath="/w"
        rootName="w"
        changes={[{ path: FILE, oldPath: null, kind: "modified" }]}
        version={1}
        onReload={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle(FILE));
    });

    const diff = screen.getByLabelText("Diff of src/app.ts");
    expect(diff.getAttribute("role")).toBeNull();
    expect(diff.getAttribute("tabindex")).toBeNull();
    fireEvent.mouseOver(screen.getByText("const x"));
    expect(controls()).toHaveLength(0);
    expect(screen.queryByRole("row")).toBeNull();
  });

  it("a new-session draft shows no comment controls", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "session_diff_stats") return Promise.resolve([statOf(FILE)]);
      if (cmd === "session_diff_targets") return Promise.resolve({ base: null, root: "/w", prefix: "" });
      if (cmd === "session_file_diff") return Promise.resolve(DIFF);
      return fakeTauriInvoke(cmd, args);
    });
    await act(async () => {
      render(<App />);
    });

    const chip = await screen.findByRole("button", { name: /1 lines added, 1 removed/ });
    await act(async () => {
      fireEvent.click(chip);
    });

    const panel = within(screen.getByRole("complementary", { name: "Diff view" }));
    expect(await panel.findByLabelText("Diff of src/app.ts")).toBeDefined();
    expect(panel.queryByRole("grid")).toBeNull();
    fireEvent.mouseOver(panel.getByText("const x"));
    expect(controls()).toHaveLength(0);
  });

  it("offers no control on a hunk or a note row", async () => {
    mockRepo({ diff: `${DIFF}\\ No newline at end of file\n` });
    await renderPanel();

    fireEvent.mouseOver(row(/^Note: /));
    expect(controls()).toHaveLength(0);
    fireEvent.mouseOver(row(/^Section: /));
    expect(controls()).toHaveLength(0);
    fireEvent.mouseOver(addedRow());
    expect(controls()).toHaveLength(1);
  });

  it("offers no control on a symbolic link's diff", async () => {
    mockRepo({ diff: "@@ -0,0 +1 @@\n+target\n\\ Symbolic link: where it points, not what is there\n" });
    await renderPanel();

    fireEvent.mouseOver(screen.getByText("target"));

    expect(controls()).toHaveLength(0);
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("offers no control on a nested repository", async () => {
    mockRepo({ stats: [statOf("vendor/lib/")], diff: "@@ -0,0 +1 @@\n+Subproject commit abc\n" });
    await renderPanel();

    fireEvent.mouseOver(screen.getByText("Subproject commit abc"));

    expect(controls()).toHaveLength(0);
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("offers no control on a binary file, and still lists a comment on it", async () => {
    mockRepo({ stats: [{ ...statOf(FILE), isBinary: true }], diff: "Binary files a and b differ\n" });
    await renderPanel(storeOf({ "s-a": [commentOf()] }));

    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByText("Use AuthError here.")).toBeDefined();
  });

  it("one control serves the file", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `+line ${i + 1}`).join("\n");
    mockRepo({ diff: `@@ -0,0 +1,200 @@\n${lines}\n` });
    await renderPanel();

    fireEvent.mouseOver(row("Line 7, added: line 7"));
    expect(controls().map((control) => control.getAttribute("aria-label"))).toEqual(["Comment on line 7"]);

    fireEvent.mouseOver(row("Line 8, added: line 8"));
    expect(controls().map((control) => control.getAttribute("aria-label"))).toEqual(["Comment on line 8"]);
  });

  it("hides the control when the pointer leaves the diff", async () => {
    mockRepo();
    await renderPanel();

    fireEvent.mouseOver(addedRow());
    fireEvent.mouseLeave(screen.getByRole("grid"));

    expect(controls()).toHaveLength(0);
  });
});

describe("Writing a comment", () => {
  it("comments on an added line", async () => {
    mockRepo();
    const store = storeOf();
    await renderPanel(store);

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Use AuthError here.");
    await press("Save comment");

    const [comment] = saved(store);
    expect(comment).toMatchObject({
      file: FILE,
      side: "new",
      line: 42,
      lineHash: lineHash("const x"),
      quote: "const x",
      target: "head",
      body: "Use AuthError here.",
    });
    expect(comment.id).toMatch(/^comment-/);
    expect(comment.oldFile).toBeUndefined();
    const under = addedRow().nextElementSibling as HTMLElement;
    expect(within(under).getByText("Use AuthError here.")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Comment on line 42" })).toBeNull();
  });

  it("comments on a removed line, with the file's old path after a rename", async () => {
    mockRepo({ stats: [{ ...statOf(FILE), oldPath: "src/old.ts", kind: "renamed" }] });
    const store = storeOf();
    await renderPanel(store);

    await openBox(row(/^Line 42, removed/), "Comment on line 42");
    type("Comment on line 42", "Keep this.");
    await press("Save comment");

    expect(saved(store)[0]).toMatchObject({ side: "old", line: 42, oldFile: "src/old.ts", lineHash: lineHash("old line") });
    expect(within(row(/^Line 42, removed/).nextElementSibling as HTMLElement).getByText("Keep this.")).toBeDefined();
  });

  it("comments on a context line, against its new line", async () => {
    mockRepo();
    const store = storeOf();
    await renderPanel(store);

    await openBox(row(/^Line 41, unchanged/), "Comment on line 41");
    type("Comment on line 41", "Why?");
    await press("Save comment");

    expect(saved(store)[0]).toMatchObject({ side: "new", line: 41, lineHash: lineHash("the context") });
  });

  it("will not save a comment with no text", async () => {
    mockRepo();
    await renderPanel();

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "   ");

    expect((screen.getByRole("button", { name: "Save comment" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel closes the box and saves nothing", async () => {
    mockRepo();
    const store = storeOf();
    await renderPanel(store);

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Never mind");
    await press("Cancel");

    expect(screen.queryByRole("textbox", { name: "Comment on line 42" })).toBeNull();
    expect(store.written).toEqual([]);
    await openBox(addedRow(), "Comment on line 42");
    expect((screen.getByRole("textbox", { name: "Comment on line 42" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("at the limit Save says why, and keeps the text", async () => {
    mockRepo();
    const full = Array.from({ length: 200 }, (_, i) => commentOf({ id: `c-${i}`, line: 1000 + i }));
    const store = storeOf({ "s-a": full });
    await renderPanel(store);

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "One more");
    await press("Save comment");

    expect(screen.getByRole("alert").textContent).toBe(LIMIT_TEXT);
    expect(store.written).toEqual([]);
    expect((screen.getByRole("textbox", { name: "Comment on line 42" }) as HTMLTextAreaElement).value).toBe("One more");
  });

  it("a focus refresh keeps a comment being written", async () => {
    let fingerprint = "f1";
    const spy = mockRepo({ stats: () => [statOf(FILE, fingerprint)] });
    const reads = () => spy.mock.calls.filter((c) => c[0] === "session_file_diff").length;
    const store = storeOf();
    const view = await renderPanel(store);
    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Half a thought");
    const readsBefore = reads();

    // The file changed somewhere else: the same row stands at the same line, and the diff is read again.
    fingerprint = "f2";
    await act(async () => view.rerender(<Harness store={store} version={2} />));

    expect(reads()).toBeGreaterThan(readsBefore);
    expect(addedRow()).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Comment on line 42" }) as HTMLTextAreaElement).value).toBe("Half a thought");
  });

  it("a row that changes under an open box saves as outdated", async () => {
    let diff = DIFF;
    let fingerprint = "f1";
    mockRepo({ stats: () => [statOf(FILE, fingerprint)], diff: () => diff });
    const store = storeOf();
    const view = await renderPanel(store);
    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "This one");

    diff = DIFF.replace("const x", "const changed");
    fingerprint = "f2";
    await act(async () => view.rerender(<Harness store={store} version={2} />));
    expect(row("Line 42, added: const changed")).toBeDefined();
    await press("Save comment");

    expect(saved(store)[0]).toMatchObject({ lineHash: lineHash("const x"), quote: "const x", line: 42 });
    expect(screen.getByText("Outdated")).toBeDefined();
    expect(screen.getByText(GONE_TEXT)).toBeDefined();
  });

  it("a box whose row leaves the diff stays in the file's list, and saves as outdated", async () => {
    let diff = DIFF;
    let fingerprint = "f1";
    mockRepo({ stats: () => [statOf(FILE, fingerprint)], diff: () => diff });
    const store = storeOf();
    const view = await renderPanel(store);
    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Keep me");

    diff = "@@ -1 +1 @@\n-a\n+b\n";
    fingerprint = "f2";
    await act(async () => view.rerender(<Harness store={store} version={2} />));

    expect((screen.getByRole("textbox", { name: "Comment on line 42" }) as HTMLTextAreaElement).value).toBe("Keep me");
    await press("Save comment");
    expect(saved(store)[0]).toMatchObject({ line: 42, lineHash: lineHash("const x") });
    expect(screen.getByText("Outdated")).toBeDefined();
  });

  it("a box whose file leaves the diff shows in the bar under the diff", async () => {
    let stats = [statOf(FILE)];
    mockRepo({ stats: () => stats });
    const store = storeOf();
    const view = await renderPanel(store);
    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Keep me too");

    stats = [];
    await act(async () => view.rerender(<Harness store={store} version={2} />));

    const bar = screen.getByRole("region", { name: "Review comments" });
    expect(within(bar).getByText("src/app.ts:42")).toBeDefined();
    expect((within(bar).getByRole("textbox", { name: "Comment on line 42" }) as HTMLTextAreaElement).value).toBe("Keep me too");
    // The bar with Add N to message sits at the bottom of the review.
    expect(screen.getByRole("complementary", { name: "Diff view" }).lastElementChild).toBe(bar);
  });

  it("a box saved from the top bar keeps the old path", async () => {
    let stats: FileStat[] = [{ ...statOf(FILE), oldPath: "src/old.ts", kind: "renamed" }];
    mockRepo({ stats: () => stats });
    const store = storeOf();
    const view = await renderPanel(store);
    await openBox(row(/^Line 42, removed/), "Comment on line 42");
    type("Comment on line 42", "Keep this.");

    stats = [];
    await act(async () => view.rerender(<Harness store={store} version={2} />));
    await press("Save comment");

    expect(saved(store)[0]).toMatchObject({ side: "old", line: 42, file: FILE, oldFile: "src/old.ts" });
  });

  it("a new line of a renamed file saves with no old path", async () => {
    mockRepo({ stats: [{ ...statOf(FILE), oldPath: "src/old.ts", kind: "renamed" }] });
    const store = storeOf();
    await renderPanel(store);

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Fine.");
    await press("Save comment");

    expect(saved(store)[0]).not.toHaveProperty("oldFile");
  });

  it("switching sessions with a box open saves nothing to the other session", async () => {
    mockRepo();
    const store = storeOf();
    const view = await renderPanel(store);
    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "For session A");

    await act(async () => view.rerender(<Harness store={store} sessionId="s-b" />));

    expect(screen.queryByRole("textbox", { name: "Comment on line 42" })).toBeNull();
    expect(store.written).toEqual([]);

    await act(async () => view.rerender(<Harness store={store} sessionId="s-a" />));
    expect((screen.getByRole("textbox", { name: "Comment on line 42" }) as HTMLTextAreaElement).value).toBe("For session A");
    await press("Save comment");
    expect(store.written).toEqual(["s-a"]);
    expect(saved(store, "s-b")).toEqual([]);
  });
});

describe("The keyboard in a diff", () => {
  const activeRow = (grid: HTMLElement) => document.getElementById(grid.getAttribute("aria-activedescendant") ?? "");
  const focusGrid = async () => {
    const grid = screen.getByRole("grid", { name: "Diff of src/app.ts" });
    await act(async () => grid.focus());
    return grid;
  };

  it("arrow keys move between rows and Enter opens the box", async () => {
    mockRepo();
    await renderPanel();

    const grid = await focusGrid();
    expect(activeRow(grid)?.getAttribute("aria-label")).toMatch(/^Line 41, unchanged/);
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(activeRow(grid)?.getAttribute("aria-label")).toMatch(/^Line 42, added/);
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(activeRow(grid)?.getAttribute("aria-label")).toMatch(/^Line 42, added/);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(activeRow(grid)?.getAttribute("aria-label")).toMatch(/^Line 42, removed/);
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(controls()).toHaveLength(1);

    await act(async () => {
      fireEvent.keyDown(grid, { key: "Enter" });
    });

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Comment on line 42" }));
  });

  it("each file is one Tab stop", async () => {
    mockRepo();
    await renderPanel();

    const grid = await focusGrid();

    expect(grid.getAttribute("tabindex")).toBe("0");
    expect(controls()[0].getAttribute("tabindex")).toBe("-1");
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
  });

  it("Enter on a row that takes no comment does nothing", async () => {
    mockRepo();
    await renderPanel();

    const grid = await focusGrid();
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(activeRow(grid)?.getAttribute("aria-label")).toMatch(/^Section: /);
    await act(async () => {
      fireEvent.keyDown(grid, { key: "Enter" });
    });

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Enter on a row with an open box goes back to its text", async () => {
    mockRepo();
    await renderPanel();
    await openBox(addedRow(), "Comment on line 42");
    const grid = await focusGrid();
    fireEvent.mouseOver(addedRow());

    await act(async () => {
      fireEvent.keyDown(grid, { key: "Enter" });
    });

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Comment on line 42" }));
  });

  it("keys typed in the box stay in the box", async () => {
    mockRepo();
    await renderPanel();
    await openBox(addedRow(), "Comment on line 42");
    const grid = screen.getByRole("grid");
    const before = grid.getAttribute("aria-activedescendant");
    const box = screen.getByRole("textbox", { name: "Comment on line 42" });

    const isDefaultKept = fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(isDefaultKept).toBe(true);
    expect(grid.getAttribute("aria-activedescendant")).toBe(before);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("focus returns to the diff after Save and after Cancel", async () => {
    mockRepo();
    await renderPanel();

    await openBox(addedRow(), "Comment on line 42");
    await press("Cancel");
    expect(document.activeElement).toBe(screen.getByRole("grid"));

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "Done");
    await press("Save comment");
    expect(document.activeElement).toBe(screen.getByRole("grid"));
  });

  it("rows have an accessible name with their line and kind", async () => {
    mockRepo({ diff: `${DIFF}\\ No newline at end of file\n` });
    await renderPanel();

    const names = screen.getAllByRole("row").map((r) => r.getAttribute("aria-label"));

    expect(names).toEqual([
      "Section: @@ -41,2 +41,2 @@",
      "Line 41, unchanged: the context",
      "Line 42, removed: old line",
      "Line 42, added: const x",
      "Note: \\ No newline at end of file",
    ]);
  });
});

describe("Saved comments", () => {
  it("editing a sent comment makes it plain", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf({ sentAt: 5 })] });
    await renderPanel(store);
    expect(screen.getByText("Sent")).toBeDefined();

    await press("Edit");
    type("Edit comment on line 42", "Use AuthError, please.");
    await press("Save comment");

    expect(saved(store)[0].body).toBe("Use AuthError, please.");
    expect(saved(store)[0]).not.toHaveProperty("sentAt");
    expect(screen.queryByText("Sent")).toBeNull();
  });

  it("an edit survives its comment going outdated", async () => {
    let diff = DIFF;
    let fingerprint = "f1";
    mockRepo({ stats: () => [statOf(FILE, fingerprint)], diff: () => diff });
    const store = storeOf({ "s-a": [commentOf()] });
    const view = await renderPanel(store);
    await press("Edit");
    type("Edit comment on line 42", "Half an edit");

    diff = DIFF.replace("const x", "const changed");
    fingerprint = "f2";
    await act(async () => view.rerender(<Harness store={store} version={2} />));

    expect((screen.getByRole("textbox", { name: "Edit comment on line 42" }) as HTMLTextAreaElement).value).toBe("Half an edit");
  });

  it("Cancel leaves a comment as it was", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf({ sentAt: 5 })] });
    await renderPanel(store);

    await press("Edit");
    type("Edit comment on line 42", "Changed my mind");
    await press("Cancel");

    expect(saved(store)[0]).toMatchObject({ body: "Use AuthError here.", sentAt: 5 });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
  });

  it("delete asks a second click", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf(), commentOf({ id: "c-2", body: "Other one", line: 41, lineHash: lineHash("the context") })] });
    await renderPanel(store);

    const under = within(addedRow().nextElementSibling as HTMLElement);
    await act(async () => {
      fireEvent.click(under.getByRole("button", { name: "Delete" }));
    });
    expect(saved(store).map((c) => c.id)).toEqual(["c-1", "c-2"]);
    expect(store.written).toEqual([]);

    await act(async () => {
      fireEvent.click(under.getByRole("button", { name: "Confirm delete" }));
    });

    expect(saved(store).map((c) => c.id)).toEqual(["c-2"]);
    expect(screen.queryByText("Use AuthError here.")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("grid"));
  });

  it("cancel keeps the comment", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf()] });
    await renderPanel(store);

    await press("Delete");
    await press("Cancel");

    expect(store.written).toEqual([]);
    expect(screen.getByText("Use AuthError here.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
  });

  it("delete turns back by itself, and focus stays on the comment", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf()] });
    await renderPanel(store);

    vi.useFakeTimers();
    try {
      await press("Delete");
      act(() => screen.getByRole("button", { name: "Cancel" }).focus());
      act(() => {
        vi.advanceTimersByTime(4000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
    expect(store.written).toEqual([]);
  });

  it("a sent comment stays under its row, dimmed", async () => {
    mockRepo();
    await renderPanel(storeOf({ "s-a": [commentOf({ sentAt: 5 })] }));

    const under = addedRow().nextElementSibling as HTMLElement;
    expect(within(under).getByText("Sent")).toBeDefined();
    expect(within(under).getByText("Use AuthError here.").closest(".opacity-60")).not.toBeNull();
  });

  it("Clear sent removes only sent comments", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf({ sentAt: 5 }), commentOf({ id: "c-2", line: 41, lineHash: lineHash("the context"), body: "Plain" })] });
    await renderPanel(store);

    await press("Clear sent");

    expect(saved(store).map((c) => c.id)).toEqual(["c-2"]);
    expect(screen.queryByRole("button", { name: "Clear sent" })).toBeNull();
  });

  it("offers no Clear sent with nothing sent", async () => {
    mockRepo();
    await renderPanel(storeOf({ "s-a": [commentOf()] }));

    expect(await screen.findByText("Use AuthError here.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Clear sent" })).toBeNull();
  });
});

describe("How a comment stands", () => {
  it("reads commented files in closed sections", async () => {
    const stats = Array.from({ length: 30 }, (_, i) => statOf(`src/f${i}.ts`));
    const spy = mockRepo({ stats, diff: "@@ -42 +42 @@\n-old\n+something else\n" });
    await renderPanel(storeOf({ "s-a": [commentOf({ file: "src/f7.ts" })] }));

    const header = screen.getByTitle("src/f7.ts");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.textContent).toContain("1 comment, 1 outdated");
    expect(spy.mock.calls.filter((c) => c[0] === "session_file_diff").map((c) => (c[1] as { file: string }).file)).toEqual(["src/f7.ts"]);
    expect(screen.getByTitle("src/f8.ts").textContent).not.toContain("comment");
  });

  it("a current comment in a closed section reads as a count alone", async () => {
    const stats = Array.from({ length: 30 }, (_, i) => statOf(`src/f${i}.ts`));
    mockRepo({ stats });
    await renderPanel(storeOf({ "s-a": [commentOf({ file: "src/f7.ts" }), commentOf({ id: "c-2", file: "src/f7.ts", line: 41, lineHash: lineHash("the context") })] }));

    const text = screen.getByTitle("src/f7.ts").textContent;
    expect(text).toContain("2 comments");
    expect(text).not.toContain("outdated");
  });

  it("lists an outdated comment in its file", async () => {
    mockRepo({ diff: DIFF.replace("const x", "const changed") });
    await renderPanel(storeOf({ "s-a": [commentOf()] }));

    const section = screen.getByTitle(FILE).closest("section") as HTMLElement;
    expect(within(section).getByText("Outdated")).toBeDefined();
    expect(within(section).getByText("Line 42")).toBeDefined();
    expect(within(section).getByText("const x")).toBeDefined();
    expect(within(section).getByText(GONE_TEXT)).toBeDefined();
    expect(within(section).getByText("Use AuthError here.")).toBeDefined();
  });

  it("lists a comment the diff could not check in its file", async () => {
    mockRepo({ diff: () => Promise.reject("git is busy") });
    await renderPanel(storeOf({ "s-a": [commentOf()] }));

    const section = screen.getByTitle(FILE).closest("section") as HTMLElement;
    expect(within(section).getByText("Use AuthError here.")).toBeDefined();
    expect(within(section).queryByText("Outdated")).toBeNull();
    expect(within(section).getByRole("alert").textContent).toContain("git is busy");
  });

  it("a file gone from the diff lists its comments at the top", async () => {
    mockRepo({ stats: [statOf("src/other.ts")] });
    await renderPanel(storeOf({ "s-a": [commentOf()] }));

    const bar = screen.getByRole("region", { name: "Review comments" });
    expect(within(bar).getByText("Outdated")).toBeDefined();
    expect(within(bar).getByText("src/app.ts:42")).toBeDefined();
    expect(within(bar).getByText("Use AuthError here.")).toBeDefined();
  });

  it("the gone file group takes its status from commentStatus", async () => {
    mockRepo({ stats: [statOf("src/other.ts")], base: { name: "main" } });
    await renderPanel(storeOf({
      "s-a": [
        commentOf({ id: "c-gone", target: "base" }),
        commentOf({ id: "c-other", target: "head", file: "src/else.ts", line: 7 }),
      ],
    }));

    const bar = within(screen.getByRole("region", { name: "Review comments" }));
    expect(bar.getByText("src/app.ts:42").closest("p")?.textContent).toContain("Outdated");
    expect(bar.getByText("src/else.ts:7").closest("p")?.textContent).toContain("Not in this diff");
    expect(bar.getByText("src/else.ts:7").closest("p")?.textContent).not.toContain("Outdated");
  });

  it("a comment on another target shows under Not in this diff, with a link to it", async () => {
    mockRepo({ base: { name: "main" }, diff: (_file, target) => (target === "head" ? DIFF : "@@ -1 +1 @@\n-a\n+b\n") });
    await renderPanel(storeOf({ "s-a": [commentOf()] }));

    const bar = screen.getByRole("region", { name: "Review comments" });
    expect(within(bar).getByText("Not in this diff")).toBeDefined();
    expect(within(bar).getByText("src/app.ts:42")).toBeDefined();
    expect(within(bar).getByText("Use AuthError here.")).toBeDefined();

    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "Show HEAD → working tree" }));
    });

    expect(screen.getByRole("button", { name: "Diff target: HEAD → working tree" })).toBeDefined();
    expect(screen.queryByText("Not in this diff")).toBeNull();
    expect(within(addedRow().nextElementSibling as HTMLElement).getByText("Use AuthError here.")).toBeDefined();
  });

  it("a comment on a target no longer on offer says so, and can be deleted", async () => {
    mockRepo();
    const store = storeOf({ "s-a": [commentOf({ target: "start" })] });
    await renderPanel(store);

    const bar = screen.getByRole("region", { name: "Review comments" });
    expect(within(bar).getByText("a comparison no longer available")).toBeDefined();
    expect(within(bar).queryByRole("button", { name: /^Show / })).toBeNull();

    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "Delete" }));
    });
    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "Confirm delete" }));
    });
    expect(saved(store)).toEqual([]);
  });

  it("reading says so until every commented file has answered", async () => {
    let answer: (diff: string) => void = () => {};
    vi.spyOn(tauriInternals(), "invoke").mockImplementation(
      () => new Promise((resolve) => {
        answer = resolve as (diff: string) => void;
      }),
    );
    const comments = [commentOf()];
    const listed = [statOf(FILE)];
    const { result } = renderHook(() => useCommentedFileReads("/w", comments, "head" as DiffTargetId, listed, undefined, 1));
    expect(result.current.isReading).toBe(true);

    await act(async () => answer(DIFF));

    expect(result.current.isReading).toBe(false);
    expect(result.current.reads[FILE]).toMatchObject({ status: "read" });
  });

  it("a file the target does not list reads as missing, with no read", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const comments = [commentOf()];
    const listed = [statOf("other.ts")];

    const { result } = renderHook(() => useCommentedFileReads("/w", comments, "head" as DiffTargetId, listed, undefined, 1));

    expect(result.current.reads[FILE]).toEqual({ status: "missing" });
    expect(result.current.isReading).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("The top bar's chip in the app", () => {
  const session = (reviewComments: ReviewComment[]) => ({
    id: "s-a",
    name: "Alpha work",
    profileId: "claude-code",
    cwd: "/Users/test/developer/zorvo",
    status: "terminated",
    createdAt: 1,
    transport: "acp",
    reviewComments,
  });

  const renderApp = async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "session_diff_stats") return Promise.resolve([]);
      if (cmd === "session_diff_targets") return Promise.resolve({ base: null, root: "/w", prefix: "" });
      return fakeTauriInvoke(cmd, args);
    });
    await act(async () => {
      render(<App />);
    });
  };

  it("counts the comments that are not sent, with no changes to show", async () => {
    fakeStore().state.sessions = [session([commentOf(), commentOf({ id: "c-2", sentAt: 5 })])] as FakeTauriStore["state"]["sessions"];
    await renderApp();

    expect(await screen.findByRole("button", { name: "0 lines added, 0 removed, 1 comment. Open the diff" })).toBeDefined();
  });

  it("stays for a session whose comments are all sent", async () => {
    fakeStore().state.sessions = [session([commentOf({ sentAt: 5 })])] as FakeTauriStore["state"]["sessions"];
    await renderApp();

    expect(await screen.findByRole("button", { name: "0 lines added, 0 removed. Open the diff" })).toBeDefined();
  });

  it("saves a comment into the session", async () => {
    fakeStore().state.sessions = [session([])] as FakeTauriStore["state"]["sessions"];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "session_diff_stats") return Promise.resolve([statOf(FILE)]);
      if (cmd === "session_diff_targets") return Promise.resolve({ base: null, root: "/w", prefix: "" });
      if (cmd === "session_file_diff") return Promise.resolve(DIFF);
      return fakeTauriInvoke(cmd, args);
    });
    await act(async () => {
      render(<App />);
    });
    const chip = await screen.findByRole("button", { name: /1 lines added, 1 removed/ });
    await act(async () => {
      fireEvent.click(chip);
    });
    await screen.findByRole("grid");

    await openBox(addedRow(), "Comment on line 42");
    type("Comment on line 42", "From the app");
    await press("Save comment");

    expect(await screen.findByRole("button", { name: "1 lines added, 1 removed, 1 comment. Open the diff" })).toBeDefined();
    expect(within(addedRow().nextElementSibling as HTMLElement).getByText("From the app")).toBeDefined();
  });
});
