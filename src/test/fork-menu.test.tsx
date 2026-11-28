import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageActionBar } from "../components/MessageActionBar";
import type { SwitchTarget } from "../lib/agent-switch";

const row = (id: string, name: string, over: Partial<SwitchTarget> = {}): SwitchTarget => ({
  id,
  name,
  isSource: false,
  status: "ready",
  word: "Ready",
  isDisabled: false,
  ...over,
});

const AGENTS: SwitchTarget[] = [
  row("qwen-code", "Qwen Code", { isSource: true, word: "This session" }),
  row("claude-acp", "Claude Code"),
  row("kimi", "Kimi CLI", { status: "not-installed", word: "Not installed", isDisabled: true }),
];

function renderBar(agents: SwitchTarget[], onFork = vi.fn()) {
  render(<MessageActionBar copied={false} onCopy={vi.fn()} fork={{ agents, onFork }} />);
  return onFork;
}

const forkButton = () => screen.getByRole("button", { name: "Fork from here" });

describe("the Fork menu", () => {
  it("with other agents the Fork button opens a menu whose first item is focused", () => {
    renderBar(AGENTS);

    fireEvent.click(forkButton());

    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Fork with Qwen Code", "Claude CodeReady", "Kimi CLINot installed"]);
    expect(screen.getByText("Continue with another agent")).toBeInTheDocument();
    expect(items[0]).toHaveFocus();
  });

  it("the first item forks with the same agent", () => {
    const onFork = renderBar(AGENTS);

    fireEvent.click(forkButton());
    fireEvent.click(screen.getByRole("menuitem", { name: /Fork with Qwen Code/ }));

    expect(onFork).toHaveBeenCalledWith();
  });

  it("another agent's row forks with that agent", () => {
    const onFork = renderBar(AGENTS);

    fireEvent.click(forkButton());
    fireEvent.click(screen.getByRole("menuitem", { name: /Claude Code/ }));

    expect(onFork).toHaveBeenCalledWith("claude-acp");
  });

  it("a Not installed row is disabled", () => {
    const onFork = renderBar(AGENTS);

    fireEvent.click(forkButton());
    const kimi = screen.getByRole("menuitem", { name: /Kimi CLI/ });
    fireEvent.click(kimi);

    expect(kimi).toBeDisabled();
    expect(onFork).not.toHaveBeenCalled();
  });

  it("Escape closes and returns focus to the Fork button", () => {
    renderBar(AGENTS);

    fireEvent.click(forkButton());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(forkButton()).toHaveFocus();
  });

  it("arrow keys move between the rows that can be picked", () => {
    renderBar(AGENTS);

    fireEvent.click(forkButton());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });

    expect(screen.getByRole("menuitem", { name: /Claude Code/ })).toHaveFocus();
  });

  it("with no other agents the button forks at once", () => {
    const onFork = renderBar([AGENTS[0]]);

    fireEvent.click(forkButton());

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onFork).toHaveBeenCalledWith();
  });
});
