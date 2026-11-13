import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AgentTiles } from "../components/composer/AgentTiles";
import { shownTiles } from "../lib/agent-tiles";
import type { AgentChoice } from "../lib/composer-controls";

/** The draft's agent tiles, as the `Home` artboard draws them. */
const choice = (value: string, name: string, extra: Partial<AgentChoice> = {}): AgentChoice => ({ value, label: name, name, ...extra });

const SIX = ["a", "b", "c", "d", "e", "f"].map((id) => ({ value: id }));
const ids = (tiles: readonly { value: string }[]) => tiles.map((tile) => tile.value).join("");

describe("shownTiles", () => {
  it("shows the first four agents in use, in their order", () => {
    expect(ids(shownTiles(SIX, ["a"]))).toBe("abcd");
    expect(ids(shownTiles(SIX.slice(0, 2), ["a"]))).toBe("ab");
    expect(ids(shownTiles([], []))).toBe("");
  });

  it("gives a chosen agent outside the four the place of the last tile that is not chosen", () => {
    expect(ids(shownTiles(SIX, ["e"]))).toBe("abce");
    expect(ids(shownTiles(SIX, ["a", "f"]))).toBe("abcf");
    // d is chosen, so c gives way.
    expect(ids(shownTiles(SIX, ["d", "e"]))).toBe("abed");
  });

  it("places several chosen agents from outside, each on a tile that is not chosen", () => {
    // e takes d's place, then f takes c's.
    expect(ids(shownTiles(SIX, ["a", "e", "f"]))).toBe("abfe");
  });

  it("changes nothing when all four tiles are chosen", () => {
    expect(ids(shownTiles(SIX, ["a", "b", "c", "d"]))).toBe("abcd");
  });
});

const OPTIONS: AgentChoice[] = [
  choice("claude-acp", "Claude Code", { signIn: "ready" }),
  choice("codex-acp", "Codex", { signIn: "ready" }),
  choice("gemini", "Gemini CLI", { signIn: "unchecked" }),
  choice("qwen-code", "Qwen Code", { signIn: "needed", blockedBy: "sign-in", disabledReason: "You need to sign in first." }),
  choice("pi", "Pi", { blockedBy: "install", disabledReason: "You need to install it first." }),
];

function renderTiles(selected: string[], extra: Partial<Parameters<typeof AgentTiles>[0]> = {}) {
  const onChange = vi.fn();
  const onPick = vi.fn();
  render(
    <AgentTiles options={OPTIONS} selected={selected} canTick isOpen={false} onToggle={vi.fn()} onChange={onChange} onPick={onPick} {...extra} />,
  );
  return { onChange, onPick };
}

const tile = (name: string | RegExp) => within(screen.getByRole("region", { name: "Agents" })).getByRole("button", { name });

