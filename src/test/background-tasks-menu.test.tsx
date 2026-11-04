import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BackgroundTasksMenu, type BackgroundTasksMenuProps } from "../components/topbar/BackgroundTasksMenu";
import type { BackgroundTask } from "../lib/background-tasks";

const NOW = 1_700_000_000_000;

const devServer: BackgroundTask = {
  id: "process:41",
  kind: "shell",
  name: "npm run dev",
  detail: "Fix login · localhost:5173",
  status: "Running",
  startedAt: NOW - 45_000,
  sessionId: "s1",
  pid: 41,
};

const agent: BackgroundTask = {
  id: "agent:s2",
  kind: "agent",
  name: "Refactor auth",
  status: "Needs approval",
  startedAt: NOW - 10_000,
  sessionId: "s2",
};

const subagent: BackgroundTask = {
  id: "tool:s3:t1",
  kind: "subagent",
  name: "Explore the migration",
  detail: "Audit",
  status: "Running",
  startedAt: NOW - 5_000,
  sessionId: "s3",
};

const shellTool: BackgroundTask = {
  id: "tool:s1:t2",
  kind: "shell",
  name: "pnpm test:unit",
  detail: "Fix login",
  status: "Running",
  startedAt: NOW - 3_000,
  sessionId: "s1",
};

