import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  it("heads the 720px column 64px down, left-aligned, at 20/28 600, with a place for the chips beside it", () => {
    render(<NewSessionHeading />);
    const heading = screen.getByRole("heading", { name: "New session" });
    expect(heading).toHaveClass("text-xl", "font-semibold", "tracking-[-0.02em]", "flex-1", "min-w-[200px]");
    // The title's row wraps, so the chips go under it in a narrow window.
    const row = heading.parentElement!;
    expect(row).toHaveClass("flex", "flex-wrap", "items-center", "gap-2");
    expect(heading.nextElementSibling).toHaveAttribute("data-draft-chips-slot");
    // As the artboard nests it: the 24px gutter outside the 720px column, so the heading lines up with the
    // tiles, the card and the session list, whose gutters are outside their columns too.
    const column = row.parentElement!;
    expect(column).toHaveClass("mx-auto", "w-full", "max-w-draft");
    expect(column).not.toHaveClass("px-6");
    const gutter = column.parentElement!;
    expect(gutter).toHaveClass("px-6", "pt-16", "pb-5");
    expect(gutter).not.toHaveClass("flex-1");
    expect(gutter).not.toHaveClass("items-center");
  });

  it("puts the agent's sessions 32px under the composer, in the same column", () => {
    render(<NewSessionBelow sessionList={<p>sessions</p>} />);
    const inner = screen.getByText("sessions").parentElement!;
    expect(inner).toHaveClass("mx-auto", "w-full", "max-w-draft", "mt-8");
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

  it("draws the composer's chips in the heading's slot when it is given one, and above the card when not", () => {
    function Draft() {
      const [slot, setSlot] = useState<HTMLDivElement | null>(null);
      return (
        <>
          <NewSessionHeading chipsSlot={setSlot} />
          <ComposerDock onSendMessage={() => {}} folder={folder} chipsTarget={slot} />
        </>
      );
    }
    const { unmount } = render(<Draft />);
    const inHeading = screen.getByRole("button", { name: /^Branch: main/ });
    expect(inHeading.closest("[data-draft-chips-slot]")).not.toBeNull();
    // Its menu still opens: a click in the slot is not a click outside the composer.
    fireEvent.click(inHeading);
    fireEvent.mouseDown(inHeading);
    expect(inHeading).toHaveAttribute("aria-expanded", "true");
    unmount();

    render(<ComposerDock onSendMessage={() => {}} folder={folder} />);
    expect(screen.getByRole("button", { name: /^Branch: main/ }).closest("[data-draft-chips]")).toHaveClass("mb-4", "flex-wrap");
  });
});

describe("the draft's chips", () => {
  it("are 26px, radius 6, filled with chip, like the composer's own", () => {
    render(<ComposerDock onSendMessage={() => {}} folder={folder} />);
    const chip = screen.getByRole("button", { name: /^Branch: main/ });
    expect(chip).toHaveClass("h-6.5", "rounded-md", "bg-chip", "px-2", "text-ui-sm");
    expect(chip.className).not.toContain("surface-1");
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

  it("sits under the card, in subtle 11px", () => {
    render(<ComposerDock onSendMessage={() => {}} note={COMPARE_NOTE} noteInRow onAttach={async () => []} />);
    const note = screen.getByText(COMPARE_NOTE);
    expect(note).toHaveClass("text-caption", "text-fg-subtle", "px-1", "mt-2");
    expect(note.closest("[data-composer-card]")).toBeNull();
    expect(note.previousElementSibling).toHaveAttribute("data-composer-card");
  });

  it("leaves any other note under the prompt", () => {
    render(<ComposerDock onSendMessage={() => {}} note="Loading Codex's models and commands…" />);
    expect(screen.getByText("Loading Codex's models and commands…").closest("[data-composer-row]")).toBeNull();
  });
});
