import { describe, it, expect } from "vitest";
import { asSentence } from "../lib/sentence";

/** An agent's own words, ended with a full stop only when they have no end of their own. */
describe("asSentence", () => {
  it("adds a full stop to words that stop without one", () => {
    expect(asSentence("Automatically approve all tools")).toBe("Automatically approve all tools.");
  });

  it("keeps an ending stop, question or exclamation mark, ellipsis or full-width stop", () => {
    for (const text of ["Done.", "Ready?", "Careful!", "Runs anything…", "自动批准所有工具。", "完成！", "好吗？"]) {
      expect(asSentence(text)).toBe(text);
    }
  });

  it("keeps a stop that sits before closing quotes or brackets", () => {
    for (const text of ['Says "go."', "Says 'go.'", "Says “go.”", "Says ‘go.’", "Says «go.»", "Skips checks (all of them.)", "Runs [this.]"]) {
      expect(asSentence(text)).toBe(text);
    }
  });

  it("trims, and gives nothing for blank words", () => {
    expect(asSentence("  stream disconnected  ")).toBe("stream disconnected.");
    expect(asSentence("   ")).toBe("");
  });
});
