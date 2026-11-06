import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AgentCatalog } from "../components/agents/AgentCatalog";
import type { AgentCatalogActions } from "../hooks/useAgentCatalogActions";
import type { AgentCheck, SettingsSignIn } from "../hooks/useSettingsSignIn";
import type { SignInState } from "../lib/agent-sign-in";
import type { AgentCatalog as Catalog } from "../types";
import { fakeCatalog, makeCatalogAgent } from "./fixtures/catalog";
import { fakeProfiles, makeProfile } from "./fixtures/agents";

afterEach(() => vi.restoreAllMocks());

const NO_ACTIONS: AgentCatalogActions = {
  addAgent: () => {},
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
    terminal: { dialog: null } as unknown as SettingsSignIn["terminal"],
    cancelSignIn: vi.fn(),
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
  it("an in-use row is one line with a logo tile, mono source, chip and buttons", () => {
    renderCatalog();
    const claude = row("Claude Code");
    expect(claude.querySelector(".size-7.bg-surface-hover")).not.toBeNull();
    expect(within(claude).getByText("1.2.0 · installed by Zorvo")).toHaveClass("font-mono", "text-caption");
    expect(claude).toHaveTextContent("Sign-in: Ready");
    expect(within(claude).getByRole("button", { name: "Update to 1.3.0" }).className).toContain("border-border-strong");
    expect(within(claude).getByRole("button", { name: "More actions for Claude Code" })).toBeInTheDocument();
    expect(within(claude).queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("an available row has its description and an outline Add", () => {
    renderCatalog({
      catalog: catalogWith([...fakeCatalog, makeCatalogAgent({ id: "kimi", name: "Kimi CLI", description: "Moonshot's coding agent", status: "ready" })]),
    });
    const kimi = row("Kimi CLI");
    expect(within(kimi).getByText("Moonshot's coding agent")).toHaveClass("text-ui-sm", "text-fg-subtle");
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

  it("an opened last row keeps the card's rounded corners", () => {
    renderCatalog();
    expect(row("Claude Code")).toHaveClass("first:rounded-t-xl", "last:rounded-b-xl");
  });

  it("a row opens its sign-in when the agent needs one", () => {
    renderCatalog({ signIn: fakeSignIn({ "codex-acp": "needed" }) });
    const codex = row("Codex");
    expect(within(codex).getByRole("group", { name: "Codex sign-in" })).toBeInTheDocument();
    expect(codex).toHaveClass("bg-surface-1");
    const chevron = within(codex).getByRole("button", { name: "Hide sign-in for Codex" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(within(codex).getByRole("button", { name: "Log in with Google" })).toBeInTheDocument();
  });

  it("opens a closed row's sign-in when the agent comes to need one, and keeps it open once ready", () => {
    const { props, rerender } = renderCatalog();
    expect(within(row("Codex")).queryByRole("group", { name: "Codex sign-in" })).toBeNull();
    rerender(<AgentCatalog {...props} signIn={fakeSignIn({ "codex-acp": "needed" })} />);
    expect(within(row("Codex")).getByRole("group", { name: "Codex sign-in" })).toBeInTheDocument();
    rerender(<AgentCatalog {...props} signIn={fakeSignIn({ "codex-acp": "ready" })} />);
    expect(within(row("Codex")).getByRole("group", { name: "Codex sign-in" })).toBeInTheDocument();
  });

  it("the chevron shows and hides the sign-in of a ready agent", () => {
    renderCatalog();
    const claude = row("Claude Code");
    expect(within(claude).queryByRole("group", { name: "Claude Code sign-in" })).toBeNull();
    fireEvent.click(within(claude).getByRole("button", { name: "Show sign-in for Claude Code" }));
    expect(within(claude).getByRole("button", { name: "Check sign-in" })).toBeInTheDocument();
    fireEvent.click(within(claude).getByRole("button", { name: "Hide sign-in for Claude Code" }));
    expect(within(claude).queryByRole("group", { name: "Claude Code sign-in" })).toBeNull();
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
    expect(search).toHaveClass("h-8", "border-border-strong", "bg-surface-2");
    expect(screen.getByRole("button", { name: "Check again" })).toHaveClass("h-8");
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
    expect(broken.querySelector(".size-7.bg-surface-hover")).not.toBeNull();
    expect(broken.closest(".rounded-xl")).toHaveClass("bg-surface-2");
  });
});
