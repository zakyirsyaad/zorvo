import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const css = readFileSync(join(ROOT, "src", "styles", "globals.css"), "utf8");

interface MotionToken {
  name: string;
  value: string;
  easing?: string;
}
const doc: { motion: { tokens: MotionToken[] } } = JSON.parse(
  readFileSync(join(ROOT, "docs", "design-system", "tokens.json"), "utf8"),
);

/** The value of `--<name>` in globals.css, spaces removed. */
function declared(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].replace(/\s+/g, "");
}

/** Every component and screen source under src/, tests left out. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("motion tokens", () => {
  it("documents the four durations and the curve with the values globals.css declares", () => {
    const names = doc.motion.tokens.map((token) => token.name).sort();
    expect(names).toEqual(["duration-appear", "duration-menu", "duration-panel", "duration-quick", "ease-soft"]);
    for (const token of doc.motion.tokens) {
      const variable = token.name.startsWith("duration-") ? `transition-${token.name}` : token.name;
      expect(declared(variable), token.name).toBe(token.value.replace(/\s+/g, ""));
    }
  });

  it("gives every transition that names no duration the quick token", () => {
    expect(declared("default-transition-duration")).toBe("var(--transition-duration-quick)");
    expect(declared("default-transition-timing-function")).toBe("ease-out");
  });

  it("declares the working logo's two loops and their keyframes, opacity only", () => {
    expect(declared("animate-working-chevron")).toBe("working-light1.4sease-in-outinfinite");
    expect(declared("animate-working-chevron-late")).toBe("working-light1.4sease-in-out200msinfinitebackwards");
    expect(declared("animate-working-cursor")).toBe("working-blink1ssteps(1,end)infinite");
    for (const name of ["working-light", "working-blink"]) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n  \\}`).exec(css)?.[1] ?? "";
      expect(body, name).toContain("opacity");
      expect(body, name).not.toMatch(/transform|width|height|margin/);
    }
  });

  it("ends every transition and animation at once under Reduce motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("animation-duration: 1ms !important;");
    expect(block).toContain("transition-duration: 1ms !important;");
    expect(block).toContain("animation-iteration-count: 1 !important;");
  });

  it("animates nothing but a spinner, a loading pulse, the three entrances and the working logo, and each only with motion allowed", () => {
    const allowed = new Set(["spin", "pulse", "menu-in", "panel-in", "appear", "working-chevron", "working-chevron-late", "working-cursor"]);
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/([\w-]*:)?animate-([a-z-]+)/g)) {
        const [whole, variant, name] = match;
        if (variant !== "motion-safe:" || !allowed.has(name)) offenders.push(`${file.slice(ROOT.length)}: ${whole}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
