import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentTile } from "../components/ui/AgentTile";

describe("AgentTile", () => {
  it("draws the agent's logo in a 22px tile by default", () => {
    render(<AgentTile profileId="claude-acp" name="Claude Code" />);
    const logo = screen.getByRole("img", { name: "Claude Code" });
    expect(logo.parentElement).toHaveClass("size-[22px]", "rounded-md", "bg-chip", "ring-1", "ring-inset", "ring-border");
    expect(logo).toHaveAttribute("width", "14");
  });

  it.each([
    [16, "size-4", "rounded"],
    [28, "size-7", "rounded-lg"],
  ] as const)("sizes the %ipx tile", (size, box, radius) => {
    const { container } = render(<AgentTile profileId="claude-acp" name="" size={size} />);
    expect(container.firstElementChild).toHaveClass(box, radius);
  });

  it("puts a badge on the corner with a ring in the color behind it", () => {
    const { container } = render(<AgentTile profileId="claude-acp" name="" badge="attention" badgeOn="hover" />);
    const badge = container.querySelector("[data-badge]");
    expect(badge).toHaveClass("size-2", "rounded-full", "bg-status-attention", "ring-2", "ring-surface-hover");
    expect(badge).toHaveAttribute("aria-hidden", "true");
  });

  it("shows no badge when none is asked for", () => {
    const { container } = render(<AgentTile profileId="claude-acp" name="" />);
    expect(container.querySelector("[data-badge]")).toBeNull();
  });

  it("holds an icon in place of a logo", () => {
    render(
      <AgentTile>
        <svg data-testid="icon" />
      </AgentTile>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});
