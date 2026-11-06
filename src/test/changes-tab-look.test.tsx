import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ChangesPanel, type ChangesPanelProps } from "../components/changes/ChangesPanel";
import type { FileStat } from "../lib/diff-stats";
import type { FileChange } from "../lib/git-changes";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const CHANGES: FileChange[] = [
  { path: "src/app.ts", oldPath: null, kind: "modified" },
  { path: "new.md", oldPath: "old.md", kind: "renamed" },
  { path: "logo.png", oldPath: null, kind: "untracked" },
];

const statOf = (path: string, added: number, removed: number, isBinary = false): FileStat => ({
  path,
  oldPath: null,
  kind: "modified",
  added,
  removed,
  isBinary,
  fingerprint: "f1",
});

const STATS = [statOf("src/app.ts", 3, 1), statOf("new.md", 5, 0), statOf("logo.png", 0, 0, true)];

function renderPanel(overrides: Partial<ChangesPanelProps> = {}) {
  render(<ChangesPanel rootPath="/w/api" rootName="api" changes={CHANGES} version={1} onReload={vi.fn()} stats={STATS} {...overrides} />);
}

const cardOf = (path: string) => screen.getByTitle(path).closest("li") as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe("the Changes tab as drawn", () => {
  it("the summary row counts the files and opens the diff", () => {
    const onOpenDiff = vi.fn();
    renderPanel({ diffStats: { added: 12, removed: 0 }, onOpenDiff });

    const count = screen.getByText("3 files changed");
    expect(count.classList.contains("font-semibold")).toBe(true);
    const row = count.parentElement as HTMLElement;
    expect(row.textContent).toContain("+12");
    expect(row.textContent).not.toContain("−0");
    const open = screen.getByRole("button", { name: "12 lines added, 0 removed. Open the diff" });
    expect(open.textContent).toBe("Open the diff");
    fireEvent.click(open);
    expect(onOpenDiff).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Refresh changes" })).toBeDefined();
  });

  it("there is no header of its own", () => {
    renderPanel();

    expect(screen.queryByText(/Changes \(3\)/)).toBeNull();
    expect(screen.queryByText("Changes")).toBeNull();
  });

  it("each file is a bordered card with its full path and counts", () => {
    renderPanel();

    const card = cardOf("src/app.ts");
    for (const name of ["rounded-lg", "border", "border-border", "overflow-hidden"]) {
      expect(card.classList.contains(name), name).toBe(true);
    }
    expect(screen.getByTitle("src/app.ts").textContent).toContain("src/app.ts");
    expect(card.textContent).toContain("+3");
    expect(card.textContent).toContain("−1");
    // What Commit takes, and what kind of change it is, stay on the card.
    expect(screen.getByRole("checkbox", { name: "Include src/app.ts in the commit" })).toBeDefined();
    expect(card.querySelector('[aria-label="Modified"]')).not.toBeNull();
  });

  it("a card shows only nonzero counts", () => {
    renderPanel();

    expect(cardOf("old.md → new.md").textContent).toContain("+5");
    expect(cardOf("old.md → new.md").textContent).not.toContain("−");
    expect(cardOf("logo.png").textContent).not.toMatch(/[+−]\d/);
  });

  it("the inline diff scrolls inside its card", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      Promise.resolve(cmd === "session_file_diff" ? `@@ -1 +1 @@\n-a\n+${"x".repeat(400)}\n` : undefined),
    );
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByTitle("src/app.ts"));
    });

    const card = cardOf("src/app.ts");
    expect(card.classList.contains("min-w-0")).toBe(true);
    expect(card.classList.contains("bg-surface-2")).toBe(true);
    const diff = screen.getByLabelText("Diff of src/app.ts");
    expect(diff.closest(".overflow-x-auto")).not.toBeNull();
    // The card's density: one gutter, 11/18.
    expect(diff.classList.contains("text-caption")).toBe(true);
  });

  it("the commit area has a full-width Commit", () => {
    renderPanel();

    const commit = screen.getByRole("button", { name: "Commit 3 files" });
    expect(commit.classList.contains("w-full")).toBe(true);
    expect(commit.className).toContain("bg-primary");
    const message = screen.getByRole("textbox", { name: "Commit message" });
    expect(message.getAttribute("aria-label")).toBeNull();
    expect(message.classList.contains("rounded-lg")).toBe(true);
    expect(screen.queryByRole("button", { name: /Create pull request/ })).toBeNull();
  });
});
