import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AgentMultiPicker } from "../components/composer/AgentMultiPicker";
import type { AgentChoice } from "../lib/composer-controls";

/** The draft's agent chip and menu, as the `NewSession` and `DraftPickers` artboards draw them. */
const choice = (value: string, name: string, extra: Partial<AgentChoice> = {}): AgentChoice => ({ value, label: name, name, ...extra });

function renderPicker(options: AgentChoice[], selected: string[], isOpen = false) {
  return render(
    <AgentMultiPicker options={options} selected={selected} isOpen={isOpen} onToggle={vi.fn()} onChange={vi.fn()} onPick={vi.fn()} />,
  );
}

describe("the draft's agent chip", () => {
  it("overlaps the ticked agents' logos and names them, then says it compares", () => {
    renderPicker([choice("claude-acp", "Claude Code"), choice("codex-acp", "Codex")], ["claude-acp", "codex-acp"]);
    const chip = screen.getByRole("button", { name: "Agent: Claude Code, Codex, compare" });
    const logos = chip.querySelector("[data-agent-logos]")!;
    expect(logos.children).toHaveLength(2);
    expect(logos.children[1]).toHaveClass("-ml-1");
    expect(within(chip).getByText("Claude Code, Codex")).toHaveClass("truncate", "min-w-0");
    expect(within(chip).getByText("· compare")).toHaveClass("text-fg-subtle", "shrink-0");
  });

  it("names one agent alone, with its logo", () => {
    renderPicker([choice("claude-acp", "Claude Code"), choice("codex-acp", "Codex")], ["claude-acp"]);
    const chip = screen.getByRole("button", { name: "Agent: Claude Code" });
    expect(chip.querySelector("[data-agent-logos]")?.children).toHaveLength(1);
    expect(within(chip).queryByText("· compare")).toBeNull();
  });

  it("truncates four long names", () => {
    const long = (n: number) => `An agent with a rather long name, number ${n}`;
    const options = [1, 2, 3, 4].map((n) => choice(`agent-${n}`, long(n)));
    renderPicker(options, options.map((option) => option.value));
    const chip = screen.getByRole("button", { name: /, compare$/ });
    expect(chip).toHaveClass("max-w-full");
    expect(within(chip).getByText([1, 2, 3, 4].map(long).join(", "))).toHaveClass("truncate");
  });
});
