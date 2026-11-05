import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizeLines, type Token } from "../lib/code-tokens";

const kinds = (tokens: Token[]) => tokens.map((token) => [token.kind, token.text]);

describe("tokenizeLines", () => {
  it("splits a TypeScript line into a keyword, a string and a comment", () => {
    expect(kinds(tokenizeLines(['const a = "x"; // note'], "ts")[0])).toEqual([
      ["keyword", "const"],
      ["plain", " a = "],
      ["string", '"x"'],
      ["plain", "; "],
      ["comment", "// note"],
    ]);
  });

  it("carries a block comment from one line to the next", () => {
    const [first, second] = tokenizeLines(["/* a", "b */ let c"], "ts");

    expect(kinds(first)).toEqual([["comment", "/* a"]]);
    expect(kinds(second)).toEqual([
      ["comment", "b */"],
      ["plain", " "],
      ["keyword", "let"],
      ["plain", " c"],
    ]);
  });

  it("keeps an escaped quote inside its string", () => {
    expect(kinds(tokenizeLines(['x = "a\\"b";'], "ts")[0])).toContainEqual(["string", '"a\\"b"']);
  });

  it("reads a hash as a comment in Python and shell, not in TypeScript", () => {
    expect(kinds(tokenizeLines(["x = 1 # note"], "python")[0]).at(-1)).toEqual(["comment", "# note"]);
    expect(kinds(tokenizeLines(["echo hi # note"], "sh")[0]).at(-1)).toEqual(["comment", "# note"]);
    expect(tokenizeLines(["this.#count = 1"], "ts")[0].some((token) => token.kind === "comment")).toBe(false);
  });

  it("carries a Python triple-quoted string across lines", () => {
    const [first, second, third] = tokenizeLines(['doc = """start', "middle", 'end""" + x'], "python");

    expect(first.at(-1)).toEqual({ kind: "string", text: '"""start' });
    expect(second).toEqual([{ kind: "string", text: "middle" }]);
    expect(third[0]).toEqual({ kind: "string", text: 'end"""' });
  });

  it("marks numbers, but not digits inside a name", () => {
    const tokens = tokenizeLines(["let x2 = 42;"], "ts")[0];

    expect(tokens).toContainEqual({ kind: "number", text: "42" });
    expect(tokens.some((token) => token.text === "2")).toBe(false);
  });

  it("leaves a file of unknown language plain", () => {
    expect(tokenizeLines(["const x = 1 // no"], "")).toEqual([[{ kind: "plain", text: "const x = 1 // no" }]]);
  });

  it("gives back every line exactly, for a real file", () => {
    const lines = readFileSync(join(__dirname, "../lib/diff-stats.ts"), "utf8").split("\n").slice(0, 50);
    const tokens = tokenizeLines(lines, "ts");

    tokens.forEach((line, index) => expect(line.map((token) => token.text).join("")).toBe(lines[index]));
  });
});
