import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ChangesPanel } from "../components/changes/ChangesPanel";
import type { FileChange } from "../lib/git-changes";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const CHANGES: FileChange[] = [
  { path: "src/app.ts", oldPath: null, kind: "modified" },
  { path: "new.md", oldPath: "old.md", kind: "renamed" },
  { path: "notes.md", oldPath: null, kind: "untracked" },
];

function renderPanel(overrides: Partial<Parameters<typeof ChangesPanel>[0]> = {}) {
  const props = {
    rootPath: "/w/api",
    rootName: "api",
    changes: CHANGES,
    version: 1,
    onReload: vi.fn(),
    ...overrides,
  };
  render(<ChangesPanel {...props} />);
  return props;
}

describe("ChangesPanel inside the inspector", () => {
  it("has no close button of its own inside the inspector", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Close changes panel" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Changes panel" }).className).not.toContain("w-80");
  });
});

describe("ChangesPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists each changed file with its kind", () => {
    renderPanel();

    const list = within(screen.getByRole("list", { name: "Changes in api" }));
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(list.getByLabelText("Renamed")).toBeDefined();
    expect(list.getByTitle("old.md → new.md")).toBeDefined();
    // The inspector's own frame names the folder; the panel has no header.
    expect(screen.getByText("3 files changed")).toBeDefined();
    expect(screen.getByRole("button", { name: "Commit 3 files" })).toBeDefined();
  });

  describe("when pull requests cannot be read because of GitHub", () => {
    it("says the GitHub CLI is missing and opens Settings", () => {
      const onOpenGithubSettings = vi.fn();
      renderPanel({ pullRequests: null, onOpenPullRequest: vi.fn(), githubProblem: "not-installed", onOpenGithubSettings });

      expect(screen.getByText("Pull requests need the GitHub CLI, which is not installed.")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Open GitHub settings" }));
      expect(onOpenGithubSettings).toHaveBeenCalledTimes(1);
    });

    it("says the user is not connected", () => {
      renderPanel({
        pullRequests: null,
        onOpenPullRequest: vi.fn(),
        githubProblem: "signed-out",
        onOpenGithubSettings: vi.fn(),
      });

      expect(screen.getByText("Pull requests need you to be connected to GitHub.")).toBeDefined();
    });

    it("says nothing when the pull requests were read", () => {
      renderPanel({ pullRequests: [], onOpenPullRequest: vi.fn(), githubProblem: "signed-out", onOpenGithubSettings: vi.fn() });

      expect(screen.queryByRole("button", { name: "Open GitHub settings" })).toBeNull();
    });

    it("says nothing without a GitHub problem", () => {
      renderPanel({ pullRequests: null, onOpenPullRequest: vi.fn(), onOpenGithubSettings: vi.fn() });

      expect(screen.queryByRole("button", { name: "Open GitHub settings" })).toBeNull();
    });
  });

  it("opens the diff from the summary row", () => {
    const onOpenDiff = vi.fn();
    renderPanel({ diffStats: { added: 12, removed: 3 }, onOpenDiff });

    fireEvent.click(screen.getByRole("button", { name: "12 lines added, 3 removed. Open the diff" }));

    expect(onOpenDiff).toHaveBeenCalledTimes(1);
  });

  it("leaves no empty strip when the totals are zero", () => {
    const panel = () => screen.getByRole("complementary", { name: "Changes panel" });
    const { unmount } = render(
      <ChangesPanel rootPath="/w/api" rootName="api" changes={CHANGES} version={1} onReload={vi.fn()} />,
    );
    const withoutTotals = panel().childElementCount;
    unmount();

    renderPanel({ diffStats: { added: 0, removed: 0 }, onOpenDiff: vi.fn() });

    expect(panel().childElementCount).toBe(withoutTotals);
  });

  it("shows no chip without diff totals", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /Open the diff/ })).toBeNull();
  });

  it("shows a file's diff when it is opened", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      cmd === "session_file_diff"
        ? Promise.resolve("diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-two\n+2\n")
        : Promise.resolve(undefined),
    );
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByTitle("src/app.ts"));
    });

    expect(spy).toHaveBeenCalledWith(
      "session_file_diff",
      { path: "/w/api", file: "src/app.ts", target: "head" },
      undefined,
    );
    const diff = within(screen.getByLabelText("Diff of src/app.ts"));
    expect(diff.getByText("two").closest("[data-line]")?.getAttribute("data-line")).toBe("removed");
    expect(diff.getByText("2").closest("[data-line]")?.getAttribute("data-line")).toBe("added");
  });

  it("reads an open diff again when the list is read again", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      cmd === "session_file_diff" ? Promise.resolve("@@ -1 +1 @@\n-a\n+b\n") : Promise.resolve(undefined),
    );
    const props = {
      rootPath: "/w/api",
      rootName: "api",
      changes: CHANGES,
      version: 1,
      onReload: () => {},
      onClose: () => {},
    };
    const { rerender } = render(<ChangesPanel {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByTitle("src/app.ts"));
    });
    const reads = () => spy.mock.calls.filter(([cmd]) => cmd === "session_file_diff").length;
    expect(reads()).toBe(1);

    await act(async () => {
      rerender(<ChangesPanel {...props} changes={[...CHANGES]} version={2} />);
    });

    expect(reads()).toBe(2);
  });

  it("commits only the chosen files, with a rename's old path, and reloads", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      cmd === "commit_session_changes" ? Promise.resolve("abc1234") : Promise.resolve(undefined),
    );
    const props = renderPanel();
    const commitButton = () => screen.getByRole("button", { name: /^Commit \d+ files?$/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Include notes.md in the commit" }));
    expect(commitButton().textContent).toBe("Commit 2 files");
    expect((commitButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), { target: { value: " Fix login " } });
    await act(async () => {
      fireEvent.click(commitButton());
    });

    expect(spy).toHaveBeenCalledWith(
      "commit_session_changes",
      { path: "/w/api", files: ["src/app.ts", "new.md", "old.md"], message: "Fix login" },
      undefined,
    );
    expect(screen.getByRole("status").textContent).toContain("abc1234");
    expect(props.onReload).toHaveBeenCalled();
  });

  it("shows why a commit failed", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      cmd === "commit_session_changes" ? Promise.reject("Could not commit: Please tell me who you are") : Promise.resolve(undefined),
    );
    renderPanel();

    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), { target: { value: "Fix" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Commit 3 files" }));
    });

    expect(screen.getByRole("alert").textContent).toContain("Please tell me who you are");
  });

  it("says when there is nothing to commit, without a commit box", () => {
    renderPanel({ changes: [] });

    expect(screen.getByText("No uncommitted changes.")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Commit message" })).toBeNull();
  });

  it("discards a modified file after a two-click confirmation and reloads", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockResolvedValue(undefined);
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes to src/app.ts" }));
    expect(spy).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "Confirm discard src/app.ts" });
    expect(confirm.textContent).toBe("Discard?");
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(spy).toHaveBeenCalledWith(
      "discard_session_change",
      { path: "/w/api", file: "src/app.ts" },
      undefined,
    );
    expect(screen.getByRole("status").textContent).toBe("Discarded changes to src/app.ts.");
    expect(props.onReload).toHaveBeenCalled();
  });

  it("cancels discard confirmation on Escape without invoking the backend", () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes to src/app.ts" }));
    const confirm = screen.getByRole("button", { name: "Confirm discard src/app.ts" });
    fireEvent.keyDown(confirm, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Confirm discard src/app.ts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard changes to src/app.ts" })).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("prompts Delete? for untracked files and deletes after confirmation", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockResolvedValue(undefined);
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Delete notes.md" }));
    const confirm = screen.getByRole("button", { name: "Confirm delete notes.md" });
    expect(confirm.textContent).toBe("Delete?");
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(spy).toHaveBeenCalledWith(
      "discard_session_change",
      { path: "/w/api", file: "notes.md" },
      undefined,
    );
    expect(screen.getByRole("status").textContent).toBe("Deleted notes.md.");
    expect(props.onReload).toHaveBeenCalled();
  });

  it("shows an alert when discarding a file fails", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      cmd === "discard_session_change" ? Promise.reject("Could not discard changes to src/app.ts") : Promise.resolve(undefined),
    );
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes to src/app.ts" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm discard src/app.ts" }));
    });

    expect(screen.getByRole("alert").textContent).toContain("Could not discard changes to src/app.ts");
  });
});
