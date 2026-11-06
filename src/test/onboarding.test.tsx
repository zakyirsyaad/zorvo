import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Onboarding, type OnboardingProps } from "../components/Onboarding";
import { resetAgentInstalls, startInstall } from "../lib/agent-installs";
import type { AgentProfile } from "../types";
import { makeProfile } from "./fixtures/agents";
import { fakeCatalog } from "./fixtures/catalog";

afterEach(() => {
  vi.restoreAllMocks();
  resetAgentInstalls();
});

const profile = (id: string, name: string, availability: AgentProfile["availability"]) =>
  makeProfile({ id, name, source: "registry", availability, detected: availability === "ready" });

/** Claude Code and Codex can run now; Gemini CLI needs an install; Qwen Code runs with npx. */
const PROFILES = [
  profile("claude-acp", "Claude Code", "ready"),
  profile("codex-acp", "Codex", "ready"),
  profile("gemini", "Gemini CLI", "not_installed"),
  profile("qwen-code", "Qwen Code", "ready"),
];

const FOLDER = { name: "zorvo", path: "/Users/me/zorvo" };

function renderOnboarding(overrides: Partial<OnboardingProps> = {}) {
  const props: OnboardingProps = {
    catalog: { lastChecked: null, agents: fakeCatalog, unavailable: [] },
    agents: PROFILES,
    settings: { enabledAgents: ["claude-acp"], defaultAgentId: null },
    signInStateOf: () => "ready",
    isSetupOnly: () => false,
    onTick: vi.fn(),
    onUntick: vi.fn(),
    onMakeDefault: vi.fn(),
    recentFolders: [FOLDER],
    suggestedFolders: [],
    onPickFolder: vi.fn(async () => null),
    onComplete: vi.fn(),
    ...overrides,
  };
  const view = render(<Onboarding {...props} />);
  return { props, ...view };
}

const start = () => screen.getByRole("button", { name: "Start" });
const note = () => screen.getByRole("status", { name: "" }) as HTMLElement;
const startNote = () => document.getElementById(start().getAttribute("aria-describedby") ?? "") as HTMLElement | null;

describe("the welcome screen", () => {
  it("has the wordmark, the line and the sentence as drawn", () => {
    renderOnboarding();
    expect(screen.getByRole("img", { name: "Zorvo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Every coding agent. One desktop." })).toHaveClass("tracking-[-0.03em]");
    expect(screen.getByText("Pick the agents you'll use and a project folder. You can change all of this later in Settings.")).toHaveClass("text-fg-muted");
    expect(screen.getByRole("main").querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("Start is on with a ready agent and a folder", () => {
    const { props } = renderOnboarding();
    expect(start()).toBeEnabled();
    expect(start()).not.toHaveAttribute("aria-describedby");
    fireEvent.click(start());
    expect(props.onComplete).toHaveBeenCalledWith({ defaultAgentId: "claude-acp", folder: FOLDER });
  });

  it("Start says why it is off when nothing is ticked", () => {
    renderOnboarding({ settings: { enabledAgents: [], defaultAgentId: null } });
    expect(start()).toBeDisabled();
    expect(startNote()).toHaveTextContent("Tick an agent to continue.");
  });

  it("Start says why it is off without a folder", () => {
    renderOnboarding({ recentFolders: [] });
    expect(start()).toBeDisabled();
    expect(startNote()).toHaveTextContent("Choose a project folder.");
  });

  it("Start waits for the only ticked agent to be installed", () => {
    renderOnboarding({ settings: { enabledAgents: ["gemini"], defaultAgentId: null } });
    expect(start()).toBeDisabled();
    expect(startNote()).toHaveTextContent("Install one of these agents to continue.");
  });

  it("Start opens with the ready agent while another installs", async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
    vi.spyOn(internals, "invoke").mockImplementation(() => new Promise(() => {}));
    const { props } = renderOnboarding({ settings: { enabledAgents: ["codex-acp", "claude-acp"], defaultAgentId: "codex-acp" } });
    await act(async () => startInstall("codex-acp"));
    expect(startNote()).toHaveTextContent("Codex is still installing. You can start with Claude Code now.");
    fireEvent.click(start());
    expect(props.onComplete).toHaveBeenCalledWith({ defaultAgentId: "claude-acp", folder: FOLDER });
  });

  it("the default row is the saved default when ticked", () => {
    renderOnboarding({ settings: { enabledAgents: ["claude-acp", "codex-acp"], defaultAgentId: "codex-acp" } });
    const codex = screen.getByRole("checkbox", { name: "Use Codex" }).closest("[data-settings-row]") as HTMLElement;
    expect(codex).toHaveTextContent("Default");
  });

  it("starts with the most recent folder chosen", () => {
    renderOnboarding({ recentFolders: [FOLDER, { name: "old", path: "/old" }] });
    expect(screen.getByText("/Users/me/zorvo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("keeps the note in a live region", () => {
    renderOnboarding({ recentFolders: [] });
    expect(note()).toHaveAttribute("id", start().getAttribute("aria-describedby"));
  });
});

describe("the welcome screen while things load or fail", () => {
  it("keeps Start off and quiet until the agents and their profiles are read", () => {
    const { rerender, props } = renderOnboarding({ catalog: null });
    expect(screen.getByText("Loading the agents…")).toBeInTheDocument();
    expect(start()).toBeDisabled();
    expect(startNote()).toBeNull();
    rerender(<Onboarding {...props} catalog={{ lastChecked: null, agents: fakeCatalog, unavailable: [] }} areAgentsLoaded={false} />);
    expect(start()).toBeDisabled();
    expect(screen.queryByText(/Install one of these agents/)).toBeNull();
  });

  it("says why the agents could not be read, and reads them again", () => {
    const onRetryCatalog = vi.fn();
    renderOnboarding({ catalog: null, catalogError: "network down", onRetryCatalog });
    expect(screen.getByText("Could not load the agents: network down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryCatalog).toHaveBeenCalled();
  });

  it("shows the app's notice", () => {
    renderOnboarding({ notice: <p>Could not open the folder dialog: denied</p> });
    expect(screen.getByText("Could not open the folder dialog: denied")).toBeInTheDocument();
  });

  it("keeps each row where it first was when an agent is ticked", () => {
    const { rerender, props } = renderOnboarding({ settings: { enabledAgents: ["claude-acp"], defaultAgentId: null } });
    const names = () => screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
    const before = names();
    rerender(<Onboarding {...props} settings={{ enabledAgents: ["claude-acp", "qwen-code"], defaultAgentId: null }} />);
    expect(names()).toEqual(before);
  });
});