describe("the draft's agent tiles", () => {
  it("heads the row Agents with the hint and All agents at the right", () => {
    renderTiles(["claude-acp"]);
    const row = screen.getByRole("region", { name: "Agents" });
    expect(within(row).getByRole("heading", { name: "Agents" })).toHaveClass("text-ui-sm", "font-medium", "text-fg-secondary");
    expect(within(row).getByText("Tick two or more to compare them.")).toHaveClass("text-caption", "text-fg-subtle");
    expect(within(row).getByRole("button", { name: "All agents" })).toBeInTheDocument();
  });

  it("draws four tiles, the fifth agent only under All agents", () => {
    renderTiles(["claude-acp"]);
    expect(document.querySelectorAll("[data-agent-tile]")).toHaveLength(4);
    expect(document.querySelector('[data-agent-tile="pi"]')).toBeNull();
  });

  it("draws a ticked tile filled with a strong edge, its name at 500 and a check", () => {
    renderTiles(["claude-acp"]);
    const ticked = tile("Claude Code");
    expect(ticked).toHaveAttribute("aria-pressed", "true");
    expect(ticked).toHaveClass("min-h-12", "rounded-panel", "border-border-strong", "bg-surface-2", "text-fg", "px-3", "py-2", "gap-2.5");
    expect(ticked.firstElementChild).toHaveClass("size-[22px]", "bg-chip");
    expect(within(ticked).getByText("Claude Code")).toHaveClass("font-medium");
    expect(ticked.querySelector("svg.lucide-check")).not.toBeNull();
    expect(ticked).toHaveAccessibleDescription("Ready");
    expect(within(ticked).getByText("Ready").previousElementSibling).toHaveClass("size-1.5", "bg-status-running");

    const idle = tile("Codex");
    expect(idle).toHaveAttribute("aria-pressed", "false");
    expect(idle).toHaveClass("border-border", "text-fg-secondary");
    expect(idle.querySelector("svg.lucide-check")).toBeNull();
  });

  it("says Not checked without a dot", () => {
    renderTiles(["claude-acp"]);
    const word = within(tile("Gemini CLI")).getByText("Not checked");
    expect(word.parentElement).toHaveClass("text-fg-subtle");
    expect(word.previousElementSibling).toBeNull();
  });

  it("ticks and unticks through the same call the list makes", () => {
    const { onChange, onPick } = renderTiles(["claude-acp"]);
    fireEvent.click(tile("Codex"));
    expect(onChange).toHaveBeenCalledWith("codex-acp");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names a blocked tile by what it needs, never ticks it, and picks it alone", () => {
    const { onChange, onPick } = renderTiles(["claude-acp"]);
    const blocked = tile("Qwen Code, sign in first");
    expect(blocked).not.toHaveAttribute("aria-pressed");
    expect(blocked.querySelector("svg.lucide-chevron-right")).not.toBeNull();
    expect(within(blocked).getByText("Sign in").previousElementSibling).toHaveClass("bg-status-attention");
    fireEvent.click(blocked);
    expect(onPick).toHaveBeenCalledWith("qwen-code");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picks alone while the only chosen agent is blocked, since its own card comes first", () => {
    const { onChange, onPick } = renderTiles(["qwen-code"]);
    fireEvent.click(tile("Codex"));
    expect(onPick).toHaveBeenCalledWith("codex-acp");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("holds all four tiles with the chosen agents once the run is full, so no tile is left to over-tick", () => {
    const six = [
      ...OPTIONS.slice(0, 3),
      choice("kimi", "Kimi CLI", { signIn: "ready" }),
      choice("glm", "GLM Agent", { signIn: "ready" }),
      choice("opencode", "OpenCode", { signIn: "ready" }),
    ];
    renderTiles(["claude-acp", "codex-acp", "gemini", "opencode"], { options: six });
    expect(document.querySelectorAll("[data-agent-tile]")).toHaveLength(4);
    expect(document.querySelectorAll('[data-agent-tile][aria-pressed="true"]')).toHaveLength(4);
    // Kimi CLI, not chosen, gave its tile to OpenCode; the list still offers it and says the limit.
    expect(document.querySelector('[data-agent-tile="kimi"]')).toBeNull();
  });

  it("where nothing can be ticked, a press picks that agent and there is no hint", () => {
    const { onChange, onPick } = renderTiles(["claude-acp"], { canTick: false });
    expect(screen.queryByText("Tick two or more to compare them.")).toBeNull();
    expect(tile("Claude Code")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tile("Codex"));
    expect(onPick).toHaveBeenCalledWith("codex-acp");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a chosen agent from outside the first four on a tile", () => {
    renderTiles(["pi"], { options: OPTIONS.map((option) => (option.value === "pi" ? choice("pi", "Pi", { signIn: "ready" }) : option)) });
    expect(tile("Pi")).toHaveAttribute("aria-pressed", "true");
    // Qwen Code, the last tile not chosen, gave way.
    expect(document.querySelector('[data-agent-tile="qwen-code"]')).toBeNull();
  });
});
