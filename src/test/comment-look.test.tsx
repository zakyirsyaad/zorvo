import { useState } from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DiffView } from "../components/changes/DiffView";
import { DraftBox, LineComment } from "../components/changes/LineComment";
import { draftKeyOf, type ReviewComments } from "../hooks/useReviewComments";
import type { UnifiedRow } from "../lib/git-changes";
import { ReviewCommentsBar } from "../components/changes/ReviewCommentsBar";
import { useReviewComments } from "../hooks/useReviewComments";
import type { AddReview } from "../hooks/useReviewWiring";
import type { FileStat } from "../lib/diff-stats";
import { lineHash } from "../lib/review-comments";
import type { ReviewComment } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const FILE = "src/app.ts";
const DIFF = "@@ -41,2 +41,2 @@\n the context\n-old line\n+const x\n";
const STAT: FileStat = { path: FILE, oldPath: null, kind: "modified", added: 1, removed: 1, isBinary: false, fingerprint: "f1" };

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

const NO_ADD: AddReview = { inMessage: new Set(), blockedReason: undefined, add: () => {} };

function mockRepo() {
  vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
    if (cmd === "session_diff_targets") return Promise.resolve({ base: null, root: "/w", prefix: "" });
    if (cmd === "session_diff_stats") return Promise.resolve([STAT]);
    if (cmd === "session_file_diff") return Promise.resolve(DIFF);
    return Promise.resolve(undefined);
  });
}

function Harness({ initial }: { initial: ReviewComment[] }) {
  const [comments, setComments] = useState(initial);
  const review = useReviewComments("s-a", comments, (_id, change) => setComments(change));
  return (
    <DiffView rootPath="/w" version={1} isExpanded={false} onClose={() => {}} onError={() => {}} review={review} addReview={NO_ADD} />
  );
}

async function renderView(initial: ReviewComment[] = []) {
  mockRepo();
  await act(async () => {
    render(<Harness initial={initial} />);
  });
}

const addedRow = () => screen.getByRole("row", { name: /^Line 42, added/ });

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.restoreAllMocks());

