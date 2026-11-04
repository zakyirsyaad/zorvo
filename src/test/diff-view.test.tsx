import { useLayoutEffect } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, act, within } from "@testing-library/react";
import { DiffStatChip } from "../components/changes/DiffStatChip";
import { DiffFileSection } from "../components/changes/DiffFileSection";
import { DiffView } from "../components/changes/DiffView";
import type { FileStat } from "../lib/diff-stats";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const DIFF = "@@ -10,2 +10,2 @@\n context\n-old\n+new\n";

// Reads left unanswered by a test. File diffs share one limiter across tests,
// and a read holds its slot until it settles, so each is settled afterwards.
const unanswered: Array<() => void> = [];
function hang<T>(): Promise<T> {
  return new Promise<T>((_, reject) => unanswered.push(() => reject("test over")));
}
afterEach(async () => {
  unanswered.splice(0).forEach((settle) => settle());
  await act(async () => {});
});

const STAT: FileStat = { path: "src/lib/app.ts", oldPath: null, kind: "modified", added: 3, removed: 1, isBinary: false, fingerprint: "f1" };

function renderSection(stat: FileStat, isOpen: boolean) {
  return render(
    <DiffFileSection rootPath="/w" stat={stat} target="base" version={1} isOpen={isOpen} onToggle={() => {}} />,
  );
}

