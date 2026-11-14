import { describe, it, expect } from "vitest";
import { MAX_PARSED_CHARS, withoutMarkdownMarks } from "../lib/markdown-marks";

describe("withoutMarkdownMarks", () => {
  it("drops the ticks around code and keeps the code", () => {
    expect(withoutMarkdownMarks("The store is a `TokenStore` class with `save` and `read`.")).toBe(
      "The store is a TokenStore class with save and read.",
    );
  });

  it("drops bold and italic marks, heading hashes, quote marks and list markers, one block per line", () => {
    expect(withoutMarkdownMarks("## Result\n**All six** tests *pass*.\n> quoted")).toBe("Result\nAll six tests pass.\nquoted");
    expect(withoutMarkdownMarks("Done:\n\n- **one**\n- two\n\n1. three")).toBe("Done:\none\ntwo\nthree");
    expect(withoutMarkdownMarks(">> ## Title\n> *said*")).toBe("Title\nsaid");
  });

  it("keeps a link's words and an image's description, and drops their targets", () => {
    expect(withoutMarkdownMarks("See [the plan](https://example.invalid/plan) and ![a shot](shot.png).")).toBe("See the plan and a shot.");
  });

  it("never rewrites code in a span, whatever it holds", () => {
    expect(withoutMarkdownMarks("Updated `src/*/test/*`.")).toBe("Updated src/*/test/*.");
    expect(withoutMarkdownMarks("The map is `[key](value)` and `**kwargs`.")).toBe("The map is [key](value) and **kwargs.");
    expect(withoutMarkdownMarks("**see `a*b*c` now** and *then `x[0](y)`*")).toBe("see a*b*c now and then x[0](y)");
  });

  it("a span may use more ticks, to hold a tick of its own", () => {
    expect(withoutMarkdownMarks("Use `` `src/*/test/*` ``.")).toBe("Use `src/*/test/*`.");
    expect(withoutMarkdownMarks("Run ``a`b*c*`` then *go*")).toBe("Run a`b*c* then go");
    // Ticks that close nothing are text, and what follows them is still prose.
    expect(withoutMarkdownMarks("``open and *x*")).toBe("``open and x");
  });

  it("a span may run over a line break; its stars stay", () => {
    // The break stays inside the code as written; a column folds it into a space with the rest.
    expect(withoutMarkdownMarks("Run `printf\n**done**\n` now.")).toBe("Run printf\n**done**\n now.");
  });

  it("never rewrites a fenced block: only its two fence lines go", () => {
    const text = "Run:\n```bash\n# install\nls src/*/test/* > out\necho **done**\n```\n# Next\n*after*";
    expect(withoutMarkdownMarks(text)).toBe("Run:\n# install\nls src/*/test/* > out\necho **done**\nNext\nafter");
    // A fence left open runs to the end, and another kind of fence inside it is code.
    expect(withoutMarkdownMarks("~~~\n```\n*x*")).toBe("```\n*x*");
  });

  it("a longer fence holds a shorter one: only a fence of its own kind and length closes it", () => {
    const nested = "````markdown\n```bash\necho **done**\n```\n````\n*after*";
    expect(withoutMarkdownMarks(nested)).toBe("```bash\necho **done**\n```\nafter");
    // A fence line with an info string never closes a block.
    expect(withoutMarkdownMarks("```\n```js\n**x**\n```\n**y**")).toBe("```js\n**x**\ny");
  });

  it("an indented block is code and is left as written", () => {
    expect(withoutMarkdownMarks("Then:\n\n    ls src/*/a/* **x**\n\n**done**")).toBe("Then:\nls src/*/a/* **x**\ndone");
  });

  it("a backslash escapes a mark: the character stays and the backslash goes", () => {
    expect(withoutMarkdownMarks("\\*not em\\* and \\`not code\\` and \\# not a heading")).toBe("*not em* and `not code` and # not a heading");
    // A backslash before a letter is a path, not an escape.
    expect(withoutMarkdownMarks("C:\\Users\\me")).toBe("C:\\Users\\me");
  });

  it("leaves what markdown does not read as a mark", () => {
    expect(withoutMarkdownMarks("2 * 3 * 4, snake_case_name, a lone ` tick and a * star")).toBe(
      "2 * 3 * 4, snake_case_name, a lone ` tick and a * star",
    );
  });

  it("reads GitHub's extensions as the chat does: strikethrough, task boxes, tables and bare links", () => {
    expect(withoutMarkdownMarks("~~old~~ new")).toBe("old new");
    expect(withoutMarkdownMarks("- [x] done\n- [ ] todo")).toBe("done\ntodo");
    expect(withoutMarkdownMarks("| File | Lines |\n| --- | ---: |\n| `a.ts` | **12** |\n| b.ts | 3 |")).toBe(
      "File · Lines\na.ts · 12\nb.ts · 3",
    );
    expect(withoutMarkdownMarks("See https://example.invalid/a_b_c for more.")).toBe("See https://example.invalid/a_b_c for more.");
  });

  it("keeps raw HTML as the text it is", () => {
    expect(withoutMarkdownMarks("Use <b>this</b> tag.")).toBe("Use <b>this</b> tag.");
  });

  it("reads only the start of a long text, and splits no character at the cut", () => {
    const long = `${"a".repeat(MAX_PARSED_CHARS - 1)}😀 **tail**`;
    const read = withoutMarkdownMarks(long);
    expect(read).toBe("a".repeat(MAX_PARSED_CHARS - 1));
    expect(withoutMarkdownMarks(`**start** ${"b".repeat(MAX_PARSED_CHARS)}`).startsWith("start b")).toBe(true);
  });
});