describe("comments as drawn", () => {
  it("the comment box is an indented card with a visible label", async () => {
    await renderView();
    fireEvent.mouseOver(addedRow());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Comment on line 42" }));
    });

    const label = screen.getByText("Comment on line 42", { selector: "label" });
    const box = screen.getByRole("textbox", { name: "Comment on line 42" });
    expect(box.getAttribute("aria-label")).toBeNull();
    expect(label.classList.contains("text-caption")).toBe(true);
    const card = box.closest<HTMLElement>(".rounded-lg")!;
    expect(card.classList.contains("border-border")).toBe(true);
    expect(card.classList.contains("border-border-strong")).toBe(false);
    expect(card.classList.contains("bg-surface-2")).toBe(true);
    expect(box.closest(".ml-\\[104px\\]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save comment" }).className).toContain("border");
  });

  it("a saved comment reads Line N · Current with Add to message", async () => {
    await renderView([commentOf(), commentOf({ id: "c-2", lineHash: lineHash("gone"), body: "Was here." })]);

    const current = screen.getByText("Use AuthError here.").closest<HTMLElement>("[data-saved-comment]")!;
    expect(current.textContent).toContain("Line 42");
    expect(current.textContent).toContain("· Current");
    expect(current.classList.contains("rounded-lg")).toBe(true);

    const outdated = screen.getByText("Was here.").closest<HTMLElement>("[data-saved-comment]")!;
    expect(outdated.textContent).toContain("· Outdated");
    expect(screen.getByRole("button", { name: "Add to message" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("a row with comments ends in a badge", async () => {
    await renderView([commentOf()]);

    expect(addedRow().textContent).toContain("1 comment · Current");
    expect(screen.getByRole("row", { name: /^Line 41, unchanged/ }).textContent).not.toContain("comment ·");
  });

  it("an unknown comment says Unknown", () => {
    function One() {
      const review = useReviewComments("s-a", [commentOf()], () => {});
      return <LineComment comment={commentOf()} status="unknown" review={review} onRemoved={() => {}} />;
    }
    render(<One />);

    expect(screen.getByText("Use AuthError here.").closest("[data-saved-comment]")!.textContent).toContain("Line 42 · Unknown");
  });
});

describe("the comments bar as drawn", () => {
  const two = [commentOf(), commentOf({ id: "c-2", body: "And here." })];

  it("the diff leaves room for a bar that grew tall, so its last lines are never under it", async () => {
    const watchers: { callback: () => void; target: Element | null }[] = [];
    class FakeResizeObserver {
      private readonly watcher: { callback: () => void; target: Element | null };
      constructor(callback: ResizeObserverCallback) {
        this.watcher = { callback: () => callback([], this as unknown as ResizeObserver), target: null };
        watchers.push(this.watcher);
      }
      observe = (target: Element) => {
        this.watcher.target = target;
      };
      unobserve = () => {};
      disconnect = () => {};
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    try {
      await renderView(two);
      const slot = document.querySelector<HTMLElement>("[data-bar-slot]")!;
      const scroller = document.querySelector<HTMLElement>("[data-diff-scroller]")!;
      const watcher = watchers.find((entry) => entry.target === slot)!;

      // One row of the bar fits in the 80px the class leaves.
      Object.defineProperty(slot, "offsetHeight", { configurable: true, value: 46 });
      act(() => watcher.callback());
      expect(scroller.style.paddingBottom).toBe("");

      // A bar listing comments is taller: its height, its 16px offset and a 16px gap.
      Object.defineProperty(slot, "offsetHeight", { configurable: true, value: 256 });
      act(() => watcher.callback());
      expect(scroller.style.paddingBottom).toBe("288px");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the bar is a floating card that counts comments not in a message", async () => {
    await renderView(two);

    const bar = screen.getByRole("region", { name: "Review comments" });
    expect(bar.textContent).toContain("2 comments not in a message");
    // A popover panel floating over the diff, centred 16px above its bottom.
    for (const name of ["rounded-panel", "border-border", "bg-surface-3", "shadow-popover", "pointer-events-auto"]) {
      expect(bar.classList.contains(name), name).toBe(true);
    }
    const slot = bar.parentElement as HTMLElement;
    for (const name of ["absolute", "inset-x-4", "bottom-4", "justify-center", "pointer-events-none"]) {
      expect(slot.classList.contains(name), name).toBe(true);
    }
    expect(slot.parentElement?.classList.contains("relative")).toBe(true);
    // The scroller leaves 80px under its last lines until the bar is measured taller.
    const scroller = slot.parentElement?.querySelector<HTMLElement>("[data-diff-scroller]");
    expect(scroller?.classList.contains("pb-20")).toBe(true);
    expect(scroller?.style.paddingBottom).toBe("");
    expect(bar.classList.contains("border-t")).toBe(false);
  });

  it("its Add says in words what its name says", async () => {
    await renderView(two);

    const add = screen.getByRole("button", { name: "Add 2 comments to message" });
    // Voice Control finds a button by the words it shows, so they are its name.
    expect(add.textContent).toBe("Add 2 comments to message");
    expect(add.className).toContain("bg-primary");
  });

  it("Clear sent clears only the sent comments the bar shows", () => {
    const sentHere = commentOf({ id: "c-h", body: "Sent on HEAD.", sentAt: 5 });
    const sentOnBase = commentOf({ id: "c-b", body: "Sent on main.", target: "base", sentAt: 5 });
    function Bar() {
      const [comments, setComments] = useState([sentHere, sentOnBase]);
      const review = useReviewComments("s-a", comments, (_id, change) => setComments(change));
      return (
        <>
          <p data-testid="left">{comments.map((comment) => comment.id).join(",")}</p>
          <ReviewCommentsBar
            variant="card"
            review={review}
            checked={comments.filter((comment) => comment.target === "head").map((comment) => ({ comment, status: "current" as const }))}
            target="head"
            targets={{ base: null, root: "/w", prefix: "" }}
            options={["head"]}
            reads={{}}
            listed={[STAT]}
            onTargetChange={() => {}}
            onFocusLost={() => {}}
          />
        </>
      );
    }
    render(<Bar />);

    fireEvent.click(screen.getByRole("button", { name: "Clear sent" }));
    expect(screen.getByTestId("left").textContent).toBe("c-b");
  });

  it("the card variant reads Add 2", () => {
    function Bar() {
      const review = useReviewComments("s-a", two, () => {});
      return (
        <ReviewCommentsBar
          variant="card"
          review={review}
          adder={{ inMessage: new Set(), blockedReason: undefined, reasonId: "why", isWaiting: false, add: () => {} }}
          checked={two.map((comment) => ({ comment, status: "current" as const }))}
          target="head"
          targets={{ base: null, root: "/w", prefix: "" }}
          options={["head"]}
          reads={{}}
          listed={[STAT]}
          onTargetChange={() => {}}
          onFocusLost={() => {}}
        />
      );
    }
    render(<Bar />);

    const add = screen.getByRole("button", { name: "Add 2 comments to message" });
    expect(add.textContent).toBe("Add 2");
    expect(add.className).not.toContain("bg-primary");
    expect(add.classList.contains("h-6.5")).toBe(true);
    // A card at the bottom of the Changes tab's scroll area, not a floating panel.
    const bar = screen.getByRole("region", { name: "Review comments" });
    for (const name of ["mt-auto", "rounded-lg", "border-border", "bg-surface-2", "pl-3", "pr-2"]) {
      expect(bar.classList.contains(name), name).toBe(true);
    }
    expect(bar.classList.contains("absolute")).toBe(false);
  });
});

describe("comments after the review", () => {
  it("a draft box shows its own session's text after a session switch", () => {
    const place = { target: "head", file: FILE, side: "new", line: 42 } as const;
    const key = draftKeyOf(place);
    const row: UnifiedRow = { kind: "added", text: "const x", newLine: 42 };
    let review: ReviewComments | undefined;
    let showSession: (id: string) => void = () => {};
    function Box() {
      const [session, setSession] = useState("s-a");
      showSession = setSession;
      review = useReviewComments(session, [], () => {});
      return review.draftFor(key) ? <DraftBox review={review} place={place} onDone={() => {}} /> : null;
    }
    render(<Box />);
    act(() => {
      review!.openDraft(key, row);
      review!.setDraftBody(key, "Rename this");
    });
    act(() => showSession("s-b"));
    act(() => {
      review!.openDraft(key, row);
      review!.setDraftBody(key, "Add a test");
    });
    expect(screen.getByRole("textbox", { name: "Comment on line 42" })).toHaveProperty("value", "Add a test");

    // Both sessions have a box on this line, so the box stays on screen across the switch.
    act(() => showSession("s-a"));
    expect(screen.getByRole("textbox", { name: "Comment on line 42" })).toHaveProperty("value", "Rename this");
  });

  it("editing a comment in the bar keeps its file, whatever the file is called", () => {
    const comment = commentOf({ file: "Line notes.md", target: "base" });
    function Bar() {
      const review = useReviewComments("s-a", [comment], () => {});
      return (
        <ReviewCommentsBar
          review={review}
          checked={[{ comment, status: "elsewhere" }]}
          target="head"
          targets={{ base: null, root: "/w", prefix: "" }}
          options={["head"]}
          reads={{}}
          listed={[STAT]}
          onTargetChange={() => {}}
          onFocusLost={() => {}}
        />
      );
    }
    render(<Bar />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit comment on line 42" })).toBeDefined();
    expect(screen.getByText("Line notes.md:42")).toBeDefined();
  });

  it("a saved comment is a surface-2 card with its buttons in a row under the text", async () => {
    await renderView([commentOf()]);

    const card = screen.getByText("Use AuthError here.").closest<HTMLElement>("[data-saved-comment]")!;
    for (const name of ["flex-col", "rounded-lg", "border-border", "bg-surface-2"]) expect(card.classList.contains(name), name).toBe(true);
    const buttons = card.lastElementChild as HTMLElement;
    expect(buttons.classList.contains("justify-end")).toBe(true);
    for (const button of buttons.querySelectorAll("button")) expect(button.classList.contains("h-6.5")).toBe(true);
  });

  it("a comment with no row to sit under keeps the review's indent", async () => {
    await renderView([commentOf({ lineHash: lineHash("gone") })]);

    const card = screen.getByText("Use AuthError here.").closest<HTMLElement>("[data-saved-comment]")!;
    expect(card.parentElement?.classList.contains("mx-4")).toBe(true);
  });
});
