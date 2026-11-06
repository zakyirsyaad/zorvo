import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DiffRows, type RowReview } from "../components/changes/DiffRows";
import { unifiedDiffRows } from "../lib/git-changes";

const ROWS = unifiedDiffRows("@@ -10,2 +10,2 @@\n context\n-old\n+new\n");

afterEach(cleanup);

const rowOf = (kind: string) => document.querySelector<HTMLElement>(`[data-line="${kind}"]`)!;
const cellsOf = (kind: string) => Array.from(rowOf(kind).children) as HTMLElement[];
const listOf = () => document.querySelector<HTMLElement>('[aria-label="Diff of a.ts"]')!;

describe("diff rows as drawn", () => {
  it("review rows are 12/20 with two 40px gutters and a sign column", () => {
    render(<DiffRows rows={ROWS} label="Diff of a.ts" />);

    const list = listOf();
    for (const name of ["py-2", "font-mono", "text-ui-sm", "leading-5", "text-fg-secondary"]) {
      expect(list.classList.contains(name), name).toBe(true);
    }
    // Flush in the review: no box of its own.
    for (const name of ["border", "rounded-md", "bg-bg", "max-h-80"]) {
      expect(list.classList.contains(name), name).toBe(false);
    }
    const [oldGutter, newGutter, sign] = cellsOf("context");
    expect(oldGutter.classList.contains("w-10")).toBe(true);
    expect(newGutter.classList.contains("w-10")).toBe(true);
    expect(sign.classList.contains("w-4")).toBe(true);
    expect([oldGutter.textContent, newGutter.textContent]).toEqual(["10", "10"]);
  });

  it("card rows are 11/18 with one 30px gutter", () => {
    render(<DiffRows rows={ROWS} label="Diff of a.ts" density="card" />);

    const list = listOf();
    for (const name of ["py-1", "font-mono", "text-caption", "leading-[18px]", "text-fg-secondary", "max-h-80"]) {
      expect(list.classList.contains(name), name).toBe(true);
    }
    const [gutter, sign] = cellsOf("removed");
    expect(gutter.classList.contains("w-[30px]")).toBe(true);
    // A removed line has only its old number.
    expect(gutter.textContent).toBe("11");
    expect(sign.classList.contains("w-3.5")).toBe(true);
    expect(cellsOf("added")[0].textContent).toBe("11");
    expect(cellsOf("context")[0].textContent).toBe("10");
    expect(rowOf("context").querySelectorAll(".w-\\[30px\\]")).toHaveLength(1);
  });

  it("added and removed rows are tinted, their text fg-secondary", () => {
    render(<DiffRows rows={ROWS} label="Diff of a.ts" />);

    expect(rowOf("added").classList.contains("bg-diff-added")).toBe(true);
    expect(rowOf("removed").classList.contains("bg-diff-removed")).toBe(true);
    for (const kind of ["added", "removed", "context"]) {
      expect(rowOf(kind).classList.contains("text-fg-secondary"), kind).toBe(true);
      expect(rowOf(kind).className).not.toMatch(/text-status-running|text-danger/);
    }
  });

  it("the hunk row has no fill", () => {
    render(<DiffRows rows={ROWS} label="Diff of a.ts" />);

    const hunk = rowOf("hunk");
    expect(hunk.className).not.toMatch(/\bbg-/);
    expect(hunk.classList.contains("text-fg-subtle")).toBe(true);
  });

  it("the active row shows a 2px fg bar", () => {
    const review: RowReview = { badge: () => null, canComment: () => true, openBox: vi.fn(), under: () => null };
    render(<DiffRows rows={ROWS} label="Diff of a.ts" review={review} />);

    fireEvent.mouseOver(rowOf("context"));
    expect(rowOf("context").className).toContain("shadow-[inset_2px_0_0_var(--color-fg)]");
    expect(rowOf("added").className).not.toContain("shadow-[inset_2px_0_0_var(--color-fg)]");
  });
});
