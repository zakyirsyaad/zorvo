import { describe, it, expect } from "vitest";
import { defaultTarget, formatLineCount, targetLabel, targetOptions, totalsOf, type DiffTargets, type FileStat } from "../lib/diff-stats";

const stat = (added: number, removed: number): FileStat => ({
  path: "a.ts",
  oldPath: null,
  kind: "modified",
  added,
  removed,
  isBinary: false,
  fingerprint: "f1",
});

describe("formatLineCount", () => {
  it("groups thousands", () => expect(formatLineCount(2847)).toBe("2,847"));
  it("keeps zero", () => expect(formatLineCount(0)).toBe("0"));
});

describe("totalsOf", () => {
  it("sums added and removed lines", () => {
    expect(totalsOf([stat(2, 1), stat(2845, 34)])).toEqual({ added: 2847, removed: 35 });
  });
  it("is zero for no files", () => expect(totalsOf([])).toEqual({ added: 0, removed: 0 }));
});

const WITH_BASE: DiffTargets = { base: { name: "main" }, root: "/w", prefix: "" };
const NO_BASE: DiffTargets = { base: null, root: "/w", prefix: "" };

describe("targetLabel", () => {
  it("names the base branch", () => {
    expect(targetLabel("base", WITH_BASE)).toBe("main → working tree");
  });
  it("names HEAD", () => {
    expect(targetLabel("head", WITH_BASE)).toBe("HEAD → working tree");
  });
  it("names the start of the worktree", () => {
    expect(targetLabel("start", WITH_BASE)).toBe("Start of this worktree → working tree");
  });
});

describe("targetOptions", () => {
  it("offers the start, then the base, then HEAD", () => {
    expect(targetOptions(WITH_BASE, "abc123")).toEqual(["start", "base", "head"]);
  });
  it("offers the start and HEAD when there is no base", () => {
    expect(targetOptions(NO_BASE, "abc123")).toEqual(["start", "head"]);
  });
  it("is today's list without a start", () => {
    expect(targetOptions(WITH_BASE, undefined)).toEqual(["base", "head"]);
    expect(targetOptions(NO_BASE, undefined)).toEqual(["head"]);
  });
});

describe("defaultTarget", () => {
  it("prefers the start when asked to and it is offered", () => {
    expect(defaultTarget(["start", "base", "head"], true)).toBe("start");
  });
  it("keeps the base when the start is not preferred", () => {
    expect(defaultTarget(["start", "base", "head"], false)).toBe("base");
  });
  it("falls to the base, then HEAD, when the start is not offered", () => {
    expect(defaultTarget(["base", "head"], true)).toBe("base");
    expect(defaultTarget(["head"], true)).toBe("head");
  });
  it("is HEAD when only the start would be preferred and there is no base", () => {
    expect(defaultTarget(["start", "head"], false)).toBe("head");
  });
});
