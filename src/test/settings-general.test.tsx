import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GeneralSection, type GeneralSectionProps } from "../components/settings/GeneralSection";
import type { AgentProfile } from "../types";
import { makeProfile } from "./fixtures/agents";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 7, 12);

const claude: AgentProfile = makeProfile({ id: "claude-code", name: "Claude Code", command: "claude", detected: true, detected_path: "/bin/claude" });
const codex: AgentProfile = makeProfile({ id: "codex", name: "Codex", command: "codex", detected: true, detected_path: "/bin/codex" });
const gemini: AgentProfile = makeProfile({ id: "gemini", name: "Gemini CLI", command: "gemini", detected: false });

function renderGeneral(overrides: Partial<GeneralSectionProps> = {}) {
  const props: GeneralSectionProps = {
    agents: [claude, codex, gemini],
    defaultAgentId: "claude-code",
    onChangeDefaultAgent: vi.fn(),
    recentFolders: [{ name: "agent-desktop", path: "/Users/me/agent-desktop" }],
    onRemoveRecentFolder: vi.fn(),
    appVersion: "0.8.0",
    appUpdate: {
      available: null,
      isChecking: false,
      checkedAt: NOW - 2 * HOUR,
      checkFailed: false,
      checkNow: vi.fn(async () => {}),
      install: vi.fn(async () => {}),
      isInstalling: false,
      progress: null,
    },
    restartNote: null,
    onRunOnboarding: vi.fn(),
    ...overrides,
  };
  render(<GeneralSection {...props} />);
  return props;
}

