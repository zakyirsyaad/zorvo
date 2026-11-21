import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CANVAS_GUIDE, CANVAS_REFUSALS, FOLDER_NOT_FOUND, artboardCount, parseCanvasEntries, canvasFileUrl, canvasResultText, pickMessage, buildMessage, buildSectionMessage, canvasShellState, parseCanvasRead, type Canvas, type CanvasRead } from "../lib/canvas";

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

  it("keeps FOLDER_NOT_FOUND equal to the Rust sentence, and a listed canvas's folderGone", () => {
    expect(readFileSync("src-tauri/src/artifacts/commands.rs", "utf8")).toContain(`const FOLDER_NOT_FOUND: &str = "${FOLDER_NOT_FOUND}";`);
    expect(parseCanvasEntries([{ ...ENTRY, folderGone: true }, ENTRY])).toEqual([{ ...ENTRY, folderGone: true }, ENTRY]);
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
      url: `${canvasFileUrl(SESSION, KEY, "cart.html")}?v=aaaaaaaaaaaa&b=cart`,
      thumb: "zorvo-artifact://localhost/thumb/x.png",
    });
    // A file that is gone has no URL and says so.
    expect(state.boards[1]).toEqual({ id: "pay", section: "flow", group: "p", title: "Pay", width: 390, height: 844, missing: true });
    expect(state.boards[2].url).toBe(`${canvasFileUrl(SESSION, KEY, "pay2.html")}?v=bbbbbbbbbbbb&b=pay2`);
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

const SPEC_CANVAS: Canvas = {
  title: "Checkout",
  sections: [
    { id: "flow", title: "Flow", artboards: [{ id: "cart", title: "Cart", file: "cart.html", width: 1440, height: 900, group: null }] },
    {
      id: "pay",
      title: "Payment variants",
      artboards: [
        { id: "pay-a", title: "Payment A", file: "pay-a.html", width: 1440, height: 900, group: "pay" },
        { id: "pay-b", title: "Payment B", file: "pay-b.html", width: 1440, height: 900, group: "pay" },
      ],
    },
  ],
};
const PAY_B = SPEC_CANVAS.sections[1].artboards[1];

describe("the Pick and Build messages", () => {
  it("words Pick as the spec does", () => {
    expect(pickMessage(SPEC_CANVAS, "design/checkout", PAY_B)).toBe(
      "Use variant Payment B (`design/checkout/pay-b.html`) from the Checkout canvas. Drop the other pay variants: `pay-a.html`.",
    );
  });

  it("lists every other variant in canvas order, across sections", () => {
    const canvas: Canvas = {
      title: "C",
      sections: [
        { id: "a", title: "A", artboards: [{ id: "x1", title: "X1", file: "x1.html", width: 1, height: 1, group: "g" }] },
        { id: "b", title: "B", artboards: [{ id: "x2", title: "X2", file: "x2.html", width: 1, height: 1, group: "g" }, { id: "x3", title: "X3", file: "x3.html", width: 1, height: 1, group: "g" }] },
      ],
    };
    expect(pickMessage(canvas, "d", canvas.sections[1].artboards[0])).toContain("variants: `x1.html`, `x3.html`.");
  });

  it("words Build this as the spec does", () => {
    expect(buildMessage("design/checkout", PAY_B)).toBe("Build the Payment B screen from `design/checkout/pay-b.html` (1440 × 900) in this repository.");
  });

  it("words Build section with one line per artboard", () => {
    const flow = { id: "f", title: "Flow", artboards: [SPEC_CANVAS.sections[0].artboards[0], PAY_B] };
    expect(buildSectionMessage(SPEC_CANVAS, "design/checkout", flow)).toBe(
      "Build the screens of the Flow section of the Checkout canvas in this repository, in this order:\n" +
        "- Cart: `design/checkout/cart.html` (1440 × 900)\n" +
        "- Payment B: `design/checkout/pay-b.html` (1440 × 900)",
    );
  });

  it("escapes a title with a bidi control and keeps a backtick in a file inside its code span", () => {
    const board = { id: "x", title: "Pay\u202Eevil", file: "a`b.html", width: 10, height: 20, group: null };
    const text = buildMessage("d", board);
    expect(text).not.toContain("\u202E");
    expect(text).toContain("``d/a`b.html``");
  });

  it("builds from a canvas at the session's folder", () => {
    expect(buildMessage("", PAY_B)).toContain("`pay-b.html`");
  });
});
