import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ComposerDock, SLOW_LOAD_MS } from "../components/ComposerDock";
import type { ComposerControl } from "../lib/composer-controls";

/**
 * While a draft asks its agent what it offers, the chips it will get show as skeletons in the row, where they
 * will land, instead of a line of text under the prompt. Not drawn on the canvas; asked for on 2026-11-06.
 * A load that lasts gets a line under the card after all (2026-11-13): an agent slow to start can take
 * minutes, and the skeletons alone looked stuck.
 */
const model: ComposerControl = { options: [{ value: "opus", label: "Opus" }], selected: "opus", onChange: () => {} };

function renderDock(props: Partial<Parameters<typeof ComposerDock>[0]> = {}) {
  return render(<ComposerDock onSendMessage={vi.fn()} onAttach={async () => []} agentName="Claude Agent" {...props} />);
}

const skeletons = () => [...document.querySelectorAll("[data-skeleton-chip]")];

describe("the composer while the agent's options load", () => {
  it("shows three pulsing skeleton chips in the row, after attach", () => {
    renderDock({ isLoadingControls: true });
    const chips = skeletons();
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip).toHaveAttribute("aria-hidden", "true");
      expect(chip).toHaveClass("h-6.5", "rounded-md", "bg-chip", "motion-safe:animate-pulse");
    }
    expect(chips.map((chip) => [...chip.classList].find((name) => /^w-\d+$/.test(name)))).toEqual(["w-18", "w-24", "w-14"]);
    const attach = screen.getByRole("button", { name: "Add attachment" });
    expect(attach.compareDocumentPosition(chips[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chips[0].closest("[data-composer-row]")).not.toBeNull();
  });

  it("says what is loading to a screen reader, without a visible line under the prompt", () => {
    renderDock({ isLoadingControls: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading Claude Agent's models and commands…");
    expect(status).toHaveClass("sr-only");
  });

  it("says so in words once the chips have loaded for a while, and stops when they arrive", () => {
    vi.useFakeTimers();
    try {
      const view = renderDock({ isLoadingControls: true });
      const line = () => document.querySelector("[data-slow-load]");
      expect(line()).toBeNull();
      act(() => vi.advanceTimersByTime(SLOW_LOAD_MS - 1));
      expect(line()).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(line()).toHaveTextContent("Still loading Claude Agent's models and commands…");
      // Under the card, quiet, and not read twice: the status said it when the load began.
      expect(line()).toHaveClass("text-caption", "text-fg-subtle");
      expect(line()).toHaveAttribute("aria-hidden", "true");
      expect(line()?.closest("[data-composer-row]")).toBeNull();

      view.rerender(<ComposerDock onSendMessage={vi.fn()} onAttach={async () => []} agentName="Claude Agent" />);
      expect(line()).toBeNull();
      // A new load waits its own time again.
      view.rerender(<ComposerDock onSendMessage={vi.fn()} onAttach={async () => []} agentName="Claude Agent" isLoadingControls />);
      expect(line()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws no skeleton once the agent's chips are known, and says nothing is loading", () => {
    // A sign-in re-check also probes, while the chips are already there: nothing is loading then.
    renderDock({ isLoadingControls: true, controls: { model } });
    expect(skeletons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Model: Opus" })).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("draws nothing when nothing loads, but keeps its empty status mounted", () => {
    renderDock();
    expect(skeletons()).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("announces through the region that was already there, not a new one", () => {
    // A live region inserted with its text is often not read out; one already mounted is.
    const view = renderDock();
    const before = screen.getByRole("status");
    view.rerender(<ComposerDock onSendMessage={vi.fn()} onAttach={async () => []} agentName="Claude Agent" isLoadingControls />);
    const after = screen.getByRole("status");
    expect(after).toBe(before);
    expect(after).toHaveTextContent("Loading Claude Agent's models and commands…");
  });
});
