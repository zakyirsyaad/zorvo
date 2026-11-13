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
  it("has the canvas's title and sentence, 16px above the control", () => {
    renderAppearance();
    const title = screen.getByRole("heading", { level: 1, name: "Appearance" });
    expect(screen.getByText("The terminal stays dark in every theme, since agents color their output for a dark ground.")).toBeInTheDocument();
    expect(title.parentElement?.parentElement).toHaveClass("flex", "flex-col", "gap-4");
  });

  it("the three themes are one radio group", () => {
    renderAppearance("system");
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
  });

  it("is drawn as a segmented control: a chip track, the picked segment raised", () => {
    renderAppearance("system");
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toHaveClass("inline-flex", "rounded-lg", "bg-chip", "p-0.5");
    const [system, light] = within(group).getAllByRole("radio");
    expect(system).toHaveClass("h-6.5", "rounded-md", "px-3.5", "bg-surface-hover", "text-fg", "focus-ring");
    expect(system).not.toHaveClass("px-2.5");
    expect(light).toHaveClass("text-fg-muted");
    expect(light).not.toHaveClass("bg-surface-hover");
  });

  it("says System follows your Mac beside the control, only while System is picked", () => {
    const { unmount } = render(<AppearanceSection appearance="system" onChange={vi.fn()} />);
    const note = screen.getByText("follows your Mac");
    expect(note).toHaveClass("text-ui-sm", "text-fg-subtle");
    // Beside the track, not inside a segment, and read with System.
    expect(note.closest('[role="radiogroup"]')).toBeNull();
    expect(note.parentElement).toHaveClass("flex", "items-center", "gap-3");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAccessibleDescription("follows your Mac");
    unmount();

    renderAppearance("dark");
    expect(screen.queryByText("follows your Mac")).toBeNull();
    expect(screen.getByRole("radio", { name: "System" })).not.toHaveAttribute("aria-describedby");
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

  it("only the checked segment is in the tab order", () => {
    renderAppearance("light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /System/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("tabindex", "-1");
  });

  it("draws no preview tiles", () => {
    const { container } = render(<AppearanceSection appearance="system" onChange={vi.fn()} />);
    expect(container.querySelector('[class*="theme-sample"]')).toBeNull();
  });
});
