import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AgentSessionList } from "../components/workspace/AgentSessionList";

/** The draft's list of the agent's sessions, as the `NewSession` artboard draws it (lines 48–53). */
function renderLoaded() {
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  render(
    <AgentSessionList
      agentName="Claude Code"
      state={{
        kind: "loaded",
        sessions: [
          { acpSessionId: "a", title: "Refactor the composer dock", updatedAt: yesterday },
          { acpSessionId: "b", title: "Fix flaky worktree test" },
          { acpSessionId: "c", title: "Draft release notes for 0.8.0" },
        ],
        truncated: false,
        incomplete: false,
      }}
      importError={null}
      onLoad={vi.fn()}
      onImport={vi.fn()}
    />,
  );
}

describe("the agent's sessions", () => {
  it("are headed by whose they are and how many there are", () => {
    renderLoaded();
    const title = screen.getByText("Continue a session from Claude Code");
    expect(title).toHaveClass("flex-1", "text-caption", "font-medium", "text-fg-muted");
    const count = screen.getByText("3 in this folder");
    expect(count).toHaveClass("text-caption", "text-fg-subtle");
    expect(title.parentElement).toHaveClass("px-3", "pb-1.5");
  });

  it("are plain 44px rows, in a 4px-spaced list", () => {
    renderLoaded();
    const row = screen.getByRole("button", { name: /Refactor the composer dock/ });
    expect(row).toHaveClass(
      "group",
      "flex",
      "h-11",
      "items-center",
      "gap-3",
      "rounded-lg",
      "px-3",
      "text-ui",
      "text-fg-secondary",
      "hover:bg-surface-hover",
      "hover:text-fg",
      "focus-ring",
    );
    expect(row.closest("ul")).toHaveClass("flex", "flex-col", "gap-1");
    const time = within(row).getByText(/ago|yesterday|1d/i);
    expect(time).toHaveClass("text-caption", "text-fg-subtle", "group-hover:text-fg-muted");
  });

  it("Continue shows on focus and is not read twice", () => {
    renderLoaded();
    const row = screen.getByRole("button", { name: /Refactor the composer dock/ });
    const label = within(row).getByText("Continue");
    expect(label).toHaveAttribute("aria-hidden", "true");
    expect(label).toHaveClass(
      "hidden",
      "group-hover:inline-flex",
      "group-focus-visible:inline-flex",
      "h-6.5",
      "rounded-md",
      "border",
      "border-border-strong",
      "px-2.5",
      "text-ui-sm",
      "text-fg",
    );
    expect(row).not.toHaveAccessibleName(/Continue/);
  });
});
