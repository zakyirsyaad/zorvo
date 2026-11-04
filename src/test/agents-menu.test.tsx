import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AgentsMenu } from "../components/sidebar/AgentsMenu";
import { makeProfile } from "./fixtures/agents";
import type { SignInState } from "../lib/agent-sign-in";

const claude = makeProfile({ id: "claude-acp", name: "Claude Code", detected: true });
const qwen = makeProfile({ id: "qwen-code", name: "Qwen Code", detected: true });
const codex = makeProfile({ id: "codex-acp", name: "Codex", detected: true });
const gemini = makeProfile({ id: "gemini", name: "Gemini CLI", detected: true });
const notInstalled = makeProfile({ id: "kimi", name: "Kimi CLI", detected: false });
const all = [claude, qwen, codex, gemini, notInstalled];
const inUse = (...ids: string[]) => ({ enabledAgents: ids });

function renderMenu(states: Record<string, SignInState> = {}, extra: Partial<Parameters<typeof AgentsMenu>[0]> = {}) {
  const handlers = { onManageAgents: vi.fn(), onSetUpAgent: vi.fn() };
  render(
    <AgentsMenu
      agents={all}
      settings={inUse("claude-acp", "qwen-code", "codex-acp", "gemini", "kimi")}
      signInStateOf={(id) => states[id] ?? "ready"}
      {...handlers}
      {...extra}
    />,
  );
  return handlers;
}

describe("AgentsMenu", () => {
  it("shows up to three logos and an attention dot when an agent needs sign-in", () => {
    const { unmount } = render(
      <AgentsMenu agents={all} settings={inUse("claude-acp", "qwen-code", "codex-acp", "gemini")} onManageAgents={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: "Agents" });
    expect(within(trigger).getAllByRole("img", { hidden: true })).toHaveLength(3);
    expect(trigger.querySelector(".bg-status-attention")).toBeNull();
    unmount();

    renderMenu({ "qwen-code": "needed" });
    const needed = screen.getByRole("button", { name: "Agents, sign-in needed" });
    expect(needed.querySelector(".bg-status-attention")).toHaveAttribute("aria-hidden", "true");
  });

  it("lists the agents in use with their sign-in state", () => {
    const { onSetUpAgent } = renderMenu({ "qwen-code": "needed", "codex-acp": "unchecked" });
    fireEvent.click(screen.getByRole("button", { name: /^Agents/ }));

    const dialog = within(screen.getByRole("dialog", { name: "Agents in use" }));
    expect(dialog.getByText("Claude Code")).toBeInTheDocument();
    // Claude Code and Gemini CLI.
    expect(dialog.getAllByText("Ready")).toHaveLength(2);
    expect(dialog.queryByText("Kimi CLI")).toBeNull();
    expect(dialog.getByRole("button", { name: "Check Codex" })).toHaveTextContent("Not checked");
    fireEvent.click(dialog.getByRole("button", { name: "Sign in to Qwen Code" }));
    expect(onSetUpAgent).toHaveBeenCalledWith("qwen-code");
  });

  it("closes when you start an agent's sign-in", () => {
    renderMenu({ "qwen-code": "needed" });
    fireEvent.click(screen.getByRole("button", { name: "Agents, sign-in needed" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Qwen Code" }));
    expect(screen.queryByRole("dialog", { name: "Agents in use" })).toBeNull();
  });

  it("opens Settings → Agents from Manage agents", () => {
    const { onManageAgents } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage agents" }));
    expect(onManageAgents).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Agents in use" })).toBeNull();
  });

  it("lists only detected agents, by their own logo", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    const dialog = within(screen.getByRole("dialog", { name: "Agents in use" }));
    expect(dialog.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Claude Code"),
      expect.stringContaining("Qwen Code"),
      expect.stringContaining("Codex"),
      expect.stringContaining("Gemini CLI"),
    ]);
    // The logo itself (small SVGs are inlined by Vite), not the generic icon.
    expect(dialog.getByRole("img", { name: "Claude Code" }).tagName.toLowerCase()).toBe("img");
  });

  it("renders nothing when no agent is in use", () => {
    render(<AgentsMenu agents={[notInstalled]} settings={inUse("kimi")} onManageAgents={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Agents/ })).toBeNull();
  });
});
