import { describe, expect, it } from "vitest";
import { MAX_INLINE_CONTROLS, splitControls } from "../lib/composer-overflow";

describe("splitControls", () => {
  it("keeps the first three inline and puts the rest in the menu, in order", () => {
    expect(MAX_INLINE_CONTROLS).toBe(3);
    expect(splitControls(["a", "b", "c", "d", "e"])).toEqual({ inline: ["a", "b", "c"], overflow: ["d", "e"] });
  });

  it("puts nothing in the menu while all of them fit", () => {
    expect(splitControls(["a", "b", "c"])).toEqual({ inline: ["a", "b", "c"], overflow: [] });
    expect(splitControls([])).toEqual({ inline: [], overflow: [] });
  });

  it("takes another limit", () => {
    expect(splitControls(["a", "b"], 1)).toEqual({ inline: ["a"], overflow: ["b"] });
  });
});
