import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Sidebar } from "../components/Sidebar";
import { claudeProfile, qwenProfile, makeProfile } from "./fixtures/agents";
import type { Session } from "../types";

const FOLDER = "/Users/test/developer/zorvo";
const kimiProfile = makeProfile({ id: "kimi", name: "Kimi CLI", detected: true });
const agents = [claudeProfile, qwenProfile, kimiProfile];

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    name: "Fix the login",
    profileId: "claude-acp",
    cwd: FOLDER,
    status: "terminated",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  };
}

/** Three agents on one prompt, started in this order. */
function runSessions(overrides: Partial<Session> = {}): Session[] {
  return [
    session({ id: "r-claude", profileId: "claude-acp", createdAt: 10, compareRunId: "run-1", ...overrides }),
    session({ id: "r-qwen", profileId: "qwen-code", createdAt: 11, compareRunId: "run-1", ...overrides }),
    session({ id: "r-kimi", profileId: "kimi", createdAt: 12, compareRunId: "run-1", ...overrides }),
  ];
}

function renderSidebar(sessions: Session[], extra: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const handlers = { onSelectSession: vi.fn(), onOpenRun: vi.fn() };
  render(
    <Sidebar
      workspaces={[{ name: "zorvo", path: FOLDER }]}
      sessions={sessions}
      agents={agents}
      onNewSession={vi.fn()}
      {...handlers}
      {...extra}
    />,
  );
  return handlers;
}

const groupButton = () => screen.getByRole("button", { name: /Fix the login.*3 agents/ });

