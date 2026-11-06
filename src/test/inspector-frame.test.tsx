import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Inspector } from "../components/inspector/Inspector";

function renderInspector() {
  return render(
    <Inspector tab="changes" tabs={["changes", "activity", "files", "terminal"]} width={380} onSelect={() => {}} onResize={() => {}} onClose={() => {}}>
      <p>panel</p>
    </Inspector>,
  );
}

describe("the inspector's frame as drawn", () => {
  it("the tab strip is 48px with the canvas padding", () => {
    renderInspector();
    const strip = screen.getByRole("tablist", { name: "Inspector" }).parentElement!;
    expect(strip).toHaveClass("h-12", "pl-3", "pr-2");
  });

  it("close is a 24px icon button", () => {
    renderInspector();
    expect(screen.getByRole("button", { name: "Close inspector" })).toHaveClass("h-6", "w-6");
  });

  it("the section sets the 13/18 base text", () => {
    renderInspector();
    expect(screen.getByRole("region", { name: "Inspector" })).toHaveClass("text-ui", "text-fg");
  });

  it("the resize edge shows its line and grip while dragged", () => {
    renderInspector();
    const edge = screen.getByRole("separator", { name: "Resize inspector" });
    const [line, grip] = [...edge.querySelectorAll("[aria-hidden='true']")];
    expect(line).toHaveClass("w-[3px]", "bg-border-strong");
    expect(grip).toHaveClass("h-9", "w-2.5", "rounded-[5px]", "bg-border-strong");

    expect(edge).not.toHaveAttribute("data-dragging");
    fireEvent.pointerDown(edge, { clientX: 100 });
    expect(edge).toHaveAttribute("data-dragging");
    fireEvent.pointerUp(window);
    expect(edge).not.toHaveAttribute("data-dragging");
  });

  it("a drag ends when the pointer is cancelled or the window loses focus, and only the main button starts one", () => {
    renderInspector();
    const edge = screen.getByRole("separator", { name: "Resize inspector" });

    fireEvent.pointerDown(edge, { clientX: 100, button: 2 });
    expect(edge).not.toHaveAttribute("data-dragging");

    fireEvent.pointerDown(edge, { clientX: 100, button: 0 });
    fireEvent.pointerCancel(window);
    expect(edge).not.toHaveAttribute("data-dragging");

    fireEvent.pointerDown(edge, { clientX: 100, button: 0 });
    // A mouse released outside the window sends no pointerup here; the window losing focus ends it instead.
    fireEvent.blur(window);
    expect(edge).not.toHaveAttribute("data-dragging");
  });
});
