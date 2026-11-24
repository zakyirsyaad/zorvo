import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import { NewSessionAbove, NewSessionBelow } from "../components/workspace/NewSessionView";
import { COMPARE_NOTE, DRAFT_COMPARE_HELPER } from "../lib/composer-state";
import type { FolderControl } from "../components/composer/FolderPicker";

/** The new-session draft as the `CalmHome` artboard draws it. */
const folder: FolderControl = {
  folders: [{ name: "agent-desktop", path: "/w/agent-desktop" }],
  selectedPath: "/w/agent-desktop",
  onSelect: vi.fn(),
  worktree: { isOn: true, onChange: vi.fn() },
  branch: { current: "main", checkedOut: "main", branches: ["main"], onOpen: vi.fn(), onPick: vi.fn() },
};

describe("the draft's column", () => {
  it("has no title of its own: the room above the card matches the room under it, so the card sits in the middle", () => {
    const { container } = render(<NewSessionAbove />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.firstElementChild).toHaveClass("flex-1", "justify-end");
  });

  it("shows the Zorvo lockup and the welcome screen's line over the card, centred, as a paragraph", () => {
    render(<NewSessionAbove />);
    const logo = screen.getByRole("img", { name: "Zorvo" });
    const line = screen.getByText("Every coding agent. One desktop.");
    expect(line.tagName).toBe("P");
    expect(logo.parentElement).toBe(line.parentElement);
    expect(logo.parentElement).toHaveClass("mx-auto", "max-w-draft", "items-center");
  });

  it("says why nothing can start right above the card, in the card's column", () => {
    render(<NewSessionAbove unavailableReason="Install an agent first." />);
    expect(screen.getByText("Install an agent first.")).toHaveClass("mx-auto", "w-full", "max-w-draft");
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

  it("draws the folder and branch chips in the card's bottom row, after attach", () => {
    render(<ComposerDock onSendMessage={() => {}} folder={folder} onAttach={async () => []} />);
    const branch = screen.getByRole("button", { name: /^Branch: main/ });
    const row = branch.closest("[data-composer-row]");
    expect(row).not.toBeNull();
    expect(row?.closest("[data-composer-card]")).not.toBeNull();
    const buttons = within(row as HTMLElement).getAllByRole("button");
    expect(buttons.indexOf(screen.getByRole("button", { name: "Add attachment" }))).toBeLessThan(buttons.indexOf(branch));
    fireEvent.click(branch);
    expect(branch).toHaveAttribute("aria-expanded", "true");
  });

  it("says how a compare run starts under the card, until one is picked", () => {
    render(<ComposerDock onSendMessage={() => {}} folder={folder} helper={DRAFT_COMPARE_HELPER} />);
    const helper = screen.getByText(DRAFT_COMPARE_HELPER);
    expect(helper).toHaveClass("text-caption", "text-fg-subtle", "mt-2");
    expect(helper.previousElementSibling).toHaveAttribute("data-composer-card");
  });
});

describe("the draft's chips", () => {
  it("are 26px, radius 6, with no fill until hovered, like the composer's own", () => {
    render(<ComposerDock onSendMessage={() => {}} folder={folder} />);
    const chip = screen.getByRole("button", { name: /^Branch: main/ });
    expect(chip).toHaveClass("h-6.5", "rounded-md", "bg-transparent", "hover:bg-surface-hover", "px-2", "text-ui-sm");
    expect(chip.className).not.toContain("surface-1");
    expect(within(chip).getByText("main")).toHaveClass("font-mono", "text-caption");
    expect(within(chip).getByText(/new worktree/)).toHaveClass("text-fg-subtle");
    // The chip sits in the card's bottom row.
    expect(chip.closest("[data-composer-row]")).not.toBeNull();
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
