import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OptionDropdown, type DropdownOption } from "../components/composer/OptionDropdown";

/** What a compare draft's model chip needs: to know it was opened, and to show a status while its list loads. */
const options: DropdownOption[] = [{ value: "opus", label: "Opus" }];

const dropdown = (props: Partial<Parameters<typeof OptionDropdown>[0]>) => (
  <OptionDropdown label="Model" options={options} selected="opus" isOpen={false} onToggle={() => {}} onSelect={() => {}} {...props} />
);

describe("an option dropdown's opener and status", () => {
  it("calls onOpen when the menu opens, once", () => {
    const onOpen = vi.fn();
    const { rerender } = render(dropdown({ onOpen }));
    expect(onOpen).not.toHaveBeenCalled();
    rerender(dropdown({ onOpen, isOpen: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(dropdown({ onOpen, isOpen: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(dropdown({ onOpen, isOpen: false }));
    rerender(dropdown({ onOpen, isOpen: true }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("draws the status in place of the rows", () => {
    render(dropdown({ isOpen: true, status: <p>Asking Codex for its models…</p> }));
    expect(screen.getByText("Asking Codex for its models…")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("listbox", { name: "Model" })).toHaveClass("w-75");
  });
});
