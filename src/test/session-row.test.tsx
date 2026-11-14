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

const WORKTREE = { path: "/tmp/wt", branch: "agent/fix", repoPath: "/Users/test/developer/zorvo" };

function runRow(target: Session, overrides: Partial<SessionListContext> = {}) {
  const view = render(
    <SessionTree nodes={[{ session: target, children: [] }]} label="Agents" context={context(overrides)} isInRun />,
  );
  return { row: screen.getByTestId(`session-row-${target.id}`), ...view };
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

  it("starts with a 22px tile holding the agent's logo, and no logo in line two", () => {
    const { row } = renderRow(session({ profileId: "qwen-code" }));
    const button = within(row).getByText("A session").closest("button") as HTMLElement;
    const tile = button.firstElementChild as HTMLElement;
    expect(tile).toHaveClass("size-[22px]");
    expect(tile.querySelector("img, svg")).not.toBeNull();
    const line = within(row).getByText("Qwen Code").parentElement as HTMLElement;
    expect(line.querySelector("img, svg:not([aria-label])")).toBeNull();
  });

  it.each([
    ["waiting", { isSessionWaiting: () => true }, {}, "bg-status-attention"],
    ["working", { isSessionBusy: () => true }, {}, "bg-status-running"],
    ["unread", {}, { hasUnread: true }, "bg-status-unread"],
  ] as const)("badges a %s row's tile", (_name, overrides, extra, fill) => {
    const { row } = renderRow(session(extra), overrides);
    expect(row.querySelector("[data-badge]")).toHaveClass(fill);
  });

  it("badges an idle row's tile with nothing", () => {
    const { row } = renderRow(session());
    expect(row.querySelector("[data-badge]")).toBeNull();
  });

  it("rings the badge in the row's fill: surface-hover when open, ground and then hover otherwise", () => {
    const open = renderRow(session(), { activeSessionId: "s-1", isSessionBusy: () => true });
    expect(open.row.querySelector("[data-badge]")).toHaveClass("ring-surface-hover");
    open.unmount();
    const other = renderRow(session(), { isSessionBusy: () => true });
    expect(other.row.querySelector("[data-badge]")).toHaveClass("ring-ground", "group-hover:ring-surface-hover");
  });

  it("shows an idle row's short time at the right of line one, and only the agent in line two", () => {
    const createdAt = Date.now() - 2 * 60_000;
    const { row } = renderRow(session({ createdAt }));
    expect(within(row).getByText("2 min ago")).toHaveClass("text-caption", "text-fg-subtle", "shrink-0");
    const line = within(row).getByText("Qwen Code").parentElement as HTMLElement;
    expect(line.textContent?.trim()).toBe("Qwen Code");
  });

  it("shows no time on a row with a status, and words the status after the agent", () => {
    const { row } = renderRow(session({ createdAt: Date.now() - 2 * 60_000 }), { isSessionBusy: () => true });
    expect(within(row).queryByText("2 min ago")).toBeNull();
    const line = within(row).getByText("Qwen Code").parentElement as HTMLElement;
    expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe("Qwen Code · Working");
  });

  it("hands the time's place to the actions on hover or focus", () => {
    const { row } = renderRow(session({ createdAt: Date.now() - 2 * 60_000 }));
    expect(within(row).getByText("2 min ago")).toHaveClass("group-hover:hidden", "group-focus-within:hidden");
  });

  it("draws an idle run member as one centred line, with no lone worktree glyph", () => {
    const { row } = runRow(session({ worktree: WORKTREE }));
    expect(within(row).queryByLabelText("Runs in its own worktree")).toBeNull();
    const button = within(row).getByText("Qwen Code").closest("button") as HTMLElement;
    expect(button).toHaveClass("items-center");
    expect(button).not.toHaveClass("items-start");
    expect(button.querySelector(".text-caption.text-fg-subtle:not(.shrink-0)")).toBeNull();
  });

  it("keeps a run member's second line, with the worktree mark, while it has a status", () => {
    const { row } = runRow(session({ worktree: WORKTREE }), { isSessionBusy: () => true });
    expect(within(row).getByLabelText("Runs in its own worktree")).toBeInTheDocument();
    expect(within(row).getByText(/Working$/)).toBeInTheDocument();
    expect(within(row).getByText("Qwen Code").closest("button")).toHaveClass("items-start");
  });

  it("pads its button as drawn", () => {
    const { row } = renderRow(session());
    expect(within(row).getByText("A session").closest("button")).toHaveClass("rounded-lg", "px-2", "py-[7px]", "gap-2.5");
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

  it("marks a private session with a shield in its subtitle", () => {
    const { row } = renderRow(session({ privateMode: { modelId: "Qwen/Qwen3.8-27B" } }));
    const mark = within(row).getByRole("img", { name: "Private session" });
    expect(mark.parentElement).toBe(within(row).getByText("Qwen Code").parentElement);
    expect(within(row).getByText(/· Private/)).toBeInTheDocument();
  });

  it("marks no ordinary session as private", () => {
    const { row } = renderRow(session());
    expect(within(row).queryByRole("img", { name: "Private session" })).toBeNull();
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

  it("keeps the row's fill and tile while it is renamed, with a hint", () => {
    renderRow(session(), { isSessionBusy: () => true, onStopSession: vi.fn() });
    openMenu("A session");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const field = screen.getByRole("textbox", { name: "Rename A session" });
    const renaming = screen.getByTestId("session-row-s-1");
    expect(renaming).toContainElement(field);
    expect(renaming).toHaveClass("bg-surface-hover");
    expect(renaming.querySelector(".size-\\[22px\\]")).not.toBeNull();
    expect(renaming.querySelector(".bg-status-running")).not.toBeNull();
    expect(within(renaming).getByText("Return saves, Esc cancels")).toHaveClass("text-fg-subtle");
    expect(field).toHaveClass("h-6.5", "border-fg", "bg-ground");
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
