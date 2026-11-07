import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Wordmark } from "../components/onboarding/Wordmark";
import { AgentChoices, type AgentChoicesProps } from "../components/onboarding/AgentChoices";
import { FolderChoice } from "../components/onboarding/FolderChoice";
import { resetAgentInstalls, startInstall, startUpdate } from "../lib/agent-installs";
import type { SignInState } from "../lib/agent-sign-in";
import { fakeCatalog, makeCatalogAgent } from "./fixtures/catalog";

afterEach(() => {
  vi.restoreAllMocks();
  resetAgentInstalls();
});

function renderChoices(overrides: Partial<AgentChoicesProps> = {}) {
  const props: AgentChoicesProps = {
    catalog: fakeCatalog,
    enabledIds: ["claude-acp", "codex-acp"],
    defaultId: "claude-acp",
    signInStateOf: () => "ready" as SignInState,
    isSetupOnly: () => false,
    onTick: vi.fn(),
    onInstall: vi.fn(),
    onUntick: vi.fn(),
    onMakeDefault: vi.fn(),
    ...overrides,
  };
  const view = render(<AgentChoices {...props} />);
  return { props, ...view };
}

const rowOf = (name: string) => screen.getByRole("checkbox", { name: `Use ${name}` }).closest("[data-settings-row]") as HTMLElement;

