import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CANVAS_GUIDE, CANVAS_REFUSALS, canvasResultText, parseCanvasRead } from "../lib/canvas";

const KEY = "c-0123456789abcdef";
const ENTRY = { key: KEY, folder: "/w/design/x", relative: "design/x", title: "Checkout", shownAt: 5 };
const CANVAS = {
  title: "Checkout",
  sections: [
    {
      id: "flow",
      title: "Flow",
      artboards: [
        { id: "cart", title: "Cart", file: "cart.html", width: 1440, height: 900, group: null },
        { id: "pay", title: "Pay", file: "pay.html", width: 390, height: 844, group: "p" },
        { id: "pay2", title: "Pay 2", file: "pay2.html", width: 390, height: 844, group: "p" },
      ],
    },
  ],
};
const READ = {
  entry: ENTRY,
  canvas: CANVAS,
  error: null,
  boards: [
    { id: "cart", sha256: "a".repeat(64) },
    { id: "pay", sha256: null },
    { id: "pay2", sha256: null },
  ],
};

describe("canvas answers", () => {
  it("parses a canvas read and refuses other shapes", () => {
    expect(parseCanvasRead(READ)).toEqual(READ);
    const broken = { entry: ENTRY, canvas: null, error: "Folder not found", boards: [] };
    expect(parseCanvasRead(broken)).toEqual(broken);
    for (const bad of [null, "x", [], { ...READ, entry: { ...ENTRY, key: "nope" } }, { ...READ, boards: [{ id: 3 }] }, { ...READ, error: 3 }, { ...READ, canvas: { title: 3, sections: [] } }]) {
      expect(parseCanvasRead(bad)).toBeNull();
    }
  });

  it("words the answer to the agent", () => {
    expect(canvasResultText(parseCanvasRead(READ)!)).toBe(`{"shown":true,"canvas":"${KEY}","artboards":3}`);
  });

  it("keeps CANVAS_REFUSALS equal to the Rust sentences", () => {
    const rust = ["src-tauri/src/artifacts/store.rs", "src-tauri/src/artifacts/canvas.rs"].map((file) => readFileSync(file, "utf8")).join("\n");
    const oneLine = rust.replace(/"\s*\n\s*"/g, "").replace(/=\s*\n\s*"/g, '= "');
    for (const refusal of CANVAS_REFUSALS) {
      expect(oneLine).toContain(`"${refusal}"`);
    }
    expect(CANVAS_REFUSALS.size).toBe(2);
  });

  it("has a guide that names the format and the CDNs", () => {
    for (const words of ["canvas.json", "design/", "1440", "390", "group", "cdnjs.cloudflare.com", "kind"]) {
      expect(CANVAS_GUIDE).toContain(words);
    }
  });
});
