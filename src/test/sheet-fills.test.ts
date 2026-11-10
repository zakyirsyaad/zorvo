import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

/** Files that keep the old surfaces until their own phase: Settings and onboarding (6), the agent catalog (6), the draft chips (5). */
const KEEPS_OLD_SURFACES = [
  "components/settings/",
  "components/agents/",
  "components/onboarding/",
  "components/Onboarding.tsx",
  "components/composer/chip-style.ts",
];

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
  it("paints nothing with bg or surface-1 outside the areas that have not moved yet", () => {
    const files = [...sourceFiles(join(SRC, "components")), join(SRC, "App.tsx")];
    const offenders = files.flatMap((file) => {
      const path = relative(SRC, file);
      if (KEEPS_OLD_SURFACES.some((kept) => path.startsWith(kept))) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (OLD_SURFACE.test(line) ? [`${path}:${index + 1}`] : []));
    });
    expect(offenders).toEqual([]);
  });
});
