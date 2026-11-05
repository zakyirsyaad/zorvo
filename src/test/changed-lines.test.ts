import { describe, expect, it } from "vitest";
import { changedLines } from "../lib/changed-lines";
import { unifiedDiffRows } from "../lib/git-changes";

describe("changedLines", () => {
  it("calls lines that replace others modified, and lines on their own added", () => {
    const rows = unifiedDiffRows("@@ -1,3 +1,5 @@\n a\n-b\n+B\n+C\n d\n+e\n");

    expect([...changedLines(rows)]).toEqual([
      [2, "modified"],
      [3, "modified"],
      [5, "added"],
    ]);
  });

  it("marks nothing for a hunk that only removes", () => {
    expect(changedLines(unifiedDiffRows("@@ -1,2 +1,1 @@\n a\n-b\n")).size).toBe(0);
  });

  it("keeps a run whole across a no-newline note", () => {
    const rows = unifiedDiffRows("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n");

    expect([...changedLines(rows)]).toEqual([[1, "modified"]]);
  });

  it("starts afresh at each hunk", () => {
    const rows = unifiedDiffRows("@@ -1 +1 @@\n-x\n+y\n@@ -9,0 +10 @@\n+z\n");

    expect([...changedLines(rows)]).toEqual([
      [1, "modified"],
      [10, "added"],
    ]);
  });
});