describe("DiffStatChip", () => {
  it("shows the counts and opens the diff", () => {
    const onOpen = vi.fn();
    render(<DiffStatChip added={2847} removed={35} onOpen={onOpen} />);

    const button = screen.getByRole("button", { name: "2,847 lines added, 35 removed. Open the diff" });
    expect(button.textContent).toContain("+2,847");
    expect(button.textContent).toContain("−35");
    // A bordered contextual chip, like Plan and background tasks.
    expect(button.classList.contains("border-border")).toBe(true);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders nothing without changes", () => {
    const { container } = render(<DiffStatChip added={0} removed={0} onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("the_chip_stays_hidden_at_zero_with_nothing_to_review", () => {
    const { container } = render(<DiffStatChip added={0} removed={0} commentCount={0} isAlwaysShown={false} onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("the_diff_chip_shows_at_zero_changes_when_always_shown", () => {
    const onOpen = vi.fn();
    render(<DiffStatChip added={0} removed={0} commentCount={2} isAlwaysShown onOpen={onOpen} />);

    const button = screen.getByRole("button", { name: /2 comments/ });
    expect(button.getAttribute("aria-label")).toBe("0 lines added, 0 removed, 2 comments. Open the diff");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("says one comment in the singular and none when there are no comments", () => {
    const { rerender } = render(<DiffStatChip added={1} removed={0} commentCount={1} onOpen={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("1 lines added, 0 removed, 1 comment. Open the diff");

    rerender(<DiffStatChip added={0} removed={0} isAlwaysShown onOpen={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("0 lines added, 0 removed. Open the diff");
  });
});

describe("DiffFileSection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays closed without reading the diff", () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    renderSection(STAT, false);

    const header = screen.getByRole("button", { expanded: false });
    expect(header.textContent).toContain("app.ts");
    expect(header.textContent).toContain("src/lib");
    expect(header.textContent).toContain("+3");
    expect(header.textContent).toContain("−1");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads the diff against the target and numbers the lines when open", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd) => Promise.resolve(cmd === "session_file_diff" ? DIFF : undefined));
    await act(async () => {
      renderSection(STAT, true);
    });

    expect(spy).toHaveBeenCalledWith(
      "session_file_diff",
      { path: "/w", file: "src/lib/app.ts", target: "base" },
      undefined,
    );
    const gutters = (kind: string) =>
      Array.from(document.querySelector(`[data-line="${kind}"]`)!.children)
        .slice(0, 2)
        .map((cell) => cell.textContent);
    expect(gutters("context")).toEqual(["10", "10"]);
    expect(gutters("removed")).toEqual(["11", ""]);
    expect(gutters("added")).toEqual(["", "11"]);
  });

  it("notes a binary file without reading it", () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    renderSection({ ...STAT, isBinary: true }, true);

    expect(screen.getByText("Binary file")).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("toggles when the header is clicked", () => {
    const onToggle = vi.fn();
    render(<DiffFileSection rootPath="/w" stat={STAT} target="base" version={1} isOpen={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("titles a renamed file with where it came from", () => {
    renderSection({ ...STAT, oldPath: "src/old.ts", kind: "renamed" }, false);

    expect(screen.getByRole("button", { expanded: false }).getAttribute("title")).toBe("src/old.ts → src/lib/app.ts");
  });

  it("titles a plain file with its path", () => {
    renderSection(STAT, false);

    expect(screen.getByRole("button", { expanded: false }).getAttribute("title")).toBe("src/lib/app.ts");
  });

  it("names a nested repository by its folder", () => {
    renderSection({ ...STAT, path: "vendor/lib/", kind: "untracked", isBinary: true }, false);

    // Name "lib", then its folder "vendor"; not an empty name under "vendor/lib".
    expect(screen.getByRole("button", { expanded: false }).textContent?.startsWith("libvendor")).toBe(true);
  });

  it("never shows the previous target's error in the first frame of the next", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((_cmd, args) =>
      args?.target === "head" ? Promise.reject("no such base") : hang<string>(),
    );
    const frames: string[] = [];
    function FirstFrame() {
      useLayoutEffect(() => {
        frames.push(document.body.textContent ?? "");
      });
      return null;
    }
    const view = (target: "head" | "base") => (
      <>
        <DiffFileSection rootPath="/w" stat={STAT} target={target} version={1} isOpen onToggle={() => {}} />
        <FirstFrame />
      </>
    );
    const { rerender } = render(view("head"));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("no such base");
    frames.length = 0;

    rerender(view("base"));

    expect(frames[0]).not.toContain("no such base");
  });

  it("drops the diff of the previous target while the new one is read", async () => {
    let resolveBase: (diff: string) => void = () => {};
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((_cmd, args) =>
      args?.target === "head"
        ? Promise.resolve("@@ -1 +1 @@\n-alpha\n+beta\n")
        : new Promise<string>((resolve) => {
            resolveBase = resolve;
          }),
    );
    const view = (target: "head" | "base") => (
      <DiffFileSection rootPath="/w" stat={STAT} target={target} version={1} isOpen onToggle={() => {}} />
    );
    const { rerender } = render(view("head"));
    await act(async () => {});
    expect(screen.getByText("beta")).toBeDefined();

    rerender(view("base"));

    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.getByText("Loading the diff…")).toBeDefined();
    await act(async () => resolveBase("@@ -1 +1 @@\n-x\n+gamma\n"));
    expect(within(screen.getByLabelText("Diff of src/lib/app.ts")).getByText("gamma")).toBeDefined();
  });
});

const statOf = (path: string, fingerprint = "f1"): FileStat => ({ path, oldPath: null, kind: "modified", added: 1, removed: 1, isBinary: false, fingerprint });

function mockDiff(stats: FileStat[], targets: { base: { name: string } | null } = { base: { name: "main" } }) {
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
    if (cmd === "session_diff_targets") return Promise.resolve(targets);
    if (cmd === "session_diff_stats") return Promise.resolve(stats);
    return Promise.resolve("");
  });
}

async function renderView(props: Partial<React.ComponentProps<typeof DiffView>> = {}) {
  const handlers = { onToggleExpanded: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
  await act(async () => {
    render(<DiffView rootPath="/w" version={1} isExpanded={false} {...handlers} {...props} />);
  });
  return handlers;
}

const THREE = [statOf("src/app.ts"), statOf("src/lib/util.ts"), statOf("README.md")];
const statCalls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => c[0] === "session_diff_stats");

describe("DiffView", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows what is compared and compares against the base first", async () => {
    const spy = mockDiff(THREE);
    await renderView();

    expect(screen.getByRole("button", { name: "Diff target: main → working tree" })).toBeDefined();
    expect(statCalls(spy).map((c) => (c[1] as { target: string }).target)).toEqual(["base"]);
  });

  it("reads HEAD and reports once when the targets cannot be read", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      cmd === "session_diff_targets"
        ? Promise.reject("boom")
        : Promise.resolve(cmd === "session_diff_stats" ? THREE : ""),
    );
    const { onError } = await renderView();

    expect(statCalls(spy).map((c) => (c[1] as { target: string }).target)).toEqual(["head"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain("/w");
    expect(screen.getByText("HEAD → working tree")).toBeDefined();
  });

  it("reads against HEAD after choosing it in the dropdown", async () => {
    const spy = mockDiff(THREE);
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "HEAD → working tree" }));
    });

    expect(spy).toHaveBeenCalledWith("session_diff_stats", { path: "/w", target: "head" }, undefined);
    expect(screen.getByRole("button", { name: "Diff target: HEAD → working tree" })).toBeDefined();
  });

  it("falls back to HEAD when a chosen base goes away", async () => {
    let targets: { base: { name: string } | null } = { base: { name: "main" } };
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
      if (cmd === "session_diff_targets") return Promise.resolve(targets);
      if (cmd === "session_diff_stats") return Promise.resolve(THREE);
      return Promise.resolve("");
    });
    const handlers = { onToggleExpanded: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<DiffView rootPath="/w" version={1} isExpanded={false} {...handlers} />));
    });
    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "main → working tree" }));
    });

    // The user checks out main: there is no base to compare with any more.
    targets = { base: null };
    await act(async () => {
      rerender(<DiffView rootPath="/w" version={2} isExpanded={false} {...handlers} />);
    });

    expect(screen.getByText("HEAD → working tree")).toBeDefined();
    expect(statCalls(spy).at(-1)?.[1]).toEqual({ path: "/w", target: "head" });
  });

  it("shows plain text without a dropdown when there is no base", async () => {
    const spy = mockDiff(THREE, { base: null });
    await renderView();

    expect(screen.getByText("HEAD → working tree")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Diff target/ })).toBeNull();
    expect(spy).toHaveBeenCalledWith("session_diff_stats", { path: "/w", target: "head" }, undefined);
  });

  it("filters the files by the search text", async () => {
    mockDiff(THREE);
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: "Search files" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter files" }), { target: { value: "app" } });

    expect(screen.getByText("app.ts")).toBeDefined();
    expect(screen.queryByText("util.ts")).toBeNull();
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("collapses and expands every section from the menu", async () => {
    mockDiff(THREE);
    await renderView();
    const expandedStates = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded") && b.hasAttribute("title") && b.getAttribute("aria-haspopup") === null).map((b) => b.getAttribute("aria-expanded"));
    expect(expandedStates()).toEqual(["true", "true", "true"]);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all" }));
    expect(expandedStates()).toEqual(["false", "false", "false"]);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Expand all" }));
    });
    expect(expandedStates()).toEqual(["true", "true", "true"]);
  });

  it("reads the stats again on Refresh", async () => {
    const spy = mockDiff(THREE);
    await renderView();
    const before = statCalls(spy).length;

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
    });

    expect(statCalls(spy).length).toBe(before + 1);
  });

  it("reads an open file's diff again only when the file changed", async () => {
    let stats = THREE;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: null });
      if (cmd === "session_diff_stats") return Promise.resolve(stats);
      return Promise.resolve("@@ -1 +1 @@\n-a\n+b\n");
    });
    const handlers = { onToggleExpanded: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<DiffView rootPath="/w" version={1} isExpanded={false} {...handlers} />));
    });
    const diffReads = () => spy.mock.calls.filter((c) => c[0] === "session_file_diff").map((c) => (c[1] as { file: string }).file);
    expect(diffReads()).toHaveLength(3);

    // The list is read again (window focus) but nothing changed: no diff is read.
    await act(async () => {
      rerender(<DiffView rootPath="/w" version={2} isExpanded={false} {...handlers} />);
    });
    expect(diffReads()).toHaveLength(3);

    // One file changed: only its diff is read again.
    stats = [statOf("src/app.ts", "f2"), statOf("src/lib/util.ts"), statOf("README.md")];
    await act(async () => {
      rerender(<DiffView rootPath="/w" version={3} isExpanded={false} {...handlers} />);
    });
    expect(diffReads().slice(3)).toEqual(["src/app.ts"]);
  });

  it("reads a few diffs at a time when many sections are open", async () => {
    const files = Array.from({ length: 10 }, (_, i) => statOf(`src/f${i}.ts`));
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: null });
      if (cmd === "session_diff_stats") return Promise.resolve(files);
      return hang();
    });
    await renderView();

    expect(spy.mock.calls.filter((c) => c[0] === "session_file_diff")).toHaveLength(4);
  });

  it("opens a small list after switching away from a large one", async () => {
    const many = Array.from({ length: 26 }, (_, i) => statOf(`src/f${i}.ts`));
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: { name: "main" } });
      if (cmd === "session_diff_stats") return Promise.resolve((args as { target: string }).target === "base" ? many : THREE);
      return Promise.resolve("");
    });
    await renderView();
    const sections = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded") && b.hasAttribute("title") && b.getAttribute("aria-haspopup") === null);
    expect(sections().every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "HEAD → working tree" }));
    });

    expect(sections().map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "true", "true"]);
  });

  it("keeps each target's open sections when switching back", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: { name: "main" } });
      if (cmd === "session_diff_stats") return Promise.resolve((args as { target: string }).target === "base" ? THREE : [statOf("only-head.ts")]);
      return Promise.resolve("");
    });
    await renderView();
    const states = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded") && b.hasAttribute("title") && b.getAttribute("aria-haspopup") === null).map((b) => b.getAttribute("aria-expanded"));
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all" }));
    const pick = async (from: string, to: string) => {
      fireEvent.click(screen.getByRole("button", { name: `Diff target: ${from}` }));
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: to }));
      });
    };

    await pick("main → working tree", "HEAD → working tree");
    await pick("HEAD → working tree", "main → working tree");

    expect(states()).toEqual(["false", "false", "false"]);
  });

  it("hands expand and close to its owner", async () => {
    mockDiff(THREE);
    const { onToggleExpanded, onClose } = await renderView();

    fireEvent.click(screen.getByRole("button", { name: "Expand diff view" }));
    fireEvent.click(screen.getByRole("button", { name: "Close diff view" }));

    expect(onToggleExpanded).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers no expand button when it always fills the chat area", async () => {
    mockDiff(THREE);
    await renderView({ onToggleExpanded: undefined, isExpanded: true });

    expect(screen.queryByRole("button", { name: /^(Expand|Shrink) diff view$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Close diff view" })).toBeDefined();
  });

  it("starts every section collapsed above 25 files", async () => {
    mockDiff(Array.from({ length: 26 }, (_, i) => statOf(`src/f${i}.ts`)));
    await renderView();

    const headers = screen.getAllByRole("button").filter((b) => b.getAttribute("title")?.startsWith("src/f"));
    expect(headers).toHaveLength(26);
    expect(headers.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
  });

  it("keeps the user's choices when a later list crosses the limit", async () => {
    mockDiff(THREE);
    const view = render(<DiffView rootPath="/w" version={1} isExpanded={false} onToggleExpanded={() => {}} onClose={() => {}} onError={() => {}} />);
    await act(async () => {});
    mockDiff(Array.from({ length: 26 }, (_, i) => statOf(`src/f${i}.ts`)).concat(THREE));
    await act(async () => view.rerender(<DiffView rootPath="/w" version={2} isExpanded={false} onToggleExpanded={() => {}} onClose={() => {}} onError={() => {}} />));

    expect(screen.getByTitle("src/app.ts").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTitle("src/f0.ts").getAttribute("aria-expanded")).toBe("false");
  });

  it("says there are no changes against the compared branch", async () => {
    mockDiff([]);
    await renderView();
    expect(screen.getByText("No changes against main.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "HEAD → working tree" }));
    });
    expect(screen.getByText("No changes against HEAD.")).toBeDefined();
  });
});

const START = "abc123def456";
const LOST_START = "The start of this worktree is no longer in this repository.";
const BACKEND_LOST = "This repository does not have the start commit";
const onErrorOnce = vi.fn();
const START_LABEL = "Start of this worktree → working tree";

function mockSession(options: { base: { name: string } | null; since?: FileStat[] | "lost"; stats?: FileStat[] }) {
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
    if (cmd === "session_diff_targets") return Promise.resolve({ base: options.base, root: "/w", prefix: "" });
    if (cmd === "session_diff_stats") return Promise.resolve(options.stats ?? THREE);
    if (cmd === "session_diff_stats_since") {
      return options.since === "lost" ? Promise.reject(BACKEND_LOST) : Promise.resolve(options.since ?? THREE);
    }
    if (cmd === "session_file_diff") return Promise.resolve(DIFF);
    return Promise.resolve("");
  });
}
const callsOf = (spy: { mock: { calls: unknown[][] } }, cmd: string) => spy.mock.calls.filter((c) => c[0] === cmd);

