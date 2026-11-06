import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileReviews } from "../hooks/useFileReviews";
import { useReviewComments } from "../hooks/useReviewComments";
import type { AddReview } from "../hooks/useReviewWiring";
import type { FileStat } from "../lib/diff-stats";
import { lineHash } from "../lib/review-comments";
import type { ReviewComment } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const FILE = "src/a.ts";
const STATS: FileStat[] = [{ path: FILE, oldPath: null, kind: "modified", added: 1, removed: 0, isBinary: false, fingerprint: "f1" }];
const COMMENT: ReviewComment = {
  id: "c-1",
  file: FILE,
  side: "new",
  line: 1,
  lineHash: lineHash("const x"),
  quote: "const x",
  target: "head",
  body: "Name it better.",
  createdAt: 1,
};

afterEach(() => vi.restoreAllMocks());

describe("useFileReviews", () => {
  it("builds the same file review DiffView used to", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) =>
      Promise.resolve(cmd === "session_file_diff" ? "@@ -0,0 +1,1 @@\n+const x\n" : undefined),
    );
    const addReview: AddReview = { inMessage: new Set(), blockedReason: undefined, add: vi.fn() };
    const onFocusLost = vi.fn();

    const { result } = renderHook(() => {
      const review = useReviewComments("s-a", [COMMENT], () => {});
      return useFileReviews({
        rootPath: "/w",
        review,
        addReview,
        target: "head",
        targets: { base: null, root: "/w", prefix: "app/" },
        stats: STATS,
        refreshes: 0,
        onFocusLost,
      });
    });
    await act(async () => {});

    const file = result.current.fileReviewFor(FILE);
    expect(file?.checked.map(({ comment, status }) => [comment.id, status])).toEqual([["c-1", "current"]]);
    expect(file?.target).toBe("head");
    expect(file?.onFocusLost).toBe(onFocusLost);
    expect(result.current.fileReviewFor("src/other.ts")?.checked).toEqual([]);
    expect(result.current.comments).toEqual([COMMENT]);

    act(() => result.current.adder?.add(file!.checked));
    expect(addReview.add).toHaveBeenCalledWith(file!.checked, "head", { root: "/w", prefix: "app/", baseName: null });
  });

  it("says why Add is off when this view could not load", () => {
    const addReview: AddReview = { inMessage: new Set(), blockedReason: undefined, add: vi.fn() };
    const { result } = renderHook(() => {
      const review = useReviewComments("s-a", [], () => {});
      return useFileReviews({
        rootPath: "/w",
        review,
        addReview,
        target: "head",
        targets: { base: null, root: "/w", prefix: "" },
        stats: null,
        refreshes: 0,
        blockedReason: "Not loaded.",
        onFocusLost: () => {},
      });
    });

    expect(result.current.adder?.blockedReason).toBe("Not loaded.");
  });

  it("offers nothing without a session's comments", () => {
    const { result } = renderHook(() =>
      useFileReviews({
        rootPath: "/w",
        review: undefined,
        addReview: undefined,
        target: "head",
        targets: { base: null, root: "/w", prefix: "" },
        stats: STATS,
        refreshes: 0,
        onFocusLost: () => {},
      }),
    );

    expect(result.current.fileReviewFor(FILE)).toBeUndefined();
    expect(result.current.adder).toBeUndefined();
  });
});
