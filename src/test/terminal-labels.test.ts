import { describe, it, expect } from "vitest";
import { tabLabel } from "../lib/terminal-labels";

describe("tabLabel", () => {
  it("tabs read the shell, numbered from the second", () => {
    expect(tabLabel("zsh", 1)).toBe("zsh");
    expect(tabLabel("zsh", 2)).toBe("zsh 2");
    expect(tabLabel("fish", 3)).toBe("fish 3");
  });
});
