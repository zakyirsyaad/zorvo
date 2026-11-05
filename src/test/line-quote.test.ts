import { describe, expect, it } from "vitest";
import { lineQuote, lineRangeLabel } from "../lib/line-quote";
import { MAX_QUOTE_CHARS } from "../lib/reply-quote";

describe("lineQuote", () => {
  it("names the file and the lines, then fences them in the file's language", () => {
    expect(lineQuote("src/a.ts", 2, 3, ["let b;", "b = 2;"], "ts")).toBe("`src/a.ts` lines 2–3:\n\n```ts\nlet b;\nb = 2;\n```");
  });

  it("says one line in the singular", () => {
    expect(lineQuote("src/a.ts", 2, 2, ["let b;"], "ts").startsWith("`src/a.ts` line 2:\n\n")).toBe(true);
  });

  it("fences with more backticks than any run inside", () => {
    const quote = lineQuote("README.md", 1, 1, ["```js"], "md");

    expect(quote).toBe("`README.md` line 1:\n\n````md\n```js\n````");
  });

  it("cuts a long range and says so", () => {
    const long = "x".repeat(MAX_QUOTE_CHARS + 10);
    const quote = lineQuote("big.txt", 1, 1, [long], "");

    expect(quote).toContain(`${"x".repeat(MAX_QUOTE_CHARS)}…`);
    expect(quote).not.toContain("x".repeat(MAX_QUOTE_CHARS + 1));
  });
});

describe("lineRangeLabel", () => {
  it("words the button for one line or several", () => {
    expect(lineRangeLabel(4, 4)).toBe("Add line 4 to prompt");
    expect(lineRangeLabel(4, 9)).toBe("Add lines 4–9 to prompt");
  });
});