describe("DiffView with the start of the worktree", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    onErrorOnce.mockClear();
  });

  it("a_session_in_a_compare_run_opens_on_the_start_of_its_worktree", async () => {
    const spy = mockSession({ base: { name: "main" }, since: [STAT] });
    await renderView({ startCommit: START, prefersStart: true });

    expect(screen.getByRole("button", { name: `Diff target: ${START_LABEL}` })).toBeDefined();
    expect(callsOf(spy, "session_diff_stats_since").map((c) => c[1])).toEqual([{ path: "/w", commit: START }]);
    expect(callsOf(spy, "session_diff_stats")).toHaveLength(0);
    expect(callsOf(spy, "session_file_diff").map((c) => c[1])).toEqual([
      { path: "/w", file: "src/lib/app.ts", target: "head", since: START },
    ]);
  });

  it("an_ordinary_worktree_session_keeps_its_base_target_and_offers_start", async () => {
    const spy = mockSession({ base: { name: "main" } });
    await renderView({ startCommit: START });

    expect(screen.getByRole("button", { name: "Diff target: main → working tree" })).toBeDefined();
    expect(callsOf(spy, "session_diff_stats_since")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      START_LABEL,
      "main → working tree",
      "HEAD → working tree",
    ]);
  });

  it("reads the start's changes after choosing it in the picker", async () => {
    const spy = mockSession({ base: { name: "main" } });
    await renderView({ startCommit: START });

    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: START_LABEL }));
    });

    expect(spy).toHaveBeenCalledWith("session_diff_stats_since", { path: "/w", commit: START }, undefined);
    expect(screen.getByRole("button", { name: `Diff target: ${START_LABEL}` })).toBeDefined();
  });

  it("the_picker_shows_with_a_start_and_no_base", async () => {
    mockSession({ base: null });
    await renderView({ startCommit: START });

    expect(screen.getByRole("button", { name: "Diff target: HEAD → working tree" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Diff target: HEAD → working tree" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([START_LABEL, "HEAD → working tree"]);
  });

  it("keeps the plain label without a base or a start", async () => {
    mockSession({ base: null });
    await renderView();

    expect(screen.getByText("HEAD → working tree")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Diff target/ })).toBeNull();
  });

  it("a_lost_start_commit_falls_back_with_a_notice", async () => {
    const spy = mockSession({ base: { name: "main" }, since: "lost" });
    const { onError } = await renderView({ startCommit: START, prefersStart: true });

    expect(onError).toHaveBeenCalledWith(LOST_START);
    expect(screen.getByRole("button", { name: "Diff target: main → working tree" })).toBeDefined();
    expect(screen.queryByText("Reading the changes…")).toBeNull();
    expect(callsOf(spy, "session_diff_stats").map((c) => c[1])).toEqual([{ path: "/w", target: "base" }]);
    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["main → working tree", "HEAD → working tree"]);
  });

  it("a_lost_start_does_not_use_up_the_report_for_a_later_failed_read", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: { name: "main" }, root: "/w", prefix: "" });
      if (cmd === "session_diff_stats_since") return Promise.reject(BACKEND_LOST);
      if (cmd === "session_diff_stats") return Promise.reject("base is gone too");
      return Promise.resolve("");
    });
    const { onError } = await renderView({ startCommit: START, prefersStart: true });

    expect(onError.mock.calls.map((c) => c[0])).toEqual([LOST_START, expect.stringContaining("base is gone too")]);
  });

  it("a_transient_failure_stays_on_start_and_reports_it", async () => {
    let isGitBusy = true;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: { name: "main" }, root: "/w", prefix: "" });
      if (cmd === "session_diff_stats_since") return isGitBusy ? Promise.reject("git failed") : Promise.resolve(THREE);
      return Promise.resolve("");
    });
    const { onError } = await renderView({ startCommit: START, prefersStart: true });

    expect(screen.getByRole("button", { name: `Diff target: ${START_LABEL}` })).toBeDefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain("git failed");
    expect(onError).not.toHaveBeenCalledWith(LOST_START);
    expect(callsOf(spy, "session_diff_stats")).toHaveLength(0);

    isGitBusy = false;
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
    });
    expect(screen.getByText("app.ts")).toBeDefined();
    expect(screen.getByRole("button", { name: `Diff target: ${START_LABEL}` })).toBeDefined();
  });

  it("the_lost_notice_fires_once", async () => {
    mockSession({ base: { name: "main" }, since: "lost" });
    const view = render(
      <DiffView rootPath="/w" version={1} isExpanded={false} onToggleExpanded={() => {}} onClose={() => {}} onError={onErrorOnce} startCommit={START} prefersStart />,
    );
    await act(async () => {});
    await act(async () =>
      view.rerender(
        <DiffView rootPath="/w" version={2} isExpanded={false} onToggleExpanded={() => {}} onClose={() => {}} onError={onErrorOnce} startCommit={START} prefersStart />,
      ),
    );

    expect(onErrorOnce.mock.calls.filter((c) => c[0] === LOST_START)).toHaveLength(1);
  });

  it("an_answer_for_the_old_target_is_ignored_after_a_switch", async () => {
    let settleStart: (outcome: "answer" | "lost") => void = () => {};
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
      if (cmd === "session_diff_targets") return Promise.resolve({ base: { name: "main" }, root: "/w", prefix: "" });
      if (cmd === "session_diff_stats_since") {
        return new Promise((resolve, reject) => {
          settleStart = (outcome) => (outcome === "answer" ? resolve([statOf("from-start.ts")]) : reject(BACKEND_LOST));
        });
      }
      if (cmd === "session_diff_stats") return Promise.resolve([statOf("from-head.ts")]);
      return Promise.resolve("");
    });
    const { onError } = await renderView({ startCommit: START, prefersStart: true });
    expect(screen.getByText("Reading the changes…")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: `Diff target: ${START_LABEL}` }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "main → working tree" }));
    });
    expect(screen.getByText("from-head.ts")).toBeDefined();

    await act(async () => settleStart("answer"));
    expect(screen.getByText("from-head.ts")).toBeDefined();
    expect(screen.queryByText("from-start.ts")).toBeNull();
    await act(async () => settleStart("lost"));
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Diff target: main → working tree" })).toBeDefined();
  });

  it("falls to HEAD when a lost start leaves no base", async () => {
    mockSession({ base: null, since: "lost" });
    const { onError } = await renderView({ startCommit: START, prefersStart: true });

    expect(onError).toHaveBeenCalledWith(LOST_START);
    expect(screen.getByText("HEAD → working tree")).toBeDefined();
    expect(screen.queryByText("Reading the changes…")).toBeNull();
  });

  it("says there are no changes since the start", async () => {
    mockSession({ base: { name: "main" }, since: [] });
    await renderView({ startCommit: START, prefersStart: true });

    expect(screen.getByText("No changes since the start of this worktree.")).toBeDefined();
  });
});