function setup(overrides: Partial<BackgroundTasksMenuProps> = {}) {
  const props: BackgroundTasksMenuProps = {
    tasks: [devServer, agent],
    isOpen: true,
    onOpenChange: vi.fn(),
    onOpenTask: vi.fn(),
    onStopTask: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  const view = render(<BackgroundTasksMenu {...props} />);
  return { props, ...view };
}

describe("BackgroundTasksMenu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the tasks on the chip", () => {
    const { props, rerender } = setup({ isOpen: false });
    expect(screen.getByRole("button", { name: "2 background tasks" })).toBeTruthy();
    rerender(<BackgroundTasksMenu {...props} tasks={[agent]} />);
    expect(screen.getByRole("button", { name: "1 background task" })).toBeTruthy();
  });

  it("shows nothing while no task runs", () => {
    const { container } = setup({ isOpen: false, tasks: [] });
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("closes when the last task ends", () => {
    const { props, rerender } = setup();
    rerender(<BackgroundTasksMenu {...props} tasks={[]} />);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "Background tasks" })).toBeNull();
  });

  it("lists each task with its status, origin and actions", () => {
    setup({ tasks: [shellTool, subagent] });
    const dialog = within(screen.getByRole("dialog", { name: "Background tasks" }));
    expect(dialog.getByText("Background tasks · 2 running")).toBeTruthy();
    const rows = within(dialog.getByRole("list", { name: "Running tasks" })).getAllByRole("listitem");
    expect(within(rows[0]).getByText("pnpm test:unit").classList.contains("font-mono")).toBe(true);
    expect(within(rows[0]).queryByRole("button", { name: /^Open/ })).toBeNull();
    expect(within(rows[1]).getByText("Explore the migration").classList.contains("font-mono")).toBe(false);
    expect(within(rows[1]).getByRole("button", { name: "Open Explore the migration" })).toBeTruthy();
    expect(dialog.getByText("Tasks keep running when you switch sessions.")).toBeTruthy();
  });

  it("asks to open when the trigger is clicked", () => {
    const { props } = setup({ isOpen: false });
    fireEvent.click(screen.getByRole("button", { name: /background tasks/ }));
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
  });

  it("lists each task with name, status, detail and duration", () => {
    setup();
    const rows = within(screen.getByRole("list", { name: "Running tasks" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("npm run dev")).toBeTruthy();
    expect(within(rows[0]).getByText("Running")).toBeTruthy();
    expect(within(rows[0]).getByText("Fix login · localhost:5173")).toBeTruthy();
    expect(within(rows[0]).getByText("45s")).toBeTruthy();
    expect(within(rows[1]).getByText("Needs approval")).toBeTruthy();
  });

  it("renders one row of each kind, with Stop only where it can act", () => {
    setup({ tasks: [devServer, agent, subagent, shellTool] });
    expect(screen.getByRole("button", { name: "4 background tasks" })).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Running tasks" })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByRole("button", { name: "Stop npm run dev" })).toBeTruthy();
    expect(within(rows[1]).getByRole("button", { name: "Stop Refactor auth" })).toBeTruthy();
    expect(within(rows[2]).getByText("Explore the migration")).toBeTruthy();
    expect(within(rows[2]).queryByRole("button", { name: /Stop/ })).toBeNull();
    expect(within(rows[3]).getByText("pnpm test:unit")).toBeTruthy();
    expect(within(rows[3]).queryByRole("button", { name: /Stop/ })).toBeNull();
  });

  it("ticks the duration every second while open", () => {
    setup();
    expect(screen.getByText("45s")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("46s")).toBeTruthy();
  });

  it("shows the current duration in the very first frame after opening", () => {
    const frames: string[] = [];
    // Layout effects run right after a commit, before the menu's own effects:
    // what this sees is what the first painted frame shows.
    function FirstFrame() {
      useLayoutEffect(() => {
        frames.push(document.body.textContent ?? "");
      });
      return null;
    }
    const props: BackgroundTasksMenuProps = {
      tasks: [devServer],
      isOpen: false,
      onOpenChange: vi.fn(),
      onOpenTask: vi.fn(),
      onStopTask: vi.fn().mockResolvedValue(true),
    };
    const { rerender } = render(
      <>
        <BackgroundTasksMenu {...props} />
        <FirstFrame />
      </>,
    );
    vi.setSystemTime(NOW + 60_000);
    frames.length = 0;

    rerender(
      <>
        <BackgroundTasksMenu {...props} isOpen />
        <FirstFrame />
      </>,
    );

    expect(frames[0]).toContain("1m 45s");
  });

  it("runs no timer while closed", () => {
    setup({ isOpen: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens a task and closes the menu", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Refactor auth" }));
    expect(props.onOpenTask).toHaveBeenCalledWith(agent);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows Stopping… until the task leaves the list", async () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Stop npm run dev" }));
    await act(async () => {});
    expect(props.onStopTask).toHaveBeenCalledWith(devServer);
    const stopping = screen.getByRole("button", { name: "Stop npm run dev" });
    expect(stopping.textContent).toContain("Stopping…");
    expect((stopping as HTMLButtonElement).disabled).toBe(true);

    rerender(<BackgroundTasksMenu {...props} tasks={[agent]} />);
    expect(screen.queryByRole("button", { name: "Stop npm run dev" })).toBeNull();

    rerender(<BackgroundTasksMenu {...props} tasks={[devServer, agent]} />);
    expect(screen.getByRole("button", { name: "Stop npm run dev" }).textContent).not.toContain("Stopping…");
  });

  it("enables Stop again when the stop fails", async () => {
    setup({ onStopTask: vi.fn().mockResolvedValue(false) });
    fireEvent.click(screen.getByRole("button", { name: "Stop npm run dev" }));
    await act(async () => {});
    const button = screen.getByRole("button", { name: "Stop npm run dev" }) as HTMLButtonElement;
    expect(button.textContent).toContain("Stop");
    expect(button.textContent).not.toContain("Stopping…");
    expect(button.disabled).toBe(false);
  });

  it("announces its popup and labels it", () => {
    setup();

    const trigger = screen.getByRole("button", { name: "2 background tasks" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByRole("dialog", { name: "Background tasks" })).toBeDefined();
  });

  it("lets the text be selected and shows a cut detail in full on hover", () => {
    setup();

    const popup = screen.getByRole("dialog", { name: "Background tasks" });
    expect(popup.classList.contains("select-text")).toBe(true);
    expect(within(popup).getByText("Fix login · localhost:5173").getAttribute("title")).toBe(
      "Fix login · localhost:5173",
    );
  });

  it("closes on Escape", () => {
    const { props } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