describe("a compare run in the sidebar", () => {
  it("shows a run as one group with a row per agent", () => {
    renderSidebar(runSessions());

    expect(groupButton()).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Agents in Fix the login" }));
    expect(rows.getByRole("button", { name: /Claude Code/ })).toBeInTheDocument();
    expect(rows.getByRole("button", { name: /Qwen Code/ })).toBeInTheDocument();
    expect(rows.getByRole("button", { name: /Kimi CLI/ })).toBeInTheDocument();
    // The shared title is the group's, never repeated on the rows.
    expect(screen.getAllByText("Fix the login")).toHaveLength(1);
  });

  it("opens the panel when the group is clicked", () => {
    const { onOpenRun, onSelectSession } = renderSidebar(runSessions());

    fireEvent.click(groupButton());

    expect(onOpenRun).toHaveBeenCalledWith("run-1");
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("opens that agent's chat when a row is clicked", () => {
    const { onOpenRun, onSelectSession } = renderSidebar(runSessions());

    fireEvent.click(screen.getByRole("button", { name: /Qwen Code/ }));

    expect(onSelectSession).toHaveBeenCalledWith("r-qwen");
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it("is a plain row once one listed session is left", () => {
    const [claude, qwen, kimi] = runSessions();
    renderSidebar([claude, { ...qwen, archivedAt: 50 }, { ...kimi, archivedAt: 50 }]);

    expect(screen.queryByRole("button", { name: /agents/ })).toBeNull();
    expect(screen.queryByRole("list", { name: /^Agents in/ })).toBeNull();
    expect(within(screen.getByTestId("session-row-r-claude")).getByText("Fix the login")).toBeInTheDocument();
  });

  it("does not list a run's sessions twice under Pinned", () => {
    const [claude, qwen, kimi] = runSessions();
    renderSidebar([{ ...claude, pinned: true }, qwen, kimi, session({ id: "plain-pinned", name: "Notes", pinned: true })]);

    expect(screen.getAllByTestId("session-row-r-claude")).toHaveLength(1);
    const pinned = within(screen.getByRole("list", { name: "Pinned sessions" }));
    expect(pinned.queryByTestId("session-row-r-claude")).toBeNull();
    expect(pinned.getByTestId("session-row-plain-pinned")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Agents in Fix the login" })).getByTestId("session-row-r-claude")).toBeInTheDocument();
  });

  it("keeps a pinned session under Pinned when its run has no group left", () => {
    const [claude, qwen] = runSessions();
    renderSidebar([{ ...claude, pinned: true }, { ...qwen, archivedAt: 50 }]);

    const pinned = within(screen.getByRole("list", { name: "Pinned sessions" }));
    expect(pinned.getByTestId("session-row-r-claude")).toBeInTheDocument();
  });

  it("marks the group as current while its panel is open", () => {
    const { rerender } = render(
      <Sidebar
        workspaces={[{ name: "zorvo", path: FOLDER }]}
        sessions={runSessions()}
        agents={agents}
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );
    expect(groupButton()).not.toHaveAttribute("aria-current");

    rerender(
      <Sidebar
        workspaces={[{ name: "zorvo", path: FOLDER }]}
        sessions={runSessions()}
        agents={agents}
        activeRunId="run-1"
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );
    expect(groupButton()).toHaveAttribute("aria-current", "true");
  });

  it("renders a session outside a run as it did", () => {
    renderSidebar([session({ id: "alone", name: "Add a README" })]);

    const row = screen.getByTestId("session-row-alone");
    expect(within(row).getByText("Add a README")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /agents/ })).toBeNull();
  });

  it("keeps a fork of a run's session under that agent's row", () => {
    const fork = session({ id: "fork-1", name: "Fix the login (fork)", profileId: "qwen-code", createdAt: 20, forkedFrom: "r-qwen" });
    renderSidebar([...runSessions(), fork]);

    const forks = within(screen.getByRole("list", { name: "Forks of Fix the login" }));
    expect(forks.getByTestId("session-row-fork-1")).toBeInTheDocument();
    // Under the Qwen Code row, not beside the group.
    const qwenItem = screen.getByTestId("session-row-r-qwen").closest("li");
    expect(qwenItem).toContainElement(screen.getByTestId("session-row-fork-1"));
  });

  it("keeps the row actions on a child row", () => {
    const onDeleteSession = vi.fn();
    const onPinSession = vi.fn();
    renderSidebar(runSessions(), { onDeleteSession, onPinSession });

    const row = screen.getByTestId("session-row-r-qwen");
    fireEvent.click(within(row).getByRole("button", { name: "More actions for Qwen Code" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(onPinSession).toHaveBeenCalledWith("r-qwen", true);

    fireEvent.click(within(row).getByRole("button", { name: /^More actions for / }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "Confirm delete" }));
    expect(onDeleteSession).toHaveBeenCalledWith("r-qwen");
  });

  it("shows a run as Compare with its agents' logos and a summary", () => {
    renderSidebar(runSessions(), { isSessionBusy: (id) => id === "r-kimi" });

    const group = screen.getByTestId("run-group-run-1");
    expect(group).toHaveClass("h-11");
    expect(within(group).getByText("Compare · 3 agents")).toHaveClass("truncate");
    // The summary never gives way to the count.
    expect(within(group).getByText(/· 1 working, 2 finished$/)).toHaveClass("shrink-0");
    expect(within(group).getByText("Compare · 3 agents").parentElement).toHaveClass("text-fg-muted");
    expect(within(group).getAllByRole("img", { hidden: true })).toHaveLength(3);
    expect(group.querySelector(".bg-status-running")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps its sessions listed under it after a click", () => {
    const { onOpenRun } = renderSidebar(runSessions());

    fireEvent.click(groupButton());

    expect(onOpenRun).toHaveBeenCalledWith("run-1");
    expect(screen.getByRole("list", { name: "Agents in Fix the login" })).toBeInTheDocument();
  });

  it("counts a run's agents from the run, not from what a search leaves", () => {
    const fork = session({ id: "fork-1", name: "Hotfix", profileId: "qwen-code", createdAt: 20, forkedFrom: "r-qwen" });
    renderSidebar([...runSessions(), fork]);

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), { target: { value: "hotfix" } });

    expect(screen.getByRole("button", { name: /Fix the login.*3 agents/ })).toBeInTheDocument();
  });

  it("finds a run's rows by the agent's name", () => {
    renderSidebar([...runSessions(), session({ id: "alone", name: "Add a README" })]);

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), { target: { value: "qwen" } });

    const rows = within(screen.getByRole("list", { name: "Agents in Fix the login" }));
    expect(rows.getByRole("button", { name: /Qwen Code/ })).toBeInTheDocument();
    expect(rows.queryByRole("button", { name: /Kimi CLI/ })).toBeNull();
    expect(screen.queryByTestId("session-row-alone")).toBeNull();
  });
});
