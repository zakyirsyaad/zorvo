import { describe, expect, it } from "vitest";
import { escapeVisible } from "../lib/visible-text";

describe("escapeVisible", () => {
  it("shows a bidi control as text", () => {
    expect(escapeVisible("a\u202Eb")).toBe("a\\u202Eb");
  });

  it("shows zero-width characters as text", () => {
    expect(escapeVisible("a\u200Bb\u200Cc\u200Dd\uFEFFe")).toBe("a\\u200Bb\\u200Cc\\u200Dd\\uFEFFe");
  });

  it("leaves a tab alone", () => {
    expect(escapeVisible("a\tb")).toBe("a\tb");
  });
});
