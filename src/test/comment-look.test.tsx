import { useState } from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DiffView } from "../components/changes/DiffView";
import { LineComment } from "../components/changes/LineComment";
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
    expect(card.classList.contains("border-border-strong")).toBe(true);
    expect(card.classList.contains("bg-surface-2")).toBe(true);
    expect(box.closest(".ml-\\[104px\\]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save comment" }).className).toContain("border");
  });

  it("a saved comment reads Line N · Current with Add to message", async () => {
    await renderView([commentOf(), commentOf({ id: "c-2", lineHash: lineHash("gone"), body: "Was here." })]);

    const current = screen.getByText("Use AuthError here.").closest<HTMLElement>(".bg-surface-3")!;
    expect(current.textContent).toContain("Line 42");
    expect(current.textContent).toContain("· Current");
    expect(current.classList.contains("rounded-lg")).toBe(true);

    const outdated = screen.getByText("Was here.").closest<HTMLElement>(".bg-surface-3")!;
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

    expect(screen.getByText("Use AuthError here.").closest(".bg-surface-3")!.textContent).toContain("Line 42 · Unknown");
  });
});
