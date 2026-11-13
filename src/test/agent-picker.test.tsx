import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { AgentMultiPicker } from "../components/composer/AgentMultiPicker";
import type { AgentChoice } from "../lib/composer-controls";

/** The draft's All agents list, as the `Home` and `DraftPickers` artboards draw it. */
const choice = (value: string, name: string, extra: Partial<AgentChoice> = {}): AgentChoice => ({ value, label: name, name, ...extra });

function renderPicker(options: AgentChoice[], selected: string[], isOpen = false) {
  return render(
    <AgentMultiPicker options={options} selected={selected} isOpen={isOpen} onToggle={vi.fn()} onChange={vi.fn()} onPick={vi.fn()} />,
  );
}

describe("the agent menu", () => {
  const options: AgentChoice[] = [
    choice("claude-acp", "Claude Code", { signIn: "ready" }),
    choice("codex-acp", "Codex", { signIn: "ready" }),
    choice("gemini", "Gemini CLI", { signIn: "unchecked" }),
    choice("qwen-code", "Qwen Code", { signIn: "needed", blockedBy: "sign-in", disabledReason: "You need to sign in first." }),
    choice("pi", "Pi", { label: "Pi (not installed)", blockedBy: "install", disabledReason: "You need to install it first." }),
  ];
  const openMenu = () => renderPicker(options, ["claude-acp", "codex-acp"], true);
  const rowOf = (name: string) => screen.getByRole("option", { name }).closest("[data-agent-row]") as HTMLElement;

  it("is 380 wide, headed Agents with the hint on the right", () => {
    openMenu();
    expect(screen.getByRole("dialog", { name: "Choose agents" })).toHaveClass("w-95");
    expect(screen.getByText("Agents").nextElementSibling).toHaveTextContent("Pick more than one to compare");
  });

  it("orders a row checkbox, logo, name, status, with a filled 14px box when ticked", () => {
    openMenu();
    const row = rowOf("Claude Code");
    const checkbox = within(row).getByRole("checkbox", { name: "Compare Claude Code" });
    const name = within(row).getByRole("option", { name: "Claude Code" });
    const status = within(row).getByText("Ready");
    expect(row).toHaveClass("flex", "h-7", "items-center", "gap-2", "rounded-md", "px-2");
    // The agent's logo sits in a 16px tile, and Ready has a dot of its own.
    expect(name.firstElementChild).toHaveClass("size-4", "bg-chip");
    expect(status.previousElementSibling).toHaveClass("size-1.5", "rounded-full", "bg-status-running");
    expect(row.firstElementChild).toBe(checkbox);
    expect(name.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checkbox.firstElementChild).toHaveClass("size-3.5", "rounded-[3px]", "border-[1.5px]", "bg-fg", "border-fg", "text-surface-3");
    expect(status).toHaveClass("text-caption", "text-fg-muted");
  });

  it("leaves an unticked box empty and a Not checked agent subtle", () => {
    openMenu();
    const row = rowOf("Gemini CLI");
    const box = within(row).getByRole("checkbox").firstElementChild!;
    expect(box).toHaveClass("border-border-strong");
    expect(box).not.toHaveClass("bg-fg");
    expect(within(row).getByText("Not checked")).toHaveClass("text-fg-subtle");
  });

  it("dims an agent that needs a sign-in, says so with an attention dot, and describes its checkbox with it", () => {
    openMenu();
    const row = rowOf("Qwen Code");
    expect(row).toHaveClass("opacity-55");
    const status = within(row).getByText("Needs sign-in");
    expect(status).toHaveClass("text-status-attention");
    expect(status.previousElementSibling).toHaveClass("size-1.5", "rounded-full", "bg-status-attention");
    const checkbox = within(row).getByRole("checkbox");
    const describedBy = checkbox.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent("Needs sign-in");
    expect(screen.queryByText("You need to sign in first.")).toBeNull();
  });

  it("names an agent that is not installed by its plain name, dimmed", () => {
    openMenu();
    const row = rowOf("Pi");
    expect(row).toHaveClass("opacity-55");
    expect(within(row).getByText("Not installed")).toHaveClass("text-fg-subtle");
    expect(screen.queryByText("Pi (not installed)")).toBeNull();
  });

  it("ends with how a compare run works", () => {
    openMenu();
    const footer = screen.getByText("With two or more agents, each runs in its own worktree in its safest mode.");
    expect(footer).toHaveClass("text-caption", "text-fg-subtle", "px-2", "pt-1", "pb-1.5");
  });

  it("arrow keys reach the checkbox and the name", () => {
    openMenu();
    const checkbox = screen.getByRole("checkbox", { name: "Compare Claude Code" });
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Claude Code" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Compare Codex" })).toHaveFocus();
  });
});

describe("the All agents button", () => {
  it("is a quiet 24px button that opens the list", () => {
    renderPicker([choice("claude-acp", "Claude Code"), choice("codex-acp", "Codex")], ["claude-acp"]);
    const button = screen.getByRole("button", { name: "All agents" });
    expect(button).toHaveClass("h-6", "rounded-md", "px-1.5", "text-ui-sm", "text-fg-muted");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("lists runnable agents first, then the ones that need a sign-in, then the ones not installed", () => {
    renderPicker(
      [
        choice("pi", "Pi", { blockedBy: "install", disabledReason: "You need to install it first." }),
        choice("qwen-code", "Qwen Code", { signIn: "needed", blockedBy: "sign-in", disabledReason: "You need to sign in first." }),
        choice("claude-acp", "Claude Code", { signIn: "ready" }),
        choice("codex-acp", "Codex", { signIn: "unchecked" }),
      ],
      ["claude-acp"],
      true,
    );
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Claude Code", "Codex", "Qwen Code", "Pi"]);
  });
});
