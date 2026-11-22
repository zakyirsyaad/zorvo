import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewCard, type OverviewCardProps } from "../components/overview/OverviewCard";
import type { Overview, OverviewTask } from "../lib/session-overview";

const task = (key: string, state: OverviewTask["state"], overrides: Partial<OverviewTask> = {}): OverviewTask => ({
  key,
  kind: "subagent",
  title: `Task ${key}`,
  detail: "Subagent · Explore · 3 steps",
  state,
  status: state === "failed" ? "Failed" : state === "done" ? "Done" : "Working",
  tab: { kind: "subagent", toolId: key },
  ...overrides,
});

const empty: Overview = { tasks: [], finished: [], sources: [], pages: [], files: [], pullRequest: null, runningCount: 0 };

function show(overview: Partial<Overview> = {}, props: Partial<OverviewCardProps> = {}) {
  const handlers = {
    onToggleCollapsed: vi.fn(),
    onShowTab: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenPage: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenUrl: vi.fn(),
  };
  render(
    <OverviewCard
      overview={{ ...empty, ...overview }}
      agentName="Claude Code"
      changes={{ added: 42, removed: 11 }}
      folderName="agent-desktop"
      branch="agent/redesign-row"
      filesRoot="/w/agent-desktop"
      isCollapsed={false}
      {...handlers}
      {...props}
    />,
  );
  return { card: screen.getByRole("region", { name: "Session overview" }), ...handlers };
}

const section = (card: HTMLElement, name: string | RegExp) => within(card).getByRole("region", { name });

