import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Wordmark } from "../components/onboarding/Wordmark";
import { AgentChoices, type AgentChoicesProps } from "../components/onboarding/AgentChoices";
import { FolderChoice } from "../components/onboarding/FolderChoice";
import { resetAgentInstalls, startInstall } from "../lib/agent-installs";
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

  it("an agent not installed says Zorvo installs it when you tick it", () => {
    renderChoices();
    expect(rowOf("Gemini CLI")).toHaveTextContent("Zorvo installs it when you tick it");
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
