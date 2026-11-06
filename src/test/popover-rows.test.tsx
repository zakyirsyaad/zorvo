import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Popover, PopoverGroup, PopoverHeader, PopoverOption, PopoverSearch } from "../components/ui/Popover";

describe("a group of options under a heading", () => {
  it("is named by its heading, which is shown but not read a second time inside the group", () => {
    render(
      <Popover isOpen onClose={() => {}} label="More options" trigger={<button type="button">More</button>}>
        <PopoverGroup heading="Collaboration">
          <PopoverOption onSelect={() => {}}>Pair</PopoverOption>
        </PopoverGroup>
      </Popover>,
    );
    const group = screen.getByRole("group", { name: "Collaboration" });
    expect(group).not.toHaveAttribute("aria-label");
    const heading = screen.getByText("Collaboration");
    expect(heading.closest("[aria-hidden='true']")).not.toBeNull();
    expect(heading.parentElement).toHaveClass("text-caption", "font-medium", "text-fg-muted");
  });

  it("names the group by the heading alone, never by a hint beside it", () => {
    render(<PopoverHeader labelId="h" aside="Pick more than one">Agents</PopoverHeader>);
    expect(document.getElementById("h")).toHaveTextContent(/^Agents$/);
  });
});

/** The rows of the composer's and draft's menus, as `ComposerMenus` and `DraftPickers` draw them. */
describe("popover rows as drawn", () => {
  it("puts a checkable row's check on the left, in a 14px slot", () => {
    render(
      <Popover isOpen onClose={() => {}} label="Mode" role="listbox" trigger={<button type="button">Mode</button>}>
        <PopoverOption selected onSelect={() => {}}>
          Ask
        </PopoverOption>
        <PopoverOption selected={false} onSelect={() => {}}>
          Plan
        </PopoverOption>
      </Popover>,
    );
    const [ask, plan] = screen.getAllByRole("option");
    const slot = ask.firstElementChild as HTMLElement;
    expect(slot).toHaveAttribute("data-check-slot");
    expect(slot).toHaveClass("w-3.5", "shrink-0");
    expect(slot.querySelector("svg")).not.toBeNull();
    expect((plan.firstElementChild as HTMLElement).querySelector("svg")).toBeNull();
    // No check on the right any more.
    expect(ask.lastElementChild?.querySelector("svg")).toBeNull();
  });

  it("gives a plain menu item no check slot", () => {
    render(
      <Popover isOpen onClose={() => {}} label="Actions" trigger={<button type="button">More</button>}>
        <PopoverOption onSelect={() => {}}>Rename</PopoverOption>
      </Popover>,
    );
    expect(screen.getByRole("menuitem").querySelector("[data-check-slot]")).toBeNull();
  });

  it("writes a description at 11/15 in fg-subtle and tops the row", () => {
    render(
      <Popover isOpen onClose={() => {}} label="Mode" role="listbox" trigger={<button type="button">Mode</button>}>
        <PopoverOption selected={false} onSelect={() => {}} description="Reads and plans.">
          Plan
        </PopoverOption>
      </Popover>,
    );
    const option = screen.getByRole("option");
    expect(option).toHaveClass("items-start", "py-1.75", "px-2", "rounded", "gap-2");
    expect(screen.getByText("Reads and plans.")).toHaveClass("text-caption", "leading-[15px]", "text-fg-subtle");
  });

  it("centres a one-line row", () => {
    render(
      <Popover isOpen onClose={() => {}} label="Mode" role="listbox" trigger={<button type="button">Mode</button>}>
        <PopoverOption selected={false} onSelect={() => {}}>
          Plan
        </PopoverOption>
      </Popover>,
    );
    expect(screen.getByRole("option")).toHaveClass("items-center", "py-1.5");
  });

  it("draws the search field 30px with its icon", () => {
    render(<PopoverSearch value="" onChange={() => {}} placeholder="Search branches" />);
    const input = screen.getByRole("textbox", { name: "Search branches" });
    const field = input.closest("label")!;
    expect(field).toHaveClass(
      "focus-ring-within",
      "flex",
      "h-7.5",
      "items-center",
      "gap-2",
      "rounded",
      "border",
      "border-border",
      "bg-surface-2",
      "px-2",
      "text-fg-subtle",
      "mb-1",
    );
    expect(field.querySelector("svg")).not.toBeNull();
    expect(input).toHaveClass("min-w-0", "flex-1", "bg-transparent", "text-ui-sm", "text-fg", "outline-none");
  });

  it("keeps type search when asked", () => {
    render(<PopoverSearch type="search" value="" onChange={() => {}} placeholder="Search model" />);
    expect(screen.getByRole("searchbox", { name: "Search model" })).toBeInTheDocument();
  });

  it("puts a header's aside on the right in fg-subtle", () => {
    render(<PopoverHeader aside="Pick more than one to compare">Agents</PopoverHeader>);
    const aside = screen.getByText("Pick more than one to compare");
    expect(aside).toHaveClass("font-normal", "text-fg-subtle");
    expect(aside.parentElement).toHaveClass("flex", "pt-1.5", "pb-1", "px-2", "text-caption", "font-medium", "text-fg-muted");
  });
});