describe("OverviewCard", () => {
  it("always shows Environment and Output, and the rest only when they hold something", () => {
    const { card } = show();
    expect(section(card, "Environment")).toBeTruthy();
    expect(within(section(card, /^Output/)).getByText("Nothing yet. Pages and files Claude Code makes in this session show here.")).toBeTruthy();
    expect(within(card).queryByRole("region", { name: /^Running/ })).toBeNull();
    expect(within(card).queryByRole("region", { name: /^Sources/ })).toBeNull();
    expect(within(card).queryByRole("region", { name: /^Pull request/ })).toBeNull();
  });

  it("opens Changes and Files from the environment rows", () => {
    const { card, onShowTab } = show();
    const environment = section(card, "Environment");
    fireEvent.click(within(environment).getByRole("button", { name: /Changes/ }));
    fireEvent.click(within(environment).getByRole("button", { name: /Files/ }));
    expect(onShowTab.mock.calls).toEqual([["changes"], ["files"]]);
    expect(within(environment).getByText("+42")).toHaveClass("text-status-running");
    expect(within(environment).getByText("agent/redesign-row")).toBeTruthy();
  });

  it("shows a background agent as a plain row: no button, nothing to open, its status still read", () => {
    const live = task("bg-1", "running", { tab: undefined, title: "Explore auth", detail: "grep: createSession" });
    const failed = task("bg-2", "failed", { tab: undefined, title: "Write docs", detail: "Subagent" });
    const { card, onOpenTask } = show({ tasks: [live, failed], finished: [task("bg-3", "done", { tab: undefined })], runningCount: 1 });
    const running = section(card, /^Running/);

    expect(within(running).getByText("Explore auth")).toBeTruthy();
    expect(within(running).getByText("grep: createSession")).toBeTruthy();
    expect(within(running).getByText("Failed")).toBeTruthy();
    expect(within(running).queryByRole("button", { name: /Explore auth/ })).toBeNull();
    expect(within(running).queryByRole("button", { name: /Write docs/ })).toBeNull();
    expect(within(running).getByText("Subagent, working.")).toHaveClass("sr-only");
    fireEvent.click(within(running).getByText("Explore auth"));
    expect(onOpenTask).not.toHaveBeenCalled();

    fireEvent.click(within(running).getByRole("button", { name: "1 finished" }));
    expect(within(running).getByText("Task bg-3")).toBeTruthy();
    expect(within(running).queryByRole("button", { name: /Task bg-3/ })).toBeNull();
  });

  it("marks a quiet background agent in the warning tone, with how long, and still lists it as running", () => {
    const quiet = task("bg-q", "running", {
      tab: undefined,
      title: "Explore auth",
      detail: "No activity for 55 min. Last: run_shell_command",
      status: "Quiet",
    });
    const { card } = show({ tasks: [quiet], runningCount: 1 });
    const running = section(card, /^Running/);

    expect(within(running).getByText("Quiet")).toHaveClass("text-status-attention");
    expect(within(running).getByText("No activity for 55 min. Last: run_shell_command")).toBeTruthy();
    // The row cuts both lines to fit: hovering it gives them whole.
    expect(within(running).getByTitle("Explore auth: No activity for 55 min. Last: run_shell_command")).toBeTruthy();
    expect(within(running).getByText("Subagent, quiet.")).toHaveClass("sr-only");
    expect(within(running).queryByRole("button")).toBeNull();
  });

  it("opens a task's tab, folds the finished ones, and keeps a failed one in sight", () => {
    const { card, onOpenTask } = show({
      tasks: [task("live", "running"), task("broke", "failed")],
      finished: [task("done", "done")],
      runningCount: 1,
    });
    const running = section(card, /^Running/);
    expect(within(running).getByText("Failed")).toHaveClass("text-danger");
    expect(within(running).queryByText("Task done")).toBeNull();

    fireEvent.click(within(running).getByRole("button", { name: "1 finished" }));
    expect(within(running).getByText("Task done")).toBeTruthy();

    fireEvent.click(within(running).getByRole("button", { name: /^Open Task live/ }));
    expect(onOpenTask).toHaveBeenCalledWith({ kind: "subagent", toolId: "live" });
  });

  it("calls the section Finished when nothing is at work", () => {
    const { card } = show({ finished: [task("a", "done"), task("b", "done")] });
    expect(section(card, /^Finished/)).toBeTruthy();
    expect(within(card).queryByRole("region", { name: /^Running/ })).toBeNull();
  });

  it("shows five rows of a section and the rest on Show N more", () => {
    const sources = Array.from({ length: 7 }, (_, index) => ({ path: `/w/agent-desktop/f${index}.ts`, isImage: false }));
    const { card } = show({ sources });
    const listed = section(card, /^Sources/);
    expect(within(listed).getAllByRole("button", { name: /^f\d\.ts/ })).toHaveLength(5);
    fireEvent.click(within(listed).getByRole("button", { name: "Show 2 more" }));
    expect(within(listed).getAllByRole("button", { name: /^f\d\.ts/ })).toHaveLength(7);
  });

  it("opens a page, a file and the pull request where each belongs", () => {
    const page = { id: "a-1", title: "Session row options", path: "/w/x.html", versions: [{ n: 3, at: Date.now() }] };
    const { card, onOpenPage, onOpenFile, onOpenUrl } = show({
      pages: [page] as unknown as Overview["pages"],
      files: [{ path: "/w/agent-desktop/src/lib/pr-chip.ts", at: Date.now() }],
      pullRequest: {
        branch: "agent/redesign-row",
        number: 250,
        title: "Redesign the session row",
        url: "https://github.com/o/r/pull/250",
        state: "open",
        isDraft: false,
        checks: { passing: 5, failing: 0, pending: 0 },
      },
    });

    fireEvent.click(within(section(card, /^Output/)).getByRole("button", { name: /Session row options/ }));
    fireEvent.click(within(section(card, /^Output/)).getByRole("button", { name: /pr-chip\.ts/ }));
    fireEvent.click(within(section(card, "Pull request")).getByRole("button", { name: /^Open pull request 250 in your browser/ }));

    expect(onOpenPage).toHaveBeenCalledWith("a-1");
    expect(onOpenFile).toHaveBeenCalledWith("src/lib/pr-chip.ts");
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/250");
  });

  it("folds to a pill that says what runs and what changed", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <OverviewCard
        overview={{ ...empty, runningCount: 3 }}
        agentName="Claude Code"
        changes={{ added: 42, removed: 11 }}
        isCollapsed
        onToggleCollapsed={onToggleCollapsed}
        onShowTab={vi.fn()}
        onOpenTask={vi.fn()}
        onOpenPage={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenUrl={vi.fn()}
      />,
    );
    expect(screen.queryByRole("region", { name: "Session overview" })).toBeNull();
    const pill = screen.getByRole("button", { name: "Expand session overview: 3 running, 42 lines added, 11 removed" });
    fireEvent.click(pill);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("collapses from the button beside the Environment heading", () => {
    const { card, onToggleCollapsed } = show();
    fireEvent.click(within(card).getByRole("button", { name: "Collapse session overview" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("hands the focus to the pill when the card folds, and back to the collapse button when it opens", () => {
    function Folding() {
      const [isCollapsed, setIsCollapsed] = useState(false);
      return (
        <OverviewCard
          overview={empty}
          agentName="Claude Code"
          changes={{ added: 1, removed: 0 }}
          isCollapsed={isCollapsed}
          onToggleCollapsed={() => setIsCollapsed((value) => !value)}
          onShowTab={vi.fn()}
          onOpenTask={vi.fn()}
          onOpenPage={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenUrl={vi.fn()}
        />
      );
    }
    render(<Folding />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse session overview" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Expand session overview/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Expand session overview/ }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Collapse session overview" }));
  });

  it("says nothing of the changes while they are read", () => {
    const { card } = show({}, { changes: undefined });
    const row = within(section(card, "Environment")).getByRole("button", { name: /Changes/ });
    expect(row.textContent).toBe("Changes");
  });
});
