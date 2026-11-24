import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AgentCatalog } from "../components/agents/AgentCatalog";
import type { AgentCatalogActions } from "../hooks/useAgentCatalogActions";
import type { AgentCheck, SettingsSignIn } from "../hooks/useSettingsSignIn";
import type { SignInState } from "../lib/agent-sign-in";
import type { AgentCatalog as Catalog } from "../types";
import { resetAgentInstalls, startInstall } from "../lib/agent-installs";
import { fakeCatalog, makeCatalogAgent } from "./fixtures/catalog";
import { fakeProfiles, makeProfile } from "./fixtures/agents";

afterEach(() => {
  vi.restoreAllMocks();
  resetAgentInstalls();
});

const NO_ACTIONS: AgentCatalogActions = {
  addAgent: () => {},
  markAgent: () => {},
  unmarkAgent: () => {},
  updateAgent: () => {},
  removeAgent: () => Promise.resolve(),
  runningSessionCount: () => 0,
};

function fakeSignIn(states: Record<string, SignInState> = {}): SettingsSignIn {
  return {
    cwd: "/Users/test/developer/zorvo",
    stateOf: (id: string) => states[id] ?? "ready",
    checkOf: () => ({ phase: "idle" }) as AgentCheck,
    reportsStatusOf: () => true,
    methodsOf: () => [{ id: "oauth", name: "Log in with Google", kind: "agent" }],
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
  };
}

const catalogWith = (agents = fakeCatalog): Catalog => ({ lastChecked: null, agents, unavailable: [] });

function renderCatalog(overrides: Partial<Parameters<typeof AgentCatalog>[0]> = {}) {
  const props: Parameters<typeof AgentCatalog>[0] = {
    catalog: catalogWith(),
    error: null,
    agents: fakeProfiles,
    enabledIds: ["claude-acp", "codex-acp"],
    actions: NO_ACTIONS,
    signIn: fakeSignIn(),
    onCheckAgain: () => Promise.resolve(),
    onRetryLoad: () => {},
    ...overrides,
  };
  const view = render(<AgentCatalog {...props} />);
  return { props, ...view };
}

const row = (name: string) => screen.getByRole("listitem", { name });

