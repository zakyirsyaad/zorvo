import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Popover } from "../components/ui/Popover";
import { fitPanel } from "../lib/popover-fit";

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
