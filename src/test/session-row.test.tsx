import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SessionTree, type SessionListContext } from "../components/sidebar/SessionList";
import { CONFIRM_DELETE_MS } from "../components/sidebar/SessionMenu";
import type { Session } from "../types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    name: "A session",
    profileId: "qwen",
    cwd: "/Users/test/developer/zorvo",
    status: "terminated",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  };
}

function context(overrides: Partial<SessionListContext> = {}): SessionListContext {
  return {
    agentNameOf: () => "Qwen Code",
    isSessionBusy: () => false,
    isSessionWaiting: () => false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn(),
    ...overrides,
  };
}

function tree(target: Session, overrides: Partial<SessionListContext> = {}) {
  return <SessionTree nodes={[{ session: target, children: [] }]} label="Sessions" context={context(overrides)} />;
}

function renderRow(target: Session, overrides: Partial<SessionListContext> = {}) {
  const view = render(tree(target, overrides));
  return { row: screen.getByTestId(`session-row-${target.id}`), ...view };
}

const openMenu = (name: string) => fireEvent.click(screen.getByRole("button", { name: `More actions for ${name}` }));

afterEach(() => vi.useRealTimers());

describe("SessionRow", () => {
  it("shows the agent and the status in words on its second line", () => {
    const busy = session({ id: "s-busy" });
    const { row } = renderRow(busy, { isSessionBusy: () => true, onStopSession: vi.fn() });
    expect(within(row).getByText("Qwen Code")).toBeInTheDocument();
    expect(within(row).getByText(/· Working$/)).toBeInTheDocument();
    expect(within(row).getByText(busy.name).closest("button")?.title).toContain("Working");
  });

  it("keeps the status words whole when the agent's name is long, in a color readable on hover", () => {
    const { row } = renderRow(session(), {
      agentNameOf: () => "Google Antigravity",
      isSessionBusy: () => true,
      onStopSession: vi.fn(),
    });
    expect(within(row).getByText("Google Antigravity")).toHaveClass("truncate");
    expect(within(row).getByText(/· Working$/)).toHaveClass("shrink-0");
    const line = within(row).getByText("Google Antigravity").parentElement as HTMLElement;
    expect(line).toHaveClass("text-fg-muted");
    expect(line).not.toHaveClass("text-fg-subtle");
  });

  it("keeps its actions shown while its menu is open", () => {
    const { row } = renderRow(session());
    expect(within(row).getByTestId("session-row-actions")).toHaveClass(
      "has-[[role=menu]]:opacity-100",
      "has-[[role=menu]]:pointer-events-auto",
    );
  });

  it("keeps the status dot on the left while the actions show", () => {
    const { row } = renderRow(session({ id: "s-busy" }), { isSessionBusy: () => true, onStopSession: vi.fn() });
    const actions = within(row).getByTestId("session-row-actions");
    const dot = row.querySelector(".bg-status-running");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(actions.contains(dot)).toBe(false);
    expect(actions).toHaveClass("group-hover:opacity-100", "group-focus-within:opacity-100");
  });

  it("is 44px tall and cuts long text", () => {
    const long = session({ id: "s-long", name: "x".repeat(200) });
    const { row } = renderRow(long);
    expect(row).toHaveClass("h-11");
    expect(within(row).getByText(long.name)).toHaveClass("truncate");
    expect(within(row).getByText("Qwen Code")).toHaveClass("truncate");
  });

  it("marks a session that runs in its own worktree", () => {
    const { row } = renderRow(
      session({ worktree: { path: "/tmp/wt", branch: "agent/fix", repoPath: "/Users/test/developer/zorvo" } }),
    );
    expect(within(row).getByLabelText("Runs in its own worktree")).toBeInTheDocument();
  });

  it("deletes only after the confirm in its menu", () => {
    const onDeleteSession = vi.fn();
    renderRow(session(), { onDeleteSession });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const confirm = screen.getByRole("menuitem", { name: "Confirm delete" });
    expect(confirm).toHaveTextContent("Delete?");
    expect(confirm).toHaveClass("bg-danger-surface", "text-danger");
    expect(onDeleteSession).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(onDeleteSession).toHaveBeenCalledWith("s-1");
  });

  it("turns the confirm back by itself", () => {
    vi.useFakeTimers();
    renderRow(session(), { onDeleteSession: vi.fn() });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    act(() => vi.advanceTimersByTime(CONFIRM_DELETE_MS));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Confirm delete" })).toBeNull();
  });

  it("offers no Delete or Archive while the agent works, and drops an open confirm when it starts", () => {
    const idle = { onDeleteSession: vi.fn(), onArchiveSession: vi.fn() };
    const { rerender } = renderRow(session(), idle);
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("menuitem", { name: "Confirm delete" })).toBeInTheDocument();

    rerender(tree(session(), { ...idle, isSessionBusy: () => true }));
    expect(screen.queryByRole("menuitem", { name: "Confirm delete" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();

    rerender(tree(session(), idle));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers Stop only while the agent works", () => {
    const onStopSession = vi.fn();
    const { rerender } = renderRow(session(), { onStopSession });
    expect(screen.queryByRole("button", { name: "Stop session" })).toBeNull();
    rerender(tree(session(), { onStopSession, isSessionBusy: () => true }));
    fireEvent.click(screen.getByRole("button", { name: "Stop session" }));
    expect(onStopSession).toHaveBeenCalledWith("s-1");
  });
});
