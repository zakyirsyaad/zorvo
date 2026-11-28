import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AgentsMenu } from "../components/sidebar/AgentsMenu";
import { makeProfile } from "./fixtures/agents";
import type { SignInState } from "../lib/agent-sign-in";
import type { SettingsSignIn } from "../hooks/useSettingsSignIn";

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

  it("stacks 16px tiles overlapping by 4px, each on an opaque backing", () => {
    render(
      <AgentsMenu agents={all} settings={inUse("claude-acp", "qwen-code", "codex-acp", "gemini")} onManageAgents={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: "Agents" });
    const tiles = trigger.querySelectorAll(".size-4.bg-chip");
    expect(tiles).toHaveLength(3);
    // Each tile sits on an opaque backing in the sidebar's color with a 2px ring of it, so the
    // translucent tiles never show through each other.
    for (const tile of tiles) expect(tile.parentElement).toHaveClass("bg-ground", "ring-2", "ring-ground");
    expect(tiles[0].parentElement?.parentElement).toHaveClass("-space-x-1");
  });

  it("draws each agent's row 28px high with a 16px tile, and a dot only for Ready and Sign in", () => {
    renderMenu({ "qwen-code": "needed", "codex-acp": "unchecked" });
    fireEvent.click(screen.getByRole("button", { name: /^Agents/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Agents in use" }));
    const rows = dialog.getAllByRole("listitem");
    for (const row of rows) {
      expect(row.firstElementChild).toHaveClass("h-7");
      expect(row.querySelector(".size-4.bg-chip")).not.toBeNull();
    }
    const [claudeRow, qwenRow, codexRow] = rows;
    expect(claudeRow.querySelector(".size-1\\.5.bg-status-running")).not.toBeNull();
    expect(qwenRow.querySelector(".size-1\\.5.bg-status-attention")).not.toBeNull();
    expect(qwenRow.querySelector("button")).toHaveTextContent(/^Sign in$/);
    expect(codexRow.querySelector(".size-1\\.5")).toBeNull();
  });

  it("lists the agents in use with their sign-in state", () => {
    const { onSetUpAgent } = renderMenu({ "qwen-code": "needed", "codex-acp": "unchecked" });
    fireEvent.click(screen.getByRole("button", { name: /^Agents/ }));

    const dialog = within(screen.getByRole("dialog", { name: "Agents in use" }));
    expect(dialog.getByText("Claude Code")).toBeInTheDocument();
    // Claude Code and Gemini CLI.
    expect(dialog.getAllByText("Ready")).toHaveLength(2);
    expect(dialog.queryByText("Kimi CLI")).toBeNull();
    expect(dialog.getByText("Not checked yet")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Check Codex" })).toHaveTextContent(/^Check$/);
    expect(dialog.getByText("Needs sign-in")).toBeInTheDocument();
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

  it("opens across the sidebar's footer, never from the button's right edge", () => {
    render(
      <div data-testid="footer-box" className="relative">
        <AgentsMenu agents={all} settings={inUse("claude-acp", "qwen-code")} onManageAgents={vi.fn()} />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Agents" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Agents in use" });
    expect(dialog).toHaveClass("left-2", "right-2");
    expect(dialog.className).not.toMatch(/(^|\s)right-0(\s|$)/);
    // Anchored to the footer's box, so the sidebar's edge cannot cut it off.
    expect(dialog.parentElement?.closest(".relative")).toBe(screen.getByTestId("footer-box"));
    expect(trigger).toHaveClass("aria-expanded:bg-surface-hover");
  });

  it("draws each state as the canvas does", () => {
    renderMenu({ "qwen-code": "needed", "codex-acp": "unchecked" });
    fireEvent.click(screen.getByRole("button", { name: /^Agents/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Agents in use" }));

    // Ready: muted words, only the dot is green.
    const ready = dialog.getAllByText("Ready")[0];
    expect(ready).toHaveClass("text-fg-muted");
    expect(ready.querySelector(".bg-status-running")).not.toBeNull();

    // Needs sign-in: an outline Sign in button on a filled row.
    const signIn = dialog.getByRole("button", { name: "Sign in to Qwen Code" });
    expect(signIn).toHaveTextContent(/^Sign in$/);
    expect(signIn).toHaveClass("h-6", "border-border-strong");
    expect(signIn.closest("li")).toHaveClass("bg-surface-hover");

    // Not checked yet: subtle words, no dot, and a Check text button.
    const words = dialog.getByText("Not checked yet");
    expect(words).toHaveClass("text-fg-subtle");
    expect(words.querySelector("[class*='bg-']")).toBeNull();
    expect(dialog.getByRole("button", { name: "Check Codex" })).toHaveTextContent(/^Check$/);

    expect(dialog.getByRole("button", { name: "Manage agents" }).querySelector(".lucide-settings-2")).not.toBeNull();
  });

  it("renders nothing when no agent is in use", () => {
    render(<AgentsMenu agents={[notInstalled]} settings={inUse("kimi")} onManageAgents={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Agents/ })).toBeNull();
  });
});

describe("signing in from the Agents menu", () => {
  const login = { id: "qwen-login", name: "Qwen OAuth", kind: "terminal" } as const;

  function fakeSignIn(overrides: Partial<SettingsSignIn> = {}): SettingsSignIn {
    return {
      cwd: "/Users/test/developer/zorvo",
      stateOf: () => "unchecked" as SignInState,
      checkOf: () => ({ phase: "idle" }),
      reportsStatusOf: () => undefined,
      methodsOf: () => [],
      requestOf: () => null,
      busyAgentId: null,
      check: vi.fn(),
      signInWith: vi.fn(),
      sweep: vi.fn(),
      againOf: () => "closed" as const,
      openAgain: vi.fn(),
      closeAgain: vi.fn(),
      terminal: { dialog: null } as unknown as SettingsSignIn["terminal"],
      cancelSignIn: vi.fn(),
      finishSignIn: vi.fn(),
      retrySignIn: vi.fn(),
      ...overrides,
    };
  }

  it("starts no agent when the menu opens: only Settings' Agents section sweeps", () => {
    const signIn = fakeSignIn();
    renderMenu({}, { signIn });
    fireEvent.click(screen.getByRole("button", { name: /^Agents/ }));
    expect(signIn.sweep).not.toHaveBeenCalled();
    expect(signIn.check).not.toHaveBeenCalled();
  });

  it("shows an agent's ways in under its row, keeps the menu open and starts no session", () => {
    const signIn = fakeSignIn({ methodsOf: (id) => (id === "qwen-code" ? [login] : []) });
    const { onSetUpAgent } = renderMenu({ "qwen-code": "needed" }, { signIn });
    fireEvent.click(screen.getByRole("button", { name: "Agents, sign-in needed" }));

    fireEvent.click(screen.getByRole("button", { name: "Sign in to Qwen Code" }));

    expect(onSetUpAgent).not.toHaveBeenCalled();
    const group = within(screen.getByRole("group", { name: "Qwen Code sign-in" }));
    fireEvent.click(group.getByRole("button", { name: "Sign in with Qwen OAuth" }));
    expect(signIn.signInWith).toHaveBeenCalledWith("qwen-code", "qwen-login");
    expect(screen.getByRole("dialog", { name: "Agents in use" })).toBeInTheDocument();
  });

  it("reads the ways in without a session when none are known yet", () => {
    const signIn = fakeSignIn();
    renderMenu({ "qwen-code": "needed" }, { signIn });
    fireEvent.click(screen.getByRole("button", { name: "Agents, sign-in needed" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Qwen Code" }));
    expect(signIn.openAgain).toHaveBeenCalledWith("qwen-code");
  });

  it("checks an agent never checked in its row and says the result there", () => {
    const signIn = fakeSignIn({ checkOf: (id) => (id === "codex-acp" ? { phase: "done", message: "Codex looks ready." } : { phase: "idle" }) });
    renderMenu({ "codex-acp": "unchecked" }, { signIn });
    fireEvent.click(screen.getByRole("button", { name: /^Agents/ }));

    fireEvent.click(screen.getByRole("button", { name: "Check Codex" }));

    expect(signIn.check).toHaveBeenCalledWith("codex-acp");
    expect(screen.getByRole("status")).toHaveTextContent("Codex looks ready.");
  });

  it("falls back to a new session while no folder is open", () => {
    const { onSetUpAgent } = renderMenu({ "qwen-code": "needed" }, { signIn: fakeSignIn({ cwd: undefined }) });
    fireEvent.click(screen.getByRole("button", { name: "Agents, sign-in needed" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Qwen Code" }));
    expect(onSetUpAgent).toHaveBeenCalledWith("qwen-code");
  });
});
