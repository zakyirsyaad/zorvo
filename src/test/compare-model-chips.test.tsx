import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import type { CompareModelControl } from "../lib/compare-models";

/** A compare draft's composer row: one model chip per agent, each with its logo. */
const opus: CompareModelControl = {
  profileId: "claude-acp",
  name: "Claude Code",
  state: "known",
  control: { options: [{ value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }], selected: "opus", onChange: vi.fn() },
};
const codex = (state: CompareModelControl["state"]): CompareModelControl => ({ profileId: "codex", name: "Codex", state });

function renderDock(compareModels: CompareModelControl[], onOpenCompareModel = vi.fn()) {
  render(
    <ComposerDock
      onSendMessage={() => {}}
      onAttach={async () => []}
      compareModels={compareModels}
      onOpenCompareModel={onOpenCompareModel}
    />,
  );
  return onOpenCompareModel;
}

const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("a compare draft's model chips", () => {
  it("shows one chip per agent, each with its logo, after attach", () => {
    renderDock([opus, codex("unknown")]);
    const claude = screen.getByRole("button", { name: "Claude Code model: Opus" });
    const codexChip = screen.getByRole("button", { name: "Codex model: Default" });
    for (const chip of [claude, codexChip]) {
      expect(chip.querySelector("[aria-hidden='true']")).not.toBeNull();
      expect(follows(screen.getByRole("button", { name: "Add attachment" }), chip)).toBe(true);
    }
  });

  it("asks an unknown agent when its chip opens, and shows the skeleton", () => {
    const onOpen = renderDock([opus, codex("unknown")]);
    const chip = screen.getByRole("button", { name: "Codex model: Default" });
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith("codex");
    expect(screen.getByText("Asking Codex for its models…")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-skeleton-row]")).toHaveLength(3);
    expect(chip.closest("div.relative")!.querySelector("[role=listbox]")).toHaveClass("top-full");
  });

  it("offers Try again when asking failed", () => {
    const onOpen = renderDock([codex("failed")]);
    fireEvent.click(screen.getByRole("button", { name: "Codex model: Default" }));
    expect(screen.getByText("Could not ask Codex for its models.")).toBeInTheDocument();
    onOpen.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onOpen).toHaveBeenCalledWith("codex");
  });

  it("asks nothing when a known chip opens", () => {
    const onOpen = renderDock([opus]);
    fireEvent.click(screen.getByRole("button", { name: "Claude Code model: Opus" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Opus" })).toBeInTheDocument();
  });

  it("searches a long list like the single draft's", () => {
    const many: CompareModelControl = {
      ...opus,
      control: {
        options: Array.from({ length: 12 }, (_, n) => ({ value: `m${n}`, label: `Model ${n}` })),
        selected: "m0",
        onChange: vi.fn(),
      },
    };
    renderDock([many]);
    fireEvent.click(screen.getByRole("button", { name: "Claude Code model: Model 0" }));
    expect(screen.getByRole("searchbox", { name: "Search claude code model" })).toBeInTheDocument();
  });
});
