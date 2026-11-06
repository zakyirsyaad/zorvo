import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import type { ComposerControl } from "../lib/composer-controls";

/** The composer as the `Main` artboard draws it (lines 100–113). */
const model: ComposerControl = {
  options: [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
  ],
  selected: "opus",
  onChange: () => {},
};

const riskyMode: ComposerControl = {
  options: [
    { value: "default", label: "Ask before edits" },
    { value: "bypass", label: "Bypass permissions", risky: true },
  ],
  selected: "bypass",
  onChange: () => {},
};

function renderDock(props: Partial<Parameters<typeof ComposerDock>[0]> = {}) {
  return render(<ComposerDock onSendMessage={vi.fn()} onAttach={async () => []} {...props} />);
}

const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the composer card", () => {
  it("is a 12px-padded column with a 10px gap, on surface-2 with the pop shadow", () => {
    renderDock();
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    const card = prompt.closest("[data-composer-card]");
    expect(card).toHaveClass("flex", "flex-col", "gap-2.5", "p-3", "rounded-xl", "border", "border-border", "bg-surface-2", "shadow-popover");
    expect(prompt).toHaveAttribute("rows", "2");
    expect(prompt).toHaveClass("min-h-11", "px-1", "text-body");
    const footer = card?.closest("footer");
    expect(footer).toHaveClass("w-full", "max-w-chat");
    expect(footer).not.toHaveClass("px-4");
  });

  it("has no divider above its row, which spaces its controls 4px apart", () => {
    renderDock();
    const row = screen.getByRole("button", { name: "Add attachment" }).closest("[data-composer-row]")!;
    expect(row).toHaveClass("gap-1");
    expect(row.className).not.toContain("border-t");
    expect(row.className).not.toContain("pt-2");
  });

  it("attaches with a paperclip and sends with an arrow up", () => {
    renderDock();
    const attach = screen.getByRole("button", { name: "Add attachment" });
    expect(attach).toHaveClass("h-7", "w-7", "text-fg-muted");
    expect(attach.querySelector("svg.lucide-paperclip")).not.toBeNull();
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.querySelector("svg.lucide-arrow-up")).not.toBeNull();
    expect(send.querySelector("svg.lucide-corner-down-left")).toBeNull();
  });

  it("stops with an 11px square outline", () => {
    renderDock({ isThinking: true, onStop: () => {} });
    const square = screen.getByRole("button", { name: "Stop agent" }).querySelector("svg.lucide-square")!;
    expect(square).toHaveAttribute("width", "11");
    expect(square).not.toHaveAttribute("fill", "currentColor");
  });
});

describe("the composer's chips", () => {
  it("are 28px, borderless and quiet, with no leading icon and a 12px chevron", () => {
    renderDock({ controls: { model } });
    const chip = screen.getByRole("button", { name: "Model: Opus" });
    expect(chip).toHaveClass("h-7", "rounded-md", "px-2", "text-ui-sm", "text-fg-secondary");
    expect(chip).not.toHaveClass("border");
    expect(chip.firstElementChild?.tagName.toLowerCase()).toBe("span");
    const chevron = chip.lastElementChild!;
    expect(chevron.tagName.toLowerCase()).toBe("svg");
    expect(chevron).toHaveAttribute("width", "12");
    expect(chevron).toHaveClass("text-fg-muted");
  });

  it("fill while open", () => {
    renderDock({ controls: { model } });
    const chip = screen.getByRole("button", { name: "Model: Opus" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(chip).toHaveClass("aria-expanded:bg-surface-hover", "aria-expanded:text-fg");
  });

  it("marks a risky mode after its name", () => {
    renderDock({ controls: { permission: riskyMode } });
    const chip = screen.getByRole("button", { name: /^Permission mode:/ });
    const shield = screen.getByTestId("risky-permission-icon");
    expect(chip.contains(shield)).toBe(true);
    expect(before(screen.getByText("Bypass permissions"), shield)).toBe(true);
    expect(shield).toHaveClass("text-status-attention");
  });

  it("starts the row with the session's agent, as a label", () => {
    renderDock({ controls: { model }, sessionAgent: { profileId: "claude-acp", name: "Claude Code" } });
    const agent = screen.getByText("Claude Code").closest("[data-agent-chip]")!;
    expect(agent.tagName.toLowerCase()).not.toBe("button");
    expect(agent).toHaveClass("h-7", "gap-1.5", "px-2", "text-fg-secondary");
    expect(before(screen.getByRole("button", { name: "Add attachment" }), agent)).toBe(true);
    expect(before(agent, screen.getByRole("button", { name: "Model: Opus" }))).toBe(true);
  });

  it("words a compare run's Start, with an arrow after it", () => {
    renderDock({ sendLabel: "Start 2 sessions" });
    const start = screen.getByRole("button", { name: "Start 2 sessions" });
    expect(start).toHaveClass("h-7", "text-ui", "font-medium");
    const arrow = start.lastElementChild!;
    expect(arrow).toHaveClass("lucide-arrow-up");
    expect(arrow).toHaveAttribute("width", "12");
  });
});
