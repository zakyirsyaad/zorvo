import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import { NewSessionBelow, NewSessionHeading } from "../components/workspace/NewSessionView";
import { COMPARE_NOTE } from "../lib/composer-state";
import type { FolderControl } from "../components/composer/FolderPicker";

/** The new-session draft as the `NewSession` artboard draws it. */
const folder: FolderControl = {
  folders: [{ name: "agent-desktop", path: "/w/agent-desktop" }],
  selectedPath: "/w/agent-desktop",
  onSelect: vi.fn(),
  worktree: { isOn: true, onChange: vi.fn() },
  branch: { current: "main", checkedOut: "main", branches: ["main"], onOpen: vi.fn(), onPick: vi.fn() },
};

describe("the draft's column", () => {
  it("heads the 680px column from 120px down in a short window, lower in a tall one, left-aligned, at 20/28 600", () => {
    render(<NewSessionHeading workspace={{ name: "agent-desktop", path: "/w/agent-desktop" }} />);
    const heading = screen.getByRole("heading", { name: "New session in agent-desktop" });
    expect(heading).toHaveClass("text-xl", "font-semibold", "tracking-[-0.02em]");
    // As the artboard nests it: the 24px gutter outside the 680px column, so the heading lines up with the
    // chips, the card and the session list, whose gutters are outside their columns too.
    const column = heading.parentElement!;
    expect(column).toHaveClass("mx-auto", "w-full", "max-w-chat");
    expect(column).not.toHaveClass("px-6");
    const gutter = column.parentElement!;
    expect(gutter).toHaveClass("px-6", "pt-[clamp(120px,24vh,260px)]", "pb-4");
    expect(gutter).not.toHaveClass("flex-1");
    expect(gutter).not.toHaveClass("items-center");
  });

  it("puts the agent's sessions 24px under the composer, in the same column", () => {
    render(<NewSessionBelow sessionList={<p>sessions</p>} />);
    const inner = screen.getByText("sessions").parentElement!;
    expect(inner).toHaveClass("mx-auto", "w-full", "max-w-chat", "mt-6");
    expect(inner.parentElement).toHaveClass("flex-1", "px-6");
  });

  it("scrolls a long list of sessions inside itself, so the composer above it stays put", () => {
    // At least 160px of it stays, so in a short window the column scrolls to it instead of hiding it.
    render(<NewSessionBelow sessionList={<p>sessions</p>} />);
    const list = screen.getByText("sessions").parentElement!.parentElement!;
    expect(list).toHaveClass("overflow-y-auto", "min-h-40");
    expect(list).not.toHaveClass("min-h-0");
  });

  it("lets the empty space under a draft with no sessions shrink away", () => {
    const { container } = render(<NewSessionBelow />);
    expect(container.firstElementChild).toHaveClass("flex-1", "min-h-0");
    expect(container.firstElementChild).not.toHaveClass("min-h-40");
  });

  it("wraps a long folder name in the heading instead of widening the column", () => {
    render(<NewSessionHeading workspace={{ name: "a".repeat(120), path: "/w/long" }} />);
    expect(screen.getByRole("heading")).toHaveClass("break-words");
  });
});

describe("the draft's chips", () => {
  it("are 28px, radius 8, on surface-1, 8px apart and 16px above the card", () => {
    render(<ComposerDock onSendMessage={() => {}} folder={folder} />);
    const chip = screen.getByRole("button", { name: /^Branch: main/ });
    expect(chip).toHaveClass("h-7", "rounded-lg", "border", "border-border", "bg-surface-1", "px-2.5", "text-ui-sm");
    expect(within(chip).getByText("main")).toHaveClass("font-mono", "text-caption");
    expect(within(chip).getByText(/new worktree/)).toHaveClass("text-fg-subtle");
    // The chip sits in its popover's wrapper; the chips row is around that.
    expect(chip.closest(".flex-wrap")).toHaveClass("gap-2", "mb-4");
  });
});

describe("the compare note", () => {
  it("reads as drawn", () => {
    expect(COMPARE_NOTE).toBe("Each agent starts in its safest mode, in its own worktree.");
  });

  it("sits in the control row, in subtle 11px", () => {
    render(<ComposerDock onSendMessage={() => {}} note={COMPARE_NOTE} noteInRow onAttach={async () => []} />);
    const note = screen.getByText(COMPARE_NOTE);
    expect(note).toHaveClass("text-caption", "text-fg-subtle", "pl-1");
    expect(note.closest("[data-composer-row]")).not.toBeNull();
  });

  it("leaves any other note under the prompt", () => {
    render(<ComposerDock onSendMessage={() => {}} note="Loading Codex's models and commands…" />);
    expect(screen.getByText("Loading Codex's models and commands…").closest("[data-composer-row]")).toBeNull();
  });
});
