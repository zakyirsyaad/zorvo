import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FailedTurnBanner } from "../components/FailedTurnBanner";
import { WorkingIndicator } from "../components/chat/ReplyExtras";
import { AgentStallNotice } from "../components/chat/AgentStallNotice";

describe("the failed turn, as drawn", () => {
  it("is one danger row: the icon, the words in fg, and Try again on the right before Details and Dismiss", () => {
    render(
      <FailedTurnBanner
        agentName="Claude Code"
        error="Request timed out\nat line 1"
        isBusy={false}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    const row = alert.firstElementChild as HTMLElement;
    expect(row).toHaveClass("flex", "items-center", "gap-2.5");
    expect(alert).toHaveClass("px-3", "py-2.5", "rounded-lg", "border-danger", "bg-danger-surface");
    expect(row.querySelector(".lucide-circle-alert")?.getAttribute("class")).toContain("text-danger");
    expect(row.querySelector("p")).toHaveClass("text-ui", "text-fg");
    const tryAgain = within(row).getByRole("button", { name: "Try again" });
    expect(tryAgain).toHaveClass("h-7", "border-border-strong");
    expect(within(tryAgain).getByText("Try again")).toHaveClass("text-fg");
    const names = within(row).getAllByRole("button").map((button) => button.textContent || button.getAttribute("aria-label"));
    expect(names[0]).toBe("Try again");
    expect(names.at(-1)).toBe("Dismiss notice");
  });
});

describe("the working line, as drawn", () => {
  it("is a ringed 6px dot, the words in fg-secondary and the time in fg-subtle", () => {
    render(<WorkingIndicator agentName="Claude Code" since={Date.now() - 72_000} />);
    const line = screen.getByTestId("agent-working");
    const dot = line.querySelector("[data-working-dot]") as HTMLElement;
    expect(dot).toHaveClass("size-1.5", "rounded-full", "bg-status-running", "ring-4", "ring-status-running/20");
    expect(dot.parentElement).toHaveClass("gap-2.5");
    expect(within(line).getByText("Claude Code is working")).toHaveClass("text-ui", "text-fg-secondary");
    const time = within(line).getByText("1m 12s");
    expect(time).toHaveClass("text-caption", "text-fg-subtle", "tabular-nums");
    expect(time).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the stall notice, as drawn", () => {
  it("leads with a clock in attention, reads in fg-secondary, and offers a 24px Stop with a square", () => {
    render(
      <AgentStallNotice
        agentName="Qwen Code"
        messages={[]}
        failures={{ count: 3, source: "qwen-lifecycle" }}
        onStop={vi.fn()}
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveClass("flex", "items-center", "gap-2.5", "px-3", "py-2.5", "rounded-lg", "border-border", "bg-surface-1");
    expect(notice.querySelector(".lucide-clock")?.getAttribute("class")).toContain("text-status-attention");
    expect(notice.querySelector("span")).toHaveClass("text-ui", "text-fg-secondary");
    const stop = within(notice).getByRole("button", { name: "Stop" });
    expect(stop).toHaveClass("h-6");
    expect(stop.querySelector(".lucide-square")).not.toBeNull();
  });
});
