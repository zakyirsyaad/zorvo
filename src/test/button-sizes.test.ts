import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const COMPONENTS = join(SRC, "components");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * Each `<Button …>` opening tag's className. A tag ends at the first `>` outside `{…}`,
 * so an arrow function or an `icon={<X />}` in a prop does not cut it short.
 */
function buttonClassNames(source: string): { line: number; className: string }[] {
  const found: { line: number; className: string }[] = [];
  for (const match of source.matchAll(/<Button\b/g)) {
    const start = match.index ?? 0;
    let end = start + 1;
    for (let depth = 0; end < source.length; end++) {
      const character = source[end];
      if (character === "{") depth++;
      else if (character === "}") depth--;
      else if (character === ">" && depth === 0) break;
    }
    const tag = source.slice(start, end);
    const className = /className="([^"]*)"/.exec(tag)?.[1];
    if (className !== undefined) found.push({ line: source.slice(0, start).split("\n").length, className });
  }
  return found;
}

describe("Button sizes", () => {
  it("are set by `size`, never by padding or text size in a caller's className", () => {
    // Button's size sets px, h and the text size; a caller's px/py/text-[…] would sit beside
    // them on one element, where neither utility reliably wins. Use size="sm" | "md" | "lg".
    // Weight is Button's too (400 or 500 by variant), so a font-weight utility would sit beside its own.
    const SIZE_OVERRIDE =
      /(?:^|\s)(?:p[xy]-[\w.]+|text-\[[^\]]+\]|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black))(?=\s|$)/;
    const violations = tsxFiles(COMPONENTS)
      .filter((file) => !file.endsWith(join("ui", "Button.tsx")))
      .flatMap((file) =>
        buttonClassNames(readFileSync(file, "utf8"))
          .filter(({ className }) => SIZE_OVERRIDE.test(className))
          .map(({ line, className }) => `${relative(SRC, file)}:${line} ${className}`),
      );
    expect(violations).toEqual([]);
  });
});
