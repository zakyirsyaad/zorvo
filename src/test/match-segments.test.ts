import { describe, expect, it } from "vitest";
import { matchSegments } from "../lib/match-segments";

describe("matchSegments", () => {
  it("splits the text around a case-insensitive match", () => {
    expect(matchSegments("ReadMe.md", "me")).toEqual([
      { text: "Read", isMatch: false },
      { text: "Me", isMatch: true },
      { text: ".md", isMatch: false },
    ]);
  });

  it("finds every occurrence", () => {
    expect(matchSegments("aaa", "a")).toEqual([
      { text: "a", isMatch: true },
      { text: "a", isMatch: true },
      { text: "a", isMatch: true },
    ]);
  });

  it("gives the whole text unmatched for an empty or blank query", () => {
    expect(matchSegments("x", "")).toEqual([{ text: "x", isMatch: false }]);
    expect(matchSegments("x", "  ")).toEqual([{ text: "x", isMatch: false }]);
  });

  it("treats regex characters as plain text", () => {
    expect(matchSegments("f(x)*", "(x)*")).toEqual([
      { text: "f", isMatch: false },
      { text: "(x)*", isMatch: true },
    ]);
  });

  it("gives the text unmatched when nothing matches", () => {
    expect(matchSegments("abc", "z")).toEqual([{ text: "abc", isMatch: false }]);
  });
});
