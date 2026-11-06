import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BranchPicker } from "../components/composer/BranchPicker";
import type { BranchControl } from "../components/composer/FolderPicker";

/** The draft's branch menu as the `DraftPickers` artboard draws it (lines 31–48). */
function renderMenu(branch: Partial<BranchControl> = {}) {
  const control: BranchControl = {
    current: "main",
    checkedOut: "main",
    branches: ["main", "fix/transcript-save-interval"],
    onOpen: vi.fn(),
    onPick: vi.fn(),
    ...branch,
  };
  render(
    <BranchPicker branch={control} worktree={{ isOn: true, onChange: vi.fn() }} isOpen onToggle={vi.fn()} onClose={vi.fn()} />,
  );
}

describe("the branch menu", () => {
  it("is 360 wide, with the 30px search field", () => {
    renderMenu();
    expect(screen.getByRole("dialog", { name: "Choose a branch" })).toHaveClass("w-90");
    expect(screen.getByRole("textbox", { name: "Search branches" }).closest("label")).toHaveClass("h-7.5");
  });

  it("lists branches in mono 12, the check on the left and the checked-out one named", () => {
    renderMenu();
    const main = screen.getByRole("option", { name: /^main/ });
    expect(main.querySelector("[data-check-slot] svg")).not.toBeNull();
    expect(within(main).getByText("main")).toHaveClass("font-mono", "text-ui-sm");
    expect(within(main).getByText("checked out")).toHaveClass("text-caption", "text-fg-muted");
    expect(within(screen.getByRole("option", { name: /^fix\// })).queryByText("checked out")).toBeNull();
  });

  it("checks a picked starting branch and still names the one checked out", () => {
    renderMenu({ current: "fix/transcript-save-interval", checkedOut: "main" });
    const picked = screen.getByRole("option", { name: /^fix\// });
    expect(picked).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("option", { name: /^main/ })).getByText("checked out")).toBeInTheDocument();
  });

  it("puts the worktree switch on the left, with its label over its description", () => {
    renderMenu();
    const toggle = screen.getByRole("switch", { name: "New worktree" });
    expect(toggle).toHaveClass("flex", "items-start", "gap-2.5", "px-2", "py-1.5");
    expect(toggle.firstElementChild).toHaveClass("h-4", "w-7", "mt-px");
    const label = within(toggle).getByText("New worktree");
    const description = within(toggle).getByText("Works on its own copy from main. Your checkout stays as it is.");
    expect(description).toHaveClass("text-caption", "text-fg-subtle");
    expect(label.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("separates the list from the switch with a 1px line", () => {
    renderMenu();
    const toggle = screen.getByRole("switch", { name: "New worktree" });
    expect(toggle.previousElementSibling).toHaveClass("my-1.5", "h-px", "bg-border");
  });
});
