import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CANVAS_GUIDE, CANVAS_REFUSALS, artboardCount, canvasFileUrl, canvasResultText, canvasShellState, parseCanvasRead, type Canvas, type CanvasRead } from "../lib/canvas";

const KEY = "c-0123456789abcdef";
const ENTRY = { key: KEY, folder: "/w/design/x", relative: "design/x", title: "Checkout", shownAt: 5, artboards: 3 };
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

describe("the wrapper's state", () => {
  const SESSION = "session-1794800000000-k3x9a";
  const SHA_A = "a".repeat(64);
  const SHA_B = "b".repeat(64);
  const read = (boards: { id: string; sha256: string | null }[]): CanvasRead => ({
    ...(READ as CanvasRead),
    boards,
  });

  it("builds the shell state with file URLs equal to the backend's", () => {
    const rows = JSON.parse(readFileSync("src/test/fixtures/canvas-file-urls.json", "utf8")) as { sessionId: string; key: string; relative: string; url: string }[];
    for (const row of rows) expect(canvasFileUrl(row.sessionId, row.key, row.relative)).toBe(row.url);

    const state = JSON.parse(
      canvasShellState(read([{ id: "cart", sha256: SHA_A }, { id: "pay", sha256: null }, { id: "pay2", sha256: SHA_B }]), SESSION, new Map([["cart", "zorvo-artifact://localhost/thumb/x.png"]]), "pay2"),
    );

    expect(state.sections).toEqual([{ id: "flow", title: "Flow" }]);
    expect(state.selected).toBe("pay2");
    expect(state.boards[0]).toEqual({
      id: "cart",
      section: "flow",
      group: null,
      title: "Cart",
      width: 1440,
      height: 900,
      url: `${canvasFileUrl(SESSION, KEY, "cart.html")}?v=aaaaaaaaaaaa`,
      thumb: "zorvo-artifact://localhost/thumb/x.png",
    });
    // A file that is gone has no URL and says so.
    expect(state.boards[1]).toEqual({ id: "pay", section: "flow", group: "p", title: "Pay", width: 390, height: 844, missing: true });
    expect(state.boards[2].url).toBe(`${canvasFileUrl(SESSION, KEY, "pay2.html")}?v=bbbbbbbbbbbb`);
  });

  it("gives a changed artboard a new URL and an unchanged one the same", () => {
    const before = JSON.parse(canvasShellState(read([{ id: "cart", sha256: SHA_A }, { id: "pay", sha256: SHA_A }, { id: "pay2", sha256: SHA_A }]), SESSION, new Map()));
    const after = JSON.parse(canvasShellState(read([{ id: "cart", sha256: SHA_A }, { id: "pay", sha256: SHA_B }, { id: "pay2", sha256: SHA_A }]), SESSION, new Map()));

    expect(after.boards[0].url).toBe(before.boards[0].url);
    expect(after.boards[1].url).not.toBe(before.boards[1].url);
    expect(after.boards[2].url).toBe(before.boards[2].url);
    expect(after.selected).toBeNull();
  });

  it("counts a canvas's artboards", () => {
    expect(artboardCount(CANVAS as Canvas)).toBe(3);
  });
});