describe("the wordmark", () => {
  it("the wordmark is the symbol beside zorvo", () => {
    render(<Wordmark />);
    const mark = screen.getByRole("img", { name: "Zorvo" });
    expect(mark.querySelectorAll("svg path")).toHaveLength(3);
    expect(mark.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(screen.getByText("zorvo")).toHaveClass("font-semibold", "tracking-[-0.04em]");
  });
});

describe("agents you'll use", () => {
  it("rows are real checkboxes named by the agent", () => {
    renderChoices();
    expect(screen.getByRole("heading", { level: 2, name: "Agents you'll use" })).toBeInTheDocument();
    const claude = screen.getByRole("checkbox", { name: "Use Claude Code" });
    expect(claude).toBeChecked();
    expect(claude.tagName).toBe("INPUT");
    expect(screen.getByRole("checkbox", { name: "Use Gemini CLI" })).not.toBeChecked();
    expect(rowOf("Claude Code").querySelector(".size-7.bg-surface-hover")).not.toBeNull();
  });

  it("rows are divided by hairlines, the last one without", () => {
    renderChoices();
    const items = screen.getByRole("list", { name: "Agents you'll use" }).querySelectorAll(":scope > li");
    expect(items[0]).toHaveClass("border-b", "border-border", "last:border-b-0");
  });

  it("ticking calls onTick, unticking onUntick", () => {
    const { props } = renderChoices();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Gemini CLI" }));
    expect(props.onTick).toHaveBeenCalledWith("gemini");
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Codex" }));
    expect(props.onUntick).toHaveBeenCalledWith("codex-acp");
  });

  it("the default row carries a Default tag and the others Make default", () => {
    const { props } = renderChoices();
    expect(within(rowOf("Claude Code")).getByText("Default")).toHaveClass("border", "text-fg-muted");
    expect(within(rowOf("Claude Code")).queryByRole("button", { name: /Make default/ })).toBeNull();
    const make = within(rowOf("Codex")).getByRole("button", { name: "Make default for Codex" });
    expect(make).toHaveClass("opacity-0", "group-hover:opacity-100", "group-focus-within:opacity-100");
    fireEvent.click(make);
    expect(props.onMakeDefault).toHaveBeenCalledWith("codex-acp");
    expect(within(rowOf("Gemini CLI")).queryByRole("button", { name: /default/ })).toBeNull();
  });

  it("a ready agent says where it runs and that it is ready", () => {
    renderChoices();
    const words = within(rowOf("Claude Code")).getByText("Installed by Zorvo · Ready");
    expect(words.querySelector(".bg-status-running")).not.toBeNull();
  });

  it("an agent that needs a sign-in says it will ask when you start", () => {
    renderChoices({ signInStateOf: (id) => (id === "codex-acp" ? "needed" : "ready") });
    expect(rowOf("Codex")).toHaveTextContent("Installed by Zorvo · Sign in when you start");
  });

  it("an agent not installed says Zorvo can install it, and offers nothing to press until ticked", () => {
    renderChoices();
    expect(rowOf("Gemini CLI")).toHaveTextContent("Not installed · Zorvo can install it");
    expect(within(rowOf("Gemini CLI")).queryByRole("button", { name: /Install/ })).toBeNull();
  });

  it("an install shows its step and bar in the row", async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
    vi.spyOn(internals, "invoke").mockImplementation(() => new Promise(() => {}));
    renderChoices({ enabledIds: ["claude-acp", "gemini"] });
    await act(async () => startInstall("gemini"));
    expect(within(rowOf("Gemini CLI")).getByRole("status")).toHaveTextContent("Starting the install…");
  });

  it("Show all agents reveals the rest", () => {
    const more = ["a", "b", "c"].map((id) => makeCatalogAgent({ id, name: `Agent ${id}`, status: "ready" }));
    renderChoices({ catalog: [...fakeCatalog, ...more] });
    expect(screen.queryByRole("checkbox", { name: "Use Agent c" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show all agents" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("checkbox", { name: "Use Agent c" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer agents" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("project folder", () => {
  const recent = [{ name: "zorvo", path: "/Users/me/zorvo" }];
  const suggested = [
    { name: "zorvo", path: "/Users/me/zorvo" },
    { name: "site", path: "/Users/me/developer/site" },
  ];

  it("a chosen folder shows its path and Change", () => {
    const onPickFolder = vi.fn(() => Promise.resolve(null));
    render(<FolderChoice folder={recent[0]} recentFolders={recent} suggestedFolders={suggested} onChoose={vi.fn()} onPickFolder={onPickFolder} />);
    expect(screen.getByRole("heading", { level: 2, name: "Project folder" })).toBeInTheDocument();
    expect(screen.getByText("/Users/me/zorvo")).toHaveClass("font-mono", "text-caption");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onPickFolder).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("with none chosen, recent and suggested folders are offered once each, then Open folder", () => {
    render(<FolderChoice folder={null} recentFolders={recent} suggestedFolders={suggested} onChoose={vi.fn()} onPickFolder={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Use / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Use zorvo", "Use site"]);
    expect(screen.getByText("Another folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument();
  });

  it("offers at most four folders", () => {
    const many = ["a", "b", "c", "d", "e"].map((name) => ({ name, path: `/p/${name}` }));
    render(<FolderChoice folder={null} recentFolders={[]} suggestedFolders={many} onChoose={vi.fn()} onPickFolder={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Use / })).toHaveLength(4);
  });

  it("Use chooses a folder", () => {
    const onChoose = vi.fn();
    render(<FolderChoice folder={null} recentFolders={recent} suggestedFolders={suggested} onChoose={onChoose} onPickFolder={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use site" }));
    expect(onChoose).toHaveBeenCalledWith({ name: "site", path: "/Users/me/developer/site" });
  });

  it("Open folder chooses what the dialog returns", async () => {
    const onChoose = vi.fn();
    render(<FolderChoice folder={null} recentFolders={[]} suggestedFolders={[]} onChoose={onChoose} onPickFolder={() => Promise.resolve({ name: "x", path: "/x" })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    });
    expect(onChoose).toHaveBeenCalledWith({ name: "x", path: "/x" });
  });

  it("a failed dialog says so and keeps the choice", async () => {
    const onChoose = vi.fn();
    render(<FolderChoice folder={recent[0]} recentFolders={recent} suggestedFolders={[]} onChoose={onChoose} onPickFolder={() => Promise.reject(new Error("no"))} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't open the folder dialog. Try again.");
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText("/Users/me/zorvo")).toBeInTheDocument();
  });

  it("Use moves focus to the chosen folder's Change, which names the folder", () => {
    function Harness() {
      const [folder, setFolder] = useState<{ name: string; path: string } | null>(null);
      return <FolderChoice folder={folder} recentFolders={recent} suggestedFolders={suggested} onChoose={setFolder} onPickFolder={vi.fn()} />;
    }
    render(<Harness />);
    const use = screen.getByRole("button", { name: "Use site" });
    use.focus();
    fireEvent.click(use);
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Change" })).toHaveAccessibleDescription("site /Users/me/developer/site");
  });

  it("Open folder is off while the dialog is open", async () => {
    let answer: (folder: null) => void = () => {};
    const onPickFolder = vi.fn(() => new Promise<null>((resolve) => (answer = resolve)));
    render(<FolderChoice folder={null} recentFolders={[]} suggestedFolders={[]} onChoose={vi.fn()} onPickFolder={onPickFolder} />);
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(onPickFolder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Open folder" })).toBeDisabled();
    await act(async () => answer(null));
    expect(screen.getByRole("button", { name: "Open folder" })).toBeEnabled();
  });

  it("a cancelled dialog changes nothing", async () => {
    const onChoose = vi.fn();
    render(<FolderChoice folder={null} recentFolders={[]} suggestedFolders={[]} onChoose={onChoose} onPickFolder={() => Promise.resolve(null)} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    });
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("review fixes", () => {
  const notInstalled = fakeCatalog.map((agent) => ({ ...agent, status: "not_installed" as const }));

  it("a ticked agent that is not installed offers Install", () => {
    const { props } = renderChoices({ catalog: notInstalled });
    const claude = rowOf("Claude Code");
    expect(claude).toHaveTextContent("Not installed yet");
    fireEvent.click(within(claude).getByRole("button", { name: "Install Claude Code" }));
    expect(props.onInstall).toHaveBeenCalledWith("claude-acp");
    expect(props.onTick).not.toHaveBeenCalled();
  });

  it("says the agents are loading, and why they could not be", () => {
    const onRetry = vi.fn();
    const { rerender, props } = renderChoices({ catalog: [], isLoading: true });
    expect(screen.getByText("Loading the agents…")).toBeInTheDocument();
    rerender(<AgentChoices {...props} catalog={[]} isLoading={false} loadError="network down" onRetry={onRetry} />);
    expect(screen.getByText("Could not load the agents: network down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("Check again asks for the agents again", () => {
    const onCheckAgain = vi.fn(async () => {});
    renderChoices({ onCheckAgain });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheckAgain).toHaveBeenCalled();
  });

  it("a failed Check again is caught, and the button comes back", async () => {
    const onCheckAgain = vi.fn(() => Promise.reject(new Error("registry down")));
    renderChoices({ onCheckAgain });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    });
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("Retry after a failed update updates again, not installs", async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
    vi.spyOn(internals, "invoke").mockImplementation((cmd) =>
      cmd === "update_agent" ? Promise.reject(new Error("no network")) : Promise.resolve(() => {}),
    );
    await act(async () => startUpdate("codex-acp", vi.fn()));
    const onUpdate = vi.fn();
    const { props } = renderChoices({ onUpdate });
    await act(async () => {});
    fireEvent.click(within(rowOf("Codex")).getByRole("button", { name: "Retry" }));
    expect(onUpdate).toHaveBeenCalledWith("codex-acp");
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("rows keep their place when one is ticked", () => {
    const { props, rerender } = renderChoices({ order: ["claude-acp", "codex-acp", "gemini", "qwen-code"] });
    const names = () => screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
    const before = names();
    rerender(<AgentChoices {...props} enabledIds={["claude-acp", "codex-acp", "qwen-code"]} />);
    expect(names()).toEqual(before);
  });

  it("a row unticked past the first five stays on screen", () => {
    const more = ["a", "b", "c"].map((id) => makeCatalogAgent({ id, name: `Agent ${id}`, status: "ready" }));
    const order = ["claude-acp", "codex-acp", "gemini", "qwen-code", "a", "b", "c"];
    const { props, rerender } = renderChoices({ catalog: [...fakeCatalog, ...more], order, enabledIds: ["claude-acp", "c"] });
    expect(screen.getByRole("checkbox", { name: "Use Agent c" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Agent c" }));
    rerender(<AgentChoices {...props} enabledIds={["claude-acp"]} />);
    expect(screen.getByRole("checkbox", { name: "Use Agent c" })).not.toBeChecked();
  });
});
