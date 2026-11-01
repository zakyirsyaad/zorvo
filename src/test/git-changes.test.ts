import { describe, it, expect } from "vitest";
import { commitPathsOf, isCommentableFile, isCommentableRow, isCutDiff, unifiedDiffRows, type UnifiedRow } from "../lib/git-changes";

describe("unifiedDiffRows", () => {
  it("drops git's file header and marks hunks, changes and context", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+2",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    expect(unifiedDiffRows(diff)).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", text: "one", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "two", oldLine: 2 },
      { kind: "added", text: "2", newLine: 2 },
      { kind: "note", text: "\\ No newline at end of file" },
    ]);
  });

  it("keeps a line whose content starts like a header marker", () => {
    expect(unifiedDiffRows("@@ -1 +1 @@\n---- divider\n+++ plus\n")).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "removed", text: "--- divider", oldLine: 1 },
      { kind: "added", text: "++ plus", newLine: 1 },
    ]);
  });

  it("stops after a bounded number of rows", () => {
    const rows = unifiedDiffRows(Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join("\n"));

    expect(rows).toHaveLength(1501);
    expect(rows.at(-1)).toEqual({ kind: "note", text: "500 more lines not shown" });
  });
});

describe("unifiedDiffRows line numbers", () => {
  it("numbers context, removed and added rows from the hunk header", () => {
    const diff = "@@ -10,3 +10,4 @@\n ctx\n-old\n+new\n+more\n ctx2\n";
    expect(unifiedDiffRows(diff)).toEqual([
      { kind: "hunk", text: "@@ -10,3 +10,4 @@" },
      { kind: "context", text: "ctx", oldLine: 10, newLine: 10 },
      { kind: "removed", text: "old", oldLine: 11 },
      { kind: "added", text: "new", newLine: 11 },
      { kind: "added", text: "more", newLine: 12 },
      { kind: "context", text: "ctx2", oldLine: 12, newLine: 13 },
    ]);
  });

  it("starts at 1 when the hunk header omits a count", () => {
    expect(unifiedDiffRows("@@ -0,0 +1 @@\n+first\n")[1]).toEqual({ kind: "added", text: "first", newLine: 1 });
  });
});

describe("commitPathsOf", () => {
  it("includes where a renamed file came from", () => {
    expect(
      commitPathsOf([
        { path: "new.md", oldPath: "old.md", kind: "renamed" },
        { path: "a.ts", oldPath: null, kind: "modified" },
      ]),
    ).toEqual(["new.md", "old.md", "a.ts"]);
  });
});

describe("isCutDiff", () => {
  it("is true when the last row is the backend's size-limit note", () => {
    const rows: UnifiedRow[] = [{ kind: "added", text: "a", newLine: 1 }, { kind: "note", text: "… diff cut: it is longer than 400000 characters" }];

    expect(isCutDiff(rows)).toBe(true);
  });

  it("is true when the last row is the row-limit note", () => {
    expect(isCutDiff(unifiedDiffRows(Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join("\n")))).toBe(true);
  });

  it("is false for a whole diff, an empty one, and a cut note that is not last", () => {
    expect(isCutDiff(unifiedDiffRows("@@ -1 +1 @@\n-a\n+b\n"))).toBe(false);
    expect(isCutDiff([])).toBe(false);
    expect(isCutDiff([{ kind: "note", text: "… diff cut: x" }, { kind: "added", text: "a", newLine: 1 }])).toBe(false);
  });

  it("is false for an ordinary note last", () => {
    expect(isCutDiff([{ kind: "note", text: "\\ No newline at end of file" }])).toBe(false);
  });
});

describe("isCommentableFile", () => {
  it("is false for a symbolic link's diff", () => {
    const rows = unifiedDiffRows("@@ -0,0 +1 @@\n+target\n\\ Symbolic link\n");

    expect(isCommentableFile(rows)).toBe(false);
  });

  it("is true for an ordinary diff, even one with a no-newline note", () => {
    expect(isCommentableFile(unifiedDiffRows("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n"))).toBe(true);
  });
});

describe("isCommentableRow", () => {
  it("is true for added, removed and context rows", () => {
    expect(isCommentableRow({ kind: "added", text: "a", newLine: 1 })).toBe(true);
    expect(isCommentableRow({ kind: "removed", text: "a", oldLine: 1 })).toBe(true);
    expect(isCommentableRow({ kind: "context", text: "a", oldLine: 1, newLine: 1 })).toBe(true);
  });

  it("is false for hunk and note rows", () => {
    expect(isCommentableRow({ kind: "hunk", text: "@@ -1 +1 @@" })).toBe(false);
    expect(isCommentableRow({ kind: "note", text: "x" })).toBe(false);
  });
});
