import { describe, it, expect } from "vitest";
import { MAX_QUOTE_CHARS, replyBlockedReason, replyQuote } from "../lib/reply-quote";

describe("replyQuote", () => {
  it("quotes each line and leaves a line to write on", () => {
    expect(replyQuote("one\ntwo", false)).toBe("> one\n> two\n\n");
  });

  it("keeps a blank line inside the quote", () => {
    expect(replyQuote("a\n\nb", false)).toBe("> a\n>\n> b\n\n");
  });

  it("drops the blank space around the selection", () => {
    expect(replyQuote("  \nhello  \n\n", false)).toBe("> hello\n\n");
  });

  it("quotes code as code and keeps its indentation", () => {
    expect(replyQuote("\nif (a) {\n  b();\n}\n", true)).toBe("> ```\n> if (a) {\n>   b();\n> }\n> ```\n\n");
  });

  it("cuts a long selection and says so", () => {
    const quote = replyQuote("x".repeat(MAX_QUOTE_CHARS + 10), false);
    expect(quote).toBe(`> ${"x".repeat(MAX_QUOTE_CHARS)}…\n\n`);
  });

  it("quotes nothing when only blank space was selected", () => {
    expect(replyQuote(" \n ", false)).toBe("");
  });
});

describe("replyBlockedReason", () => {
  const open = { isComposerHidden: false, isComposerDisabled: false, isHeldElsewhere: false };

  it("lets a reply through when the message box can take it", () => {
    expect(replyBlockedReason(open)).toBeUndefined();
  });

  it.each([
    [{ ...open, isComposerHidden: true }, "There is no message box for this session."],
    [{ ...open, isComposerDisabled: true }, "The message box is not available right now."],
    [{ ...open, isHeldElsewhere: true }, "The message holds comments for another session. Go back to it, or clear the message."],
  ])("says why it cannot (%o)", (state, reason) => {
    expect(replyBlockedReason(state)).toBe(reason);
  });
});
