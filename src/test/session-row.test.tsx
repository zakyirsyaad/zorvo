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
    // fg-subtle at rest, as drawn; fg-muted once the row fills surface-hover.
    const line = within(row).getByText("Google Antigravity").parentElement as HTMLElement;
    expect(line).toHaveClass("text-fg-subtle", "group-hover:text-fg-muted");
  });

  it("draws the open row's title in fg at weight 500, with a fg-muted subtitle", () => {
    const { row } = renderRow(session(), { activeSessionId: "s-1" });
    expect(within(row).getByText("A session")).toHaveClass("text-fg", "font-medium");
    expect(within(row).getByText("Qwen Code").parentElement).toHaveClass("text-fg-muted");
  });

  it("shows the agent's logo before the agent's name", () => {
    const { row } = renderRow(session({ profileId: "qwen-code" }));
    const name = within(row).getByText("Qwen Code");
    const logo = name.parentElement?.querySelector("img, svg, [aria-hidden='true']") as Element;
    expect(logo).not.toBeNull();
    // Decorative: the name is written next to it.
    expect(logo.getAttribute("alt") === "" || logo.getAttribute("aria-hidden") === "true").toBe(true);
    expect(logo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps its actions shown while its menu is open", () => {
    const { row } = renderRow(session());
    expect(within(row).getByTestId("session-row-actions")).toHaveClass(
      "has-[[role=menu]]:w-auto",
      "has-[[role=menu]]:overflow-visible",
    );
  });

  it("puts its actions in the row's flow, so the title gives way to them", () => {
    const { row } = renderRow(session({ id: "s-busy" }), { isSessionBusy: () => true, onStopSession: vi.fn() });
    const actions = within(row).getByTestId("session-row-actions");
    const dot = row.querySelector(".bg-status-running");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(actions.contains(dot)).toBe(false);
    expect(actions.className).not.toContain("absolute");
    // Collapsed, never display:none: a hidden button cannot take focus, so Delete?'s
    // autofocus and the return of focus to ⋯ would fail for a keyboard user.
    expect(actions.className.split(/\s+/)).not.toContain("hidden");
    expect(actions).toHaveClass(
      "shrink-0",
      "w-0",
      "overflow-hidden",
      "group-hover:w-auto",
      "group-focus-within:w-auto",
      "group-focus-within:overflow-visible",
    );
  });

  it("does not pulse the working dot", () => {
    const { row } = renderRow(session({ id: "s-busy" }), { isSessionBusy: () => true, onStopSession: vi.fn() });
    expect(row.querySelector(".bg-status-running")).not.toHaveClass("motion-safe:animate-pulse");
  });

  it("is top-aligned and cuts a long title and a long agent name", () => {
    const long = session({ id: "s-long", name: "x".repeat(120) });
    const { row } = renderRow(long, {
      agentNameOf: () => "An agent with a very long name indeed",
      isSessionBusy: () => true,
      onStopSession: vi.fn(),
    });
    expect(row).toHaveClass("items-start");
    expect(within(row).getByText(long.name)).toHaveClass("truncate");
    expect(within(row).getByText("An agent with a very long name indeed")).toHaveClass("truncate");
    // The actions keep their room: they never shrink, and the text column can.
    expect(within(row).getByTestId("session-row-actions")).toHaveClass("shrink-0");
    expect(within(row).getByText(long.name).closest("button")).toHaveClass("min-w-0");
  });

  it("marks a session that runs in its own worktree at the start of its subtitle", () => {
    const { row } = renderRow(
      session({ worktree: { path: "/tmp/wt", branch: "agent/fix", repoPath: "/Users/test/developer/zorvo" } }),
    );
    const mark = within(row).getByLabelText("Runs in its own worktree");
    const name = within(row).getByText("Qwen Code");
    expect(mark.parentElement).toBe(name.parentElement);
    expect(mark.parentElement?.firstElementChild).toBe(mark);
  });

  it("opens its actions on right-click, in place of WebKit's menu", () => {
    const { row } = renderRow(session(), { onDeleteSession: vi.fn(), onPinSession: vi.fn() });
    // fireEvent returns false when the default was prevented.
    expect(fireEvent.contextMenu(row)).toBe(false);
    expect(screen.getByRole("menu", { name: "Actions for A session" })).toBeInTheDocument();
  });

  it("ends a fork's subtitle with fork", () => {
    const { row } = renderRow(session({ id: "s-fork", forkedFrom: "s-0" }));
    expect(within(row).getByText(/· fork$/)).toBeInTheDocument();
  });

  it("asks Delete? in the row itself, focused, after the menu closes", () => {
    const onDeleteSession = vi.fn();
    const { row } = renderRow(session(), { onDeleteSession });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("menu")).toBeNull();
    const confirm = within(row).getByRole("button", { name: "Confirm delete" });
    expect(confirm).toHaveTextContent("Delete?");
    expect(confirm).toHaveClass("h-6", "bg-danger-surface", "text-danger");
    expect(confirm).toHaveFocus();
    expect(onDeleteSession).not.toHaveBeenCalled();
    // Return on a focused button is a click.
    fireEvent.click(confirm);
    expect(onDeleteSession).toHaveBeenCalledWith("s-1");
  });

  it("gives up on Escape, with focus back on the row's menu button", () => {
    const onDeleteSession = vi.fn();
    const { row } = renderRow(session(), { onDeleteSession });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    fireEvent.keyDown(within(row).getByRole("button", { name: "Confirm delete" }), { key: "Escape" });

    expect(within(row).queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(within(row).getByRole("button", { name: "More actions for A session" })).toHaveFocus();
    expect(onDeleteSession).not.toHaveBeenCalled();
  });

  it("turns the confirm back by itself", () => {
    vi.useFakeTimers();
    const { row } = renderRow(session(), { onDeleteSession: vi.fn() });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    act(() => vi.advanceTimersByTime(CONFIRM_DELETE_MS));
    expect(within(row).queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(within(row).getByRole("button", { name: "More actions for A session" })).toBeInTheDocument();
  });

  it("offers no Delete or Archive while the agent works, and drops an open confirm when it starts", () => {
    const idle = { onDeleteSession: vi.fn(), onArchiveSession: vi.fn() };
    const { rerender } = renderRow(session(), idle);
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();

    rerender(tree(session(), { ...idle, isSessionBusy: () => true }));
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    openMenu("A session");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();

    rerender(tree(session(), idle));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("keeps the row's fill and dot while it is renamed, with a hint", () => {
    renderRow(session(), { isSessionBusy: () => true, onStopSession: vi.fn() });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const field = screen.getByRole("textbox", { name: "Rename A session" });
    const renaming = screen.getByTestId("session-row-s-1");
    expect(renaming).toContainElement(field);
    expect(renaming).toHaveClass("bg-surface-hover");
    expect(renaming.querySelector(".bg-status-running")).not.toBeNull();
    expect(within(renaming).getByText("Return saves, Esc cancels")).toHaveClass("text-fg-subtle");
    expect(field).toHaveClass("h-6.5", "border-fg", "bg-bg");
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
