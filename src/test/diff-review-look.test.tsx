import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { DiffView, type DiffViewProps } from "../components/changes/DiffView";
import { useReviewComments } from "../hooks/useReviewComments";
import type { FileStat } from "../lib/diff-stats";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const statOf = (path: string, added: number, removed: number, isBinary = false): FileStat => ({
  path,
  oldPath: null,
  kind: "modified",
  added,
  removed,
  isBinary,
  fingerprint: "f1",
});

const STATS = [statOf("src/added.ts", 14, 0), statOf("src/lib/removed.ts", 0, 5), statOf("logo.png", 0, 0, true)];
const DIFF = "@@ -1,1 +1,1 @@\n-a\n+b\n";

function mockRepo() {
  vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
    if (cmd === "session_diff_targets") return Promise.resolve({ base: { name: "main" }, root: "/w", prefix: "" });
    if (cmd === "session_diff_stats") return Promise.resolve(STATS);
    if (cmd === "session_file_diff") return Promise.resolve(DIFF);
    return Promise.resolve(undefined);
  });
}

function WithComments(props: Partial<DiffViewProps>) {
  const review = useReviewComments("s-a", [], () => {});
  return <DiffView rootPath="/w" version={1} isExpanded={false} onClose={() => {}} onError={() => {}} review={review} {...props} />;
}

async function renderView(props: Partial<DiffViewProps> = {}) {
  mockRepo();
  await act(async () => {
    render(<WithComments {...props} />);
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.restoreAllMocks());

describe("the full diff review as drawn", () => {
  it("draws its focus ring inside, since the sheet clips an outer one", async () => {
    await renderView();

    const classes = screen.getByRole("complementary", { name: "Diff view" }).className.split(" ");
    expect(classes).toContain("focus-ring-inset");
    expect(classes).not.toContain("focus-ring");
  });

  it("the review header is 48px with the target, count and totals", async () => {
    await renderView();

    const bar = document.querySelector<HTMLElement>('[aria-label="Diff view"] header > div')!;
    for (const name of ["h-12", "gap-2", "pl-3", "pr-2.5"]) expect(bar.classList.contains(name), name).toBe(true);
    const trigger = screen.getByRole("button", { name: "Diff target: main → working tree" });
    expect(trigger.className).toContain("font-semibold");
    const totals = within(screen.getByRole("group", { name: "Diff totals" }));
    expect(totals.getByText("3 files").classList.contains("text-ui-sm")).toBe(true);
    expect(totals.getByText("+14").classList.contains("font-mono")).toBe(true);
    expect(screen.getByRole("button", { name: "Search files" }).className).toContain("text-fg-secondary");
  });

  it("the target picker is a listbox popover with the check on the left", async () => {
    await renderView();
    fireEvent.click(screen.getByRole("button", { name: "Diff target: main → working tree" }));

    const list = within(screen.getByRole("listbox", { name: "Diff target" }));
    const main = list.getByRole("option", { name: "main → working tree" });
    expect(main.getAttribute("aria-selected")).toBe("true");
    expect(main.firstElementChild?.hasAttribute("data-check-slot")).toBe(true);
    expect(list.getByRole("option", { name: "HEAD → working tree" }).getAttribute("aria-selected")).toBe("false");
  });

  it("Shrink is an outline text button that keeps its name", async () => {
    await renderView({ isExpanded: true, onToggleExpanded: () => {} });

    const shrink = screen.getByRole("button", { name: "Shrink diff view" });
    expect(shrink.textContent).toBe("Shrink");
    expect(shrink.className).toContain("border-border-strong");
  });

  it("the list shows only nonzero counts and marks the picked file", async () => {
    await renderView({ isExpanded: true });

    const list = within(screen.getByRole("navigation", { name: "Changed files" }));
    const [added, removed, binary] = list.getAllByRole("button");
    expect(added.textContent).toBe("added.ts+14");
    expect(removed.textContent).toBe("removed.ts−5");
    expect(binary.textContent).toBe("logo.png");
    expect(removed.getAttribute("title")).toBe("src/lib/removed.ts");
    expect(added.classList.contains("h-[30px]")).toBe(true);
    // Nothing picked yet: the first file is the one marked.
    expect(added.getAttribute("aria-current")).toBe("true");
    expect(added.classList.contains("bg-surface-hover")).toBe(true);

    await act(async () => {
      fireEvent.click(removed);
    });
    expect(removed.getAttribute("aria-current")).toBe("true");
    expect(added.hasAttribute("aria-current")).toBe(false);
  });

  it("each file header carries the comment hint", async () => {
    await renderView();

    const hints = screen.getAllByText("Click a line number to comment");
    // One per open file that can take comments; the binary file has none.
    expect(hints).toHaveLength(2);
    for (const hint of hints) expect(hint.closest("section")).not.toBeNull();
    const header = screen.getAllByRole("button").find((b) => b.getAttribute("title") === "src/lib/removed.ts" && b.hasAttribute("aria-expanded"))!;
    expect(header.classList.contains("h-9")).toBe(true);
    expect(header.textContent).toContain("src/lib/removed.ts");
  });
});

describe("the file header in a narrow review", () => {
  it("cuts the hint before the path", async () => {
    await renderView();

    const hint = screen.getAllByText("Click a line number to comment")[0];
    const path = hint.parentElement!.querySelector<HTMLElement>(".font-mono")!;
    expect(path.classList.contains("shrink-0") || path.className.includes("shrink-[")).toBe(false);
    expect(hint.className).toContain("shrink-[999]");
  });
});
