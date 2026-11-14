import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

/** Any use of `bg` or `surface-1` as a fill, ring, edge, outline or gradient stop. */
const OLD_SURFACE = /\b(?:bg|ring|border|outline|fill|stroke|from|via|to)-(?:bg|surface-1)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("surfaces on a sheet", () => {
  it("paints nothing with bg or surface-1: every screen is on the ground, a sheet or a card", () => {
    const files = [...sourceFiles(join(SRC, "components")), join(SRC, "App.tsx")];
    const offenders = files.flatMap((file) => {
      const path = relative(SRC, file);
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (OLD_SURFACE.test(line) ? [`${path}:${index + 1}`] : []));
    });
    expect(offenders).toEqual([]);
  });
});
