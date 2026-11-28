import { describe, expect, it } from "vitest";
import tokens from "../../docs/design-system/tokens.json";
import { VISUAL_GUIDE } from "../lib/visuals";

describe("the visual guide", () => {
  it("names only variables tokens.json holds", () => {
    const names = new Set(tokens.color.tokens.map((token) => token.name));
    const used = [...VISUAL_GUIDE.matchAll(/--([a-z0-9-]+)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(5);
    for (const name of used) expect(names.has(name), name).toBe(true);
  });

  it("says what a visual cannot do and how to write a placeholder", () => {
    for (const phrase of ["No script runs", "transparent", "data:", "[name]", "no links", "show_artifact"]) {
      expect(VISUAL_GUIDE).toContain(phrase);
    }
  });

  it("is short enough to read once", () => {
    expect(VISUAL_GUIDE.length).toBeGreaterThan(800);
    expect(VISUAL_GUIDE.length).toBeLessThan(4000);
  });
});
