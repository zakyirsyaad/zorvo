import { describe, it, expect } from "vitest";
import { withoutMarkdownMarks } from "../lib/markdown-marks";

describe("withoutMarkdownMarks", () => {
  it("drops the ticks around code and keeps the code", () => {
    expect(withoutMarkdownMarks("The store is a `TokenStore` class with `save` and `read`.")).toBe(
      "The store is a TokenStore class with save and read.",
    );
  });

  it("drops a fence's own lines and keeps what is inside", () => {
    expect(withoutMarkdownMarks("Run this:\n```ts\nconst next = 1;\n```\nDone.")).toBe("Run this:\n\nconst next = 1;\n\nDone.");
  });

  it("drops bold and italic asterisks, heading hashes and quote marks", () => {
    expect(withoutMarkdownMarks("## Result\n**All six** tests *pass*.\n> quoted")).toBe("Result\nAll six tests pass.\nquoted");
  });

  it("keeps a link's words and drops its target", () => {
    expect(withoutMarkdownMarks("See [the plan](https://example.invalid/plan) and ![a shot](shot.png).")).toBe("See the plan and a shot.");
  });

  it("never rewrites code: a span loses its ticks and nothing else", () => {
    expect(withoutMarkdownMarks("Updated `src/*/test/*`.")).toBe("Updated src/*/test/*.");
    expect(withoutMarkdownMarks("The map is `[key](value)` and `**kwargs`.")).toBe("The map is [key](value) and **kwargs.");
    // Marks around a span still go; the span inside them stays as written.
    expect(withoutMarkdownMarks("**see `a*b*c` now** and *then `x[0](y)`*")).toBe("see a*b*c now and then x[0](y)");
  });

  it("never rewrites a fenced block: only its two fence lines go", () => {
    const text = "Run:\n```bash\n# install\nls src/*/test/* > out\necho **done**\n```\n# Next\n*after*";
    expect(withoutMarkdownMarks(text)).toBe("Run:\n\n# install\nls src/*/test/* > out\necho **done**\n\nNext\nafter");
    // A fence left open runs to the end, and another kind of fence inside it is code.
    expect(withoutMarkdownMarks("~~~\n```\n*x*")).toBe("\n```\n*x*");
  });

  it("a longer fence holds a shorter one: only a fence of its own kind and length closes it", () => {
    const nested = "````markdown\n```bash\necho **done**\n```\n````\n*after*";
    expect(withoutMarkdownMarks(nested)).toBe("\n```bash\necho **done**\n```\n\nafter");
    // A fence line with an info string opens a block; it never closes one.
    expect(withoutMarkdownMarks("```\n```js\n**x**\n```\n**y**")).toBe("\n```js\n**x**\n\ny");
    // A longer run closes a shorter fence.
    expect(withoutMarkdownMarks("```\n**x**\n`````\n**y**")).toBe("\n**x**\n\ny");
  });

  it("three ticks that open and close on one line are not a fence", () => {
    expect(withoutMarkdownMarks("```a``` is code\n*x*").endsWith("\nx")).toBe(true);
  });

  it("leaves asterisks and underscores that are not marks", () => {
    expect(withoutMarkdownMarks("2 * 3 * 4 and 2*3*4")).toBe("2 * 3 * 4 and 2*3*4");
    expect(withoutMarkdownMarks("call __init__ and snake_case_name")).toBe("call __init__ and snake_case_name");
    expect(withoutMarkdownMarks("a lone ` tick and a * star")).toBe("a lone ` tick and a * star");
  });

  it("a span may use more ticks, to hold a tick of its own", () => {
    expect(withoutMarkdownMarks("Use `` `src/*/test/*` ``.")).toBe("Use `src/*/test/*`.");
    expect(withoutMarkdownMarks("Run ``a`b*c*`` then *go*")).toBe("Run a`b*c* then go");
    // Ticks that close nothing are text, and what follows them is still prose.
    expect(withoutMarkdownMarks("``open and *x*")).toBe("``open and x");
  });

  it("a backslash escapes a mark: the character stays and the backslash goes", () => {
    expect(withoutMarkdownMarks("\\*not em\\* and \\`not code\\` and \\# not a heading")).toBe("*not em* and `not code` and # not a heading");
    // A backslash before a letter is a path, not an escape.
    expect(withoutMarkdownMarks("C:\\Users\\me")).toBe("C:\\Users\\me");
  });

  it("stars inside a word, a glob or a URL are not marks, in code or out of it", () => {
    const text = "Updated src/*/test/* and https://example.invalid/*a*/b, 2**8**2";
    expect(withoutMarkdownMarks(text)).toBe(text);
  });

  it("an indented line is code and is left as written", () => {
    expect(withoutMarkdownMarks("Then:\n    ls src/*/a/* **x**\n**done**")).toBe("Then:\n    ls src/*/a/* **x**\ndone");
  });

  it("drops nested quote marks, and a heading inside a quote", () => {
    expect(withoutMarkdownMarks(">> ## Title\n> *said*")).toBe("Title\nsaid");
  });
});
