import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Popover } from "../components/ui/Popover";
import { fitAlign, fitPanel } from "../lib/popover-fit";

/**
 * A menu opens on its own side when it fits there, else on the side with more room, and is capped to that room
 * and scrolls, so no part of it is cut off by the box that clips it (the main area's scrolling column).
 */
const box = (top: number, bottom: number) => ({ top, bottom });

describe("fitPanel", () => {
  it("keeps the side it was asked for when the panel fits there", () => {
    expect(fitPanel(box(100, 128), box(0, 800), 300, "bottom")).toEqual({ side: "bottom" });
  });

  it("opens on the other side when that has more room, capped to it when it still does not fit", () => {
    // 600 - 428 - 4 - 8 = 160 below; 400 - 0 - 4 - 8 = 388 above.
    expect(fitPanel(box(400, 428), box(0, 600), 300, "bottom")).toEqual({ side: "top" });
    expect(fitPanel(box(400, 428), box(0, 600), 500, "bottom")).toEqual({ side: "top", maxHeight: 388 });
  });

  it("stays on its side, capped, when the other side has less room", () => {
    expect(fitPanel(box(100, 128), box(0, 500), 500, "bottom")).toEqual({ side: "bottom", maxHeight: 360 });
  });

  it("never caps a panel below a usable height", () => {
    expect(fitPanel(box(10, 38), box(0, 60), 300, "bottom")).toEqual({ side: "bottom", maxHeight: 96 });
  });

  it("does nothing without a layout (bounds with no height)", () => {
    expect(fitPanel(box(0, 0), box(0, 0), 0, "bottom")).toBeNull();
    // The viewport has a height in jsdom, but the trigger is laid out at nothing: no room can be read from it.
    expect(fitPanel(box(0, 0), box(0, 768), 0, "top")).toBeNull();
  });
});

describe("a Popover inside a box that clips", () => {
  afterEach(() => vi.restoreAllMocks());

  function layout({ triggerTop, panelHeight }: { triggerTop: number; panelHeight: number }) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
      if (this.dataset.clip !== undefined) return rect(0, 600);
      if (this.dataset.popover !== undefined) return rect(triggerTop, triggerTop + 28);
      return rect(0, 0);
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? panelHeight : 0;
    });
  }

  function renderMenu() {
    render(
      // The longhand: jsdom does not expand `overflow` into `overflowY` as a browser does.
      <div data-clip="" style={{ overflowY: "hidden" }}>
        <Popover isOpen onClose={() => {}} label="Model" side="bottom" trigger={<button type="button">Model</button>}>
          <button type="button">Opus</button>
        </Popover>
      </div>,
    );
    return screen.getByRole("menu", { name: "Model" });
  }

  it("opens above its chip when the room below would cut it off", () => {
    layout({ triggerTop: 400, panelHeight: 300 });
    const menu = renderMenu();
    expect(menu).toHaveClass("bottom-full");
    expect(menu).not.toHaveClass("top-full");
    expect(menu.style.maxHeight).toBe("");
  });

  it("is capped to the room it has and scrolls when neither side holds it", () => {
    layout({ triggerTop: 400, panelHeight: 500 });
    const menu = renderMenu();
    expect(menu).toHaveClass("bottom-full", "overflow-y-auto");
    expect(menu.style.maxHeight).toBe("388px");
  });

  it("measures again when the box around it scrolls or the window resizes, so it never stays cut off", () => {
    layout({ triggerTop: 100, panelHeight: 300 });
    renderMenu();
    expect(screen.getByRole("menu", { name: "Model" })).toHaveClass("top-full");

    // The column scrolled: the chip is now low in it, with no room under it.
    layout({ triggerTop: 400, panelHeight: 300 });
    act(() => {
      document.querySelector("[data-clip]")!.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("menu", { name: "Model" })).toHaveClass("bottom-full");

    layout({ triggerTop: 100, panelHeight: 300 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("menu", { name: "Model" })).toHaveClass("top-full");
  });

  it("does not move for a scroll inside its own list", () => {
    layout({ triggerTop: 100, panelHeight: 300 });
    renderMenu();
    layout({ triggerTop: 400, panelHeight: 300 });
    act(() => {
      screen.getByRole("menu", { name: "Model" }).dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("menu", { name: "Model" })).toHaveClass("top-full");
  });

  it("keeps a capped panel's scrolling to itself, so reaching its end does not scroll the column", () => {
    layout({ triggerTop: 400, panelHeight: 500 });
    expect(renderMenu()).toHaveClass("overflow-y-auto", "overscroll-contain");
  });

  it("keeps its side and its full height when it fits", () => {
    layout({ triggerTop: 100, panelHeight: 300 });
    const menu = renderMenu();
    expect(menu).toHaveClass("top-full");
    expect(menu).not.toHaveClass("overflow-y-auto");
    expect(menu.style.maxHeight).toBe("");
  });
});

/**
 * A menu keeps the edge of its chip it was asked to share when it fits there, else takes the other edge, so a
 * dialog that clips its content never cuts the menu's side off.
 */
const span = (left: number, right: number) => ({ left, right });

describe("fitAlign", () => {
  it("keeps the asked-for edge when the panel fits there", () => {
    expect(fitAlign(span(400, 480), span(0, 1000), 300, "end")).toBe("end");
    expect(fitAlign(span(400, 480), span(0, 1000), 300, "start")).toBe("start");
  });

  it("takes the other edge when the asked-for one would cross the clipping box", () => {
    // Shares the chip's right edge: 230 - 300 = -70, left of the box's 100.
    expect(fitAlign(span(150, 230), span(100, 620), 300, "end")).toBe("start");
    // Shares the chip's left edge: 500 + 300 = 800, right of the box's 620.
    expect(fitAlign(span(500, 580), span(100, 620), 300, "start")).toBe("end");
  });

  it("takes the edge that cuts off less when neither fits", () => {
    // end: 330 - 300 = 30, 78 short of 100 + 8; start: 250 + 300 = 550, 138 past 420 - 8.
    expect(fitAlign(span(250, 330), span(100, 420), 300, "start")).toBe("end");
  });

  it("decides nothing without a layout", () => {
    expect(fitAlign(span(0, 0), span(0, 1024), 0, "end")).toBeNull();
    expect(fitAlign(span(10, 90), span(0, 0), 300, "end")).toBeNull();
  });
});

describe("a Popover near the side of a box that clips", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens from its chip's left edge when the right-aligned panel would be cut off on the left", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const rect = (left: number, right: number, top: number, bottom: number) => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) });
      if (this.dataset.clip !== undefined) return rect(100, 620, 0, 600);
      if (this.dataset.popover !== undefined) return rect(150, 230, 100, 128);
      return rect(0, 0, 0, 0);
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? 300 : 0;
    });
    render(
      <div data-clip="" style={{ overflowX: "hidden", overflowY: "auto" }}>
        <Popover isOpen onClose={() => {}} label="Model" align="end" trigger={<button type="button">Model</button>}>
          <button type="button">Sol</button>
        </Popover>
      </div>,
    );
    const menu = screen.getByRole("menu", { name: "Model" });
    expect(menu).toHaveClass("left-0");
    expect(menu).not.toHaveClass("right-0");
  });
});

