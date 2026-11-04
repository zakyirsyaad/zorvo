import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Inspector } from "../components/inspector/Inspector";
import type { InspectorTab } from "../lib/inspector";

function renderInspector(tab: InspectorTab, width = 380) {
  const handlers = { onSelect: vi.fn(), onResize: vi.fn(), onClose: vi.fn() };
  const view = render(
    <Inspector tab={tab} tabs={["changes", "files", "terminal"]} width={width} counts={{ changes: 3 }} {...handlers}>
      <p>panel body</p>
    </Inspector>,
  );
  return { ...handlers, ...view };
}

describe("Inspector", () => {
  it("shows the offered tabs and the current one", () => {
    renderInspector("files");
    const tabs = within(screen.getByRole("tablist", { name: "Inspector" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Changes3", "Files", "Terminal"]);
    const files = screen.getByRole("tab", { name: "Files" });
    expect(files).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Files" });
    expect(panel).toHaveTextContent("panel body");
  });

  it("selects a tab and closes", () => {
    const { onSelect, onClose } = renderInspector("files");
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(onSelect).toHaveBeenCalledWith("terminal");
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resizes from the keyboard within bounds", () => {
    const at = (width: number) => {
      const view = renderInspector("files", width);
      const edge = screen.getByRole("separator", { name: "Resize inspector" });
      return { ...view, edge };
    };
    const first = at(380);
    expect(first.edge).toHaveAttribute("aria-valuenow", "380");
    expect(first.edge).toHaveAttribute("aria-valuemin", "320");
    expect(first.edge).toHaveAttribute("aria-valuemax", "720");
    fireEvent.keyDown(first.edge, { key: "ArrowLeft" });
    expect(first.onResize).toHaveBeenLastCalledWith(396);
    first.unmount();

    const narrow = at(320);
    // Already at the minimum: nothing would change.
    fireEvent.keyDown(narrow.edge, { key: "ArrowRight" });
    expect(narrow.onResize).not.toHaveBeenCalled();
    narrow.unmount();

    const wide = at(712);
    fireEvent.keyDown(wide.edge, { key: "ArrowLeft" });
    expect(wide.onResize).toHaveBeenLastCalledWith(720);
  });

  it("drags its left edge", () => {
    const { onResize } = renderInspector("files", 380);
    const edge = screen.getByRole("separator", { name: "Resize inspector" });
    fireEvent.pointerDown(edge, { clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onResize).toHaveBeenLastCalledWith(480);
    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: 800 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("is at least 560px wide on the Terminal tab", () => {
    const { unmount } = renderInspector("terminal", 380);
    expect(screen.getByRole("region", { name: "Inspector" }).style.width).toBe("560px");
    unmount();
    renderInspector("files", 380);
    expect(screen.getByRole("region", { name: "Inspector" }).style.width).toBe("380px");
  });

  it("resizes the Terminal tab from the width it shows", () => {
    const { onResize } = renderInspector("terminal", 380);
    const edge = screen.getByRole("separator", { name: "Resize inspector" });
    expect(edge).toHaveAttribute("aria-valuenow", "560");
    expect(edge).toHaveAttribute("aria-valuemin", "560");
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(onResize).not.toHaveBeenCalled();
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(576);
    fireEvent.pointerDown(edge, { clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: 990 });
    expect(onResize).toHaveBeenLastCalledWith(570);
    fireEvent.pointerUp(window);
  });
});