describe("The full diff review", () => {
  afterEach(() => vi.restoreAllMocks());

  const fileList = () => screen.queryByRole("navigation", { name: "Changed files" });
  const sectionHeader = (path: string) =>
    screen.getAllByRole("button").find((b) => b.getAttribute("title") === path && b.hasAttribute("aria-expanded")) as HTMLElement;

  it("lists the changed files on the left while expanded", async () => {
    mockDiff(THREE);
    await renderView({ isExpanded: true });
    expect(within(fileList() as HTMLElement).getAllByRole("button")).toHaveLength(3);
    cleanup();

    mockDiff(THREE);
    await renderView({ isExpanded: false });
    expect(fileList()).toBeNull();
  });

  it("opens a collapsed file chosen from the list", async () => {
    mockDiff(Array.from({ length: 26 }, (_, i) => statOf(`src/f${i}.ts`)));
    await renderView({ isExpanded: true });
    expect(sectionHeader("src/f3.ts").getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      fireEvent.click(within(fileList() as HTMLElement).getAllByRole("button")[3]);
    });

    expect(sectionHeader("src/f3.ts").getAttribute("aria-expanded")).toBe("true");
  });

  it("narrows the file list with Search files", async () => {
    mockDiff(THREE);
    await renderView({ isExpanded: true });

    fireEvent.click(screen.getByRole("button", { name: "Search files" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter files" }), { target: { value: "app" } });

    expect(within(fileList() as HTMLElement).getAllByRole("button")).toHaveLength(1);
  });

  it("shows the file count and totals in the header", async () => {
    mockDiff([statOf("src/app.ts"), { ...statOf("README.md"), added: 11, removed: 2 }]);
    await renderView();

    const header = within(screen.getByRole("group", { name: "Diff totals" }));
    expect(header.getByText("2 files")).toBeDefined();
    expect(header.getByText("+12")).toBeDefined();
    expect(header.getByText("−3")).toBeDefined();
  });
});
