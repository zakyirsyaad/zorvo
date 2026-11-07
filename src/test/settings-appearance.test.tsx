import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AppearanceSection } from "../components/settings/AppearanceSection";
import type { Appearance } from "../lib/appearance";

function renderAppearance(appearance: Appearance = "system") {
  const onChange = vi.fn();
  render(<AppearanceSection appearance={appearance} onChange={onChange} />);
  return onChange;
}

describe("Appearance section", () => {
  it("has the canvas's title and sentence, 16px above the tiles", () => {
    renderAppearance();
    const title = screen.getByRole("heading", { level: 1, name: "Appearance" });
    expect(screen.getByText("The terminal stays dark in every theme, since agents color their output for a dark ground.")).toBeInTheDocument();
    expect(title.parentElement?.parentElement).toHaveClass("flex", "flex-col", "gap-4");
  });

  it("the three themes are one radio group", () => {
    renderAppearance("system");
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["System· follows your Mac", "Light", "Dark"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveClass("border-fg", "ring-1", "ring-fg");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
    expect(radios[1]).not.toHaveClass("ring-fg");
    expect(radios[1]).toHaveClass("rounded-[10px]", "border-border", "bg-surface-2", "p-2");
  });

  it("a click picks a theme", () => {
    const onChange = renderAppearance();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("arrow keys move and select, wrapping at the ends", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [appearance, setAppearance] = useState<Appearance>("system");
      return <AppearanceSection appearance={appearance} onChange={(next) => { onChange(next); setAppearance(next); }} />;
    }
    render(<Controlled />);
    const system = screen.getByRole("radio", { name: /System/ });
    system.focus();
    fireEvent.keyDown(system, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("system");
    expect(system).toHaveFocus();
    fireEvent.keyDown(system, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();
  });

  it("only the checked tile is in the tab order", () => {
    renderAppearance("light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /System/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("tabindex", "-1");
  });

  it("previews use the fixed samples", () => {
    renderAppearance();
    const system = screen.getByRole("radio", { name: /System/ });
    expect(system.querySelector(".theme-sample-light")).not.toBeNull();
    expect(system.querySelector(".theme-sample-dark")).not.toBeNull();
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(dark.querySelector(".theme-sample-dark")).not.toBeNull();
    expect(dark.querySelector(".theme-sample-light")).toBeNull();
    expect(screen.getByRole("radio", { name: "Light" }).querySelector(".theme-sample-dark")).toBeNull();
  });

  it("the checked tile's label is the bright one", () => {
    renderAppearance("dark");
    expect(screen.getByText("Dark")).toHaveClass("text-fg", "font-medium");
    expect(screen.getByText("System")).toHaveClass("text-fg-secondary");
    expect(screen.getByText("System")).not.toHaveClass("font-medium");
  });
});