describe("an agent's row as drawn", () => {
  it("an in-use row is one line: a logo tile, the version and its update, a status word, one button and ⋯", () => {
    renderCatalog();
    const claude = row("Claude Code");
    expect(claude.querySelector(".size-7.rounded-lg.bg-chip")).not.toBeNull();
    expect(within(claude).getByText("Claude Code")).toHaveClass("font-medium", "text-fg");
    expect(within(claude).getByText("1.2.0 · update 1.3.0 ready")).toHaveClass("font-mono", "text-caption", "text-fg-muted");
    expect(claude).toHaveTextContent("Sign-in: Ready");
    // A dot and a word, not a pill: the button stays the only shape that looks pressable.
    const status = within(claude).getByText("Ready");
    expect(status.className).not.toMatch(/\bbg-|rounded/);
    expect(status.querySelector(".rounded-full.bg-status-running")).not.toBeNull();
    const update = within(claude).getByRole("button", { name: "Update to 1.3.0" });
    expect(update).toHaveTextContent(/^Update$/);
    expect(update.className).toContain("border-border-strong");
    expect(within(claude).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Update to 1.3.0",
      "More actions for Claude Code",
    ]);
  });

  it("an available row has its description and an outline Add", () => {
    renderCatalog({
      catalog: catalogWith([...fakeCatalog, makeCatalogAgent({ id: "kimi", name: "Kimi CLI", description: "Moonshot's coding agent", status: "ready" })]),
    });
    const kimi = row("Kimi CLI");
    expect(within(kimi).getByText("Moonshot's coding agent")).toHaveClass("text-ui-sm", "text-fg-muted");
    const add = within(kimi).getByRole("button", { name: "Add" });
    expect(add.className).toContain("border-border-strong");
    expect(add.className).not.toContain("bg-primary");
    expect(kimi).not.toHaveTextContent("Sign-in:");
  });

  it("an available agent Add would install reads Install, with what gets installed", () => {
    const geminiProfile = makeProfile({
      id: "gemini",
      name: "Gemini CLI",
      source: "registry",
      availability: "not_installed",
      install_plan: [{ kind: "agent", name: "Gemini CLI", version: "0.2.0", download_bytes: null }],
    });
    const { props } = renderCatalog({ agents: [geminiProfile, ...fakeProfiles], actions: { ...NO_ACTIONS, addAgent: vi.fn() } });
    const gemini = row("Gemini CLI");
    expect(within(gemini).getByText("Installs Gemini CLI 0.2.0 into Zorvo's folder")).toHaveClass("text-ui-sm");
    fireEvent.click(within(gemini).getByRole("button", { name: "Install" }));
    expect(props.actions.addAgent).toHaveBeenCalledWith("gemini");
    expect(within(gemini).queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("a row has no fill of its own, so the card's corners need no help", () => {
    renderCatalog();
    expect(row("Claude Code").className).not.toMatch(/\bbg-|rounded/);
  });

  it("a row lists its sign-in methods as rows while the agent needs one, with no box of their own", () => {
    renderCatalog({ signIn: fakeSignIn({ "codex-acp": "needed" }) });
    const codex = row("Codex");
    expect(within(codex).getByRole("group", { name: "Codex sign-in" })).toBeInTheDocument();
    expect(codex).toHaveTextContent("Sign-in: Needs sign-in");
    // An opened row has no tint, and the methods sit in it without a second box.
    expect(codex.className).not.toContain("bg-");
    const logIn = within(codex).getByRole("button", { name: "Log in with Google" });
    expect(logIn).toHaveTextContent(/^Log in$/);
    expect(logIn.closest("ul")?.className).not.toMatch(/\bbg-|border\b|rounded/);
    expect(within(codex).queryByRole("button", { name: /sign-in for/ })).toBeNull();
  });

  it("shows the methods while the agent needs a sign-in, and not once it is ready", () => {
    const { props, rerender } = renderCatalog();
    expect(within(row("Codex")).queryByRole("group", { name: "Codex sign-in" })).toBeNull();
    rerender(<AgentCatalog {...props} signIn={fakeSignIn({ "codex-acp": "needed" })} />);
    expect(within(row("Codex")).getByRole("group", { name: "Codex sign-in" })).toBeInTheDocument();
    rerender(<AgentCatalog {...props} signIn={fakeSignIn({ "codex-acp": "ready" })} />);
    expect(within(row("Codex")).queryByRole("group", { name: "Codex sign-in" })).toBeNull();
    expect(row("Codex")).toHaveTextContent("Sign-in: Ready");
  });

  it("puts Check sign-in in ⋯, with what checking may do as its description", async () => {
    const signIn = { ...fakeSignIn(), reportsStatusOf: () => false };
    renderCatalog({ signIn });
    await act(async () => {
      fireEvent.click(within(row("Claude Code")).getByRole("button", { name: "More actions for Claude Code" }));
    });
    const check = screen.getByRole("menuitem", { name: /^Check sign-in/ });
    expect(check).toHaveAccessibleDescription(/Claude Code cannot say who is signed in, so Zorvo opens a session in the zorvo folder/);
    fireEvent.click(check);
    expect(signIn.check).toHaveBeenCalledWith("claude-acp");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Remove asks under the row, naming running sessions", async () => {
    const removeAgent = vi.fn(() => Promise.resolve());
    renderCatalog({ actions: { ...NO_ACTIONS, removeAgent, runningSessionCount: () => 2 } });
    const claude = row("Claude Code");
    const more = within(claude).getByRole("button", { name: "More actions for Claude Code" });
    await act(async () => {
      fireEvent.click(more);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    });

    expect(claude).toHaveTextContent("Remove Claude Code? Zorvo deletes its copy. Saved sessions stay readable. Its open sessions stop.");
    const confirm = within(claude).getByRole("button", { name: "Remove" });
    expect(confirm).toHaveFocus();
    expect(confirm.className).toContain("text-danger");

    fireEvent.click(within(claude).getByRole("button", { name: "Cancel" }));
    expect(claude).not.toHaveTextContent("Remove Claude Code?");
    expect(more).toHaveFocus();
    expect(removeAgent).not.toHaveBeenCalled();
  });

  it("onboarding's rows show no chip and no sign-in", () => {
    renderCatalog({ signIn: undefined });
    expect(screen.queryByText(/^Sign-in:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /sign-in for/ })).toBeNull();
  });
});

describe("the Agents section as drawn", () => {
  const unavailable = [{ id: "broken", name: "Broken Agent", description: null, reason: "invalid_entry" as const }];

  it("the search row is drawn at 32px", () => {
    renderCatalog();
    const search = screen.getByRole("searchbox", { name: "Search agents" }).closest("label") as HTMLElement;
    expect(search).toHaveClass("h-8", "border-border", "bg-surface-2");
    // The canvas draws Check again 32px tall to sit beside the field, with an outline button's 12px regular text.
    const checkAgain = screen.getByRole("button", { name: "Check again" });
    expect(checkAgain).toHaveClass("h-8", "text-ui-sm", "font-normal");
    expect(checkAgain).not.toHaveClass("font-medium");
  });

  it("groups read In use and Available, without counts, as cards", () => {
    renderCatalog();
    const inUse = screen.getByRole("region", { name: "In use" });
    expect(within(inUse).getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual(["Claude Code", "Codex"]);
    expect(inUse.querySelector(".rounded-xl.bg-surface-2")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Available" })).toBeInTheDocument();
    expect(screen.queryByText(/All agents/)).toBeNull();
    expect(screen.queryByText(/\(\d+\)$/)).toBeNull();
  });

  it("draws no empty group", () => {
    renderCatalog({ enabledIds: [] });
    expect(screen.queryByRole("region", { name: "In use" })).toBeNull();
  });

  it("search narrows both groups and opens Not available", () => {
    renderCatalog({ catalog: { lastChecked: null, agents: fakeCatalog, unavailable } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search agents" }), { target: { value: "gem" } });
    expect(screen.queryByRole("region", { name: "In use" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Available" })).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search agents" }), { target: { value: "broken" } });
    expect(screen.getByRole("listitem", { name: "Broken Agent" })).toBeVisible();
  });

  it("Not available is a quiet toggle that opens a card of rows", () => {
    renderCatalog({ catalog: { lastChecked: null, agents: fakeCatalog, unavailable } });
    const toggle = screen.getByRole("button", { name: "Not available (1)" });
    expect(toggle).toHaveClass("text-fg-muted", "h-7");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const broken = screen.getByRole("listitem", { name: "Broken Agent" });
    expect(broken.querySelector(".size-7.rounded-lg.bg-chip")).not.toBeNull();
    expect(broken.closest(".rounded-xl")).toHaveClass("bg-surface-2");
  });
});

describe("code review fixes", () => {
  it("hides an open sign-in while the agent installs or updates", async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
    vi.spyOn(internals, "invoke").mockImplementation(() => new Promise(() => {}));
    renderCatalog({ signIn: fakeSignIn({ "claude-acp": "needed" }) });
    expect(within(row("Claude Code")).getByRole("group", { name: "Claude Code sign-in" })).toBeInTheDocument();
    await act(async () => startInstall("claude-acp"));
    expect(within(row("Claude Code")).queryByRole("group", { name: "Claude Code sign-in" })).toBeNull();
  });

  it("says a sign-in check's result under the row", () => {
    const signIn = { ...fakeSignIn(), checkOf: () => ({ phase: "idle", message: "Signed in to Claude Code." }) as AgentCheck };
    renderCatalog({ signIn });
    expect(within(row("Claude Code")).queryByRole("group", { name: "Claude Code sign-in" })).toBeNull();
    expect(within(row("Claude Code")).getByRole("status")).toHaveTextContent("Signed in to Claude Code.");
  });

  it("says an agent in use is not installed when Zorvo does not know what Install adds", () => {
    renderCatalog({ enabledIds: ["claude-acp", "gemini"] });
    expect(row("Gemini CLI")).toHaveTextContent("not installed");
  });

  it("group headings are level 2, Not available's too", () => {
    renderCatalog({ catalog: { lastChecked: null, agents: fakeCatalog, unavailable: [{ id: "x", name: "X", description: null, reason: "invalid_entry" }] } });
    expect(screen.getByRole("heading", { level: 2, name: "In use" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Available" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Not available (1)" })).toBeInTheDocument();
  });
});