const about = () => screen.getByRole("region", { name: "About" });
const update = (overrides: Partial<GeneralSectionProps["appUpdate"]>) => ({
  available: null,
  isChecking: false,
  checkedAt: NOW - 2 * HOUR,
  checkFailed: false,
  checkNow: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  isInstalling: false,
  progress: null,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("General section", () => {
  it("has the canvas's title, sentence and groups, 28px apart", () => {
    renderGeneral();
    expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeInTheDocument();
    expect(screen.getByText("How new sessions start, and the folders Zorvo remembers.")).toBeInTheDocument();
    for (const name of ["New sessions", "Recent folders", "About"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).parentElement?.parentElement).toHaveClass("flex", "flex-col", "gap-7");
  });

  it("default agent opens a listbox of ready agents and saves the pick", () => {
    const props = renderGeneral();
    const trigger = screen.getByRole("button", { name: /Claude Code/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox", { name: "Default agent" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["Claude Code", "Codex"]);
    expect(within(list).getByRole("option", { name: "Claude Code" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(list).getByRole("option", { name: "Codex" }));
    expect(props.onChangeDefaultAgent).toHaveBeenCalledWith("codex");
    expect(screen.queryByRole("listbox", { name: "Default agent" })).toBeNull();
  });

  it("with no default the picker reads Choose an agent", () => {
    renderGeneral({ defaultAgentId: null });
    expect(screen.getByRole("button", { name: /Choose an agent/ })).toBeInTheDocument();
  });

  it("a default agent that is not ready is still named", () => {
    renderGeneral({ defaultAgentId: "gemini" });
    expect(screen.getByRole("button", { name: /Gemini CLI/ })).toBeInTheDocument();
  });

  it("with no ready agent the row says so", () => {
    renderGeneral({ agents: [gemini], defaultAgentId: null });
    const group = screen.getByRole("region", { name: "New sessions" });
    expect(within(group).getByText("No agents are installed yet.")).toBeInTheDocument();
    expect(within(group).queryByRole("button")).toBeNull();
  });

  it("Remove takes a folder out", () => {
    const props = renderGeneral();
    fireEvent.click(screen.getByRole("button", { name: "Remove agent-desktop from recent folders" }));
    expect(props.onRemoveRecentFolder).toHaveBeenCalledWith("/Users/me/agent-desktop");
    expect(screen.getByText("/Users/me/agent-desktop")).toHaveClass("font-mono", "text-caption");
  });

  it("no recent folders reads as a row", () => {
    renderGeneral({ recentFolders: [] });
    expect(within(screen.getByRole("region", { name: "Recent folders" })).getByText("No recent folders yet.")).toBeInTheDocument();
  });

  it("About reads up to date with the time of the check", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    renderGeneral();
    const line = within(about()).getByText("0.8.0 · Up to date · checked 2 h ago");
    const dot = line.querySelector("[aria-hidden]") as HTMLElement;
    expect(dot).toHaveClass("bg-status-running");
    expect(dot.className).not.toContain("animate-pulse");
  });

  it("before the first check About says so", () => {
    renderGeneral({ appUpdate: update({ checkedAt: null }) });
    expect(within(about()).getByText("0.8.0 · Not checked yet")).toBeInTheDocument();
  });

  it("Check now asks again", () => {
    const props = renderGeneral();
    fireEvent.click(within(about()).getByRole("button", { name: "Check now" }));
    expect(props.appUpdate.checkNow).toHaveBeenCalled();
  });

  it("while checking, Check now is off and the line says so", () => {
    renderGeneral({ appUpdate: update({ isChecking: true }) });
    expect(within(about()).getByRole("button", { name: "Check now" })).toBeDisabled();
    expect(within(about()).getByText("0.8.0 · Checking for updates…")).toBeInTheDocument();
  });

  it("a failed check says so", () => {
    renderGeneral({ appUpdate: update({ checkFailed: true }) });
    expect(within(about()).getByText("0.8.0 · Could not check for updates")).toBeInTheDocument();
  });

  it("shows an update hidden by Later with Update & restart", () => {
    const props = renderGeneral({
      appUpdate: update({ available: { version: "0.9.0" } }),
      restartNote: "Restarting stops 2 agents mid-turn and 1 shell.",
    });
    expect(within(about()).getByText("0.9.0 is ready")).toBeInTheDocument();
    expect(within(about()).queryByRole("button", { name: "Check now" })).toBeNull();
    fireEvent.click(within(about()).getByRole("button", { name: "Update & restart" }));
    expect(props.appUpdate.install).toHaveBeenCalled();
    expect(within(about()).getByText("Restarting stops 2 agents mid-turn and 1 shell.")).toBeInTheDocument();
  });

  it("an install shows its download, then its install", () => {
    const { unmount } = render(
      <GeneralSection
        {...renderProps()}
        appUpdate={update({ available: { version: "0.9.0" }, isInstalling: true, progress: { phase: "downloading", downloaded: 42, total: 100 } })}
      />,
    );
    expect(within(about()).getByText("Downloading 0.9.0 · 42%")).toBeInTheDocument();
    expect(within(about()).getByRole("button", { name: "Update & restart" })).toBeDisabled();
    unmount();
    render(<GeneralSection {...renderProps()} appUpdate={update({ available: { version: "0.9.0" }, isInstalling: true, progress: { phase: "installing" } })} />);
    expect(within(about()).getByText("Installing 0.9.0…")).toBeInTheDocument();
  });

  it("announces each state once, not each minute or percent", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { rerender } = render(<GeneralSection {...renderProps()} appUpdate={update({ checkedAt: NOW - 2 * 60_000 })} />);
    const status = within(about()).getByRole("status");
    expect(status).toHaveTextContent(/^Zorvo is up to date\.$/);
    // The visible line, which changes every minute, is not inside the live region.
    expect(status).not.toContainElement(within(about()).getByText("0.8.0 · Up to date · checked 2 min ago"));
    rerender(<GeneralSection {...renderProps()} appUpdate={update({ available: { version: "0.9.0" }, isInstalling: true, progress: { phase: "downloading", downloaded: 42, total: 100 } })} />);
    expect(within(about()).getByRole("status")).toHaveTextContent(/^Downloading Zorvo 0\.9\.0\.$/);
    rerender(<GeneralSection {...renderProps()} appUpdate={update({ checkFailed: true })} />);
    expect(within(about()).getByRole("status")).toHaveTextContent(/^Could not check for updates\.$/);
  });

  it("Run setup again calls onRunOnboarding", () => {
    const props = renderGeneral();
    fireEvent.click(within(about()).getByRole("button", { name: "Run setup again" }));
    expect(props.onRunOnboarding).toHaveBeenCalled();
  });
});

function renderProps(): GeneralSectionProps {
  return {
    agents: [claude],
    defaultAgentId: "claude-code",
    onChangeDefaultAgent: () => {},
    recentFolders: [],
    onRemoveRecentFolder: () => {},
    appVersion: "0.8.0",
    appUpdate: update({}),
    restartNote: null,
    onRunOnboarding: () => {},
  };
}
