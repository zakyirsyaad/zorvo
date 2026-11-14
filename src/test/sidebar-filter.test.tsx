import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Sidebar } from "../components/Sidebar";
import { claudeProfile, qwenProfile } from "./fixtures/agents";
import type { Session } from "../types";

const FOLDER = "/Users/test/developer/zorvo";
const OTHER = "/Users/test/developer/site";
const agents = [claudeProfile, qwenProfile];

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    profileId: "claude-acp",
    cwd: FOLDER,
    status: "terminated",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  };
}

interface Options {
  busy?: string[];
  waiting?: string[];
  activeSessionId?: string;
}

function renderSidebar(sessions: Session[], { busy = [], waiting = [], activeSessionId }: Options = {}) {
  const onSelectSession = vi.fn();
  render(
    <Sidebar
      workspaces={[
        { name: "zorvo", path: FOLDER },
        { name: "site", path: OTHER },
      ]}
      sessions={sessions}
      activeSessionId={activeSessionId}
      agents={agents}
      isSessionBusy={(id) => busy.includes(id)}
      isSessionWaiting={(id) => waiting.includes(id)}
      onNewSession={vi.fn()}
      onSelectSession={onSelectSession}
    />,
  );
  return { onSelectSession };
}

const searchButton = () => screen.getByRole("button", { name: "Search sessions" });
const filterButton = (name: RegExp | string) =>
  within(screen.getByRole("group", { name: "Filter sessions" })).getByRole("button", { name });
const rowIds = () =>
  screen
    .queryAllByTestId(/^session-row-(?!actions$)/)
    .map((el) => el.getAttribute("data-testid")?.replace("session-row-", ""));

const mixed = () => [
  session("waits"),
  session("unread", { hasUnread: true }),
  session("busy-a"),
  session("busy-b", { cwd: OTHER }),
  session("idle"),
];
const mixedOptions: Options = { waiting: ["waits"], busy: ["busy-a", "busy-b"] };

describe("sidebar search", () => {
  it("shows New session and a Search button first, and no text field", () => {
    renderSidebar([session("a")]);
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
    expect(searchButton()).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("swaps New session for a focused field, which narrows the list as before", () => {
    renderSidebar([session("alpha"), session("beta")]);
    fireEvent.click(searchButton());
    const field = screen.getByRole("textbox", { name: "Search sessions" });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("placeholder", "Search sessions");
    expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
    fireEvent.change(field, { target: { value: "alp" } });
    expect(rowIds()).toEqual(["alpha"]);
  });

  it("closes on Escape, clears the query and returns focus to the Search button", () => {
    renderSidebar([session("alpha"), session("beta")]);
    fireEvent.click(searchButton());
    const field = screen.getByRole("textbox", { name: "Search sessions" });
    fireEvent.change(field, { target: { value: "alp" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(searchButton()).toHaveFocus();
    expect(rowIds()).toEqual(["alpha", "beta"]);
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
  });

  it("closes and clears with the Close search button", () => {
    renderSidebar([session("alpha"), session("beta")]);
    fireEvent.click(searchButton());
    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), { target: { value: "alp" } });
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(searchButton()).toHaveFocus();
    expect(rowIds()).toEqual(["alpha", "beta"]);
  });
});

describe("sidebar filter", () => {
  it("starts on All with the counts of what needs you and what works", () => {
    renderSidebar(mixed(), mixedOptions);
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    expect(filterButton(/^Needs you/)).toHaveAccessibleName("Needs you 2");
    expect(filterButton(/^Working/)).toHaveAccessibleName("Working 2");
    expect(filterButton(/^Needs you/)).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no count for zero", () => {
    renderSidebar([session("idle")]);
    expect(filterButton(/^Needs you/)).toHaveAccessibleName("Needs you");
    expect(filterButton(/^Working/)).toHaveAccessibleName("Working");
  });

  it("leaves only the rows that need you, hides folders with no match, and toggles back", () => {
    renderSidebar(mixed(), mixedOptions);
    fireEvent.click(filterButton(/^Needs you/));
    expect(filterButton(/^Needs you/)).toHaveAttribute("aria-pressed", "true");
    expect(rowIds()).toEqual(["waits", "unread"]);
    expect(screen.queryByRole("button", { name: /site/ })).toBeNull();
    fireEvent.click(filterButton(/^Needs you/));
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    expect(rowIds()).toHaveLength(5);
    fireEvent.click(filterButton(/^Working/));
    expect(rowIds()).toEqual(["busy-a", "busy-b"]);
    fireEvent.click(filterButton("All"));
    expect(rowIds()).toHaveLength(5);
  });

  it("filters Pinned like the rest, and shows Archived only under All", () => {
    renderSidebar(
      [session("p-busy", { pinned: true }), session("p-idle", { pinned: true }), session("old", { archivedAt: 5 })],
      { busy: ["p-busy"] },
    );
    expect(screen.getByRole("button", { name: "Archived (1)" })).toBeInTheDocument();
    fireEvent.click(filterButton(/^Working/));
    expect(within(screen.getByRole("list", { name: "Pinned sessions" })).getAllByTestId(/^session-row-(?!actions$)/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Archived/ })).toBeNull();
  });

  it("keeps a fork under its parent when both match", () => {
    renderSidebar([session("parent"), session("child", { forkedFrom: "parent" })], { busy: ["parent", "child"] });
    fireEvent.click(filterButton(/^Working/));
    const parent = screen.getByTestId("session-row-parent").closest("li") as HTMLElement;
    expect(parent).toContainElement(screen.getByTestId("session-row-child"));
  });

  it("keeps a non-matching parent as the source of a matching fork", () => {
    renderSidebar([session("parent"), session("child", { forkedFrom: "parent" })], { busy: ["child"] });
    fireEvent.click(filterButton(/^Working/));
    expect(rowIds()).toEqual(["parent", "child"]);
  });

  it("says so when nothing needs you or works", () => {
    renderSidebar([session("idle")]);
    fireEvent.click(filterButton(/^Working/));
    expect(screen.getByText("No sessions are working.")).toBeInTheDocument();
    fireEvent.click(filterButton(/^Needs you/));
    expect(screen.getByText("No sessions need you.")).toBeInTheDocument();
  });

  it("narrows further with a query", () => {
    renderSidebar([session("busy-a"), session("busy-b"), session("idle-a")], { busy: ["busy-a", "busy-b"] });
    fireEvent.click(filterButton(/^Working/));
    fireEvent.click(searchButton());
    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), { target: { value: "busy-a" } });
    expect(rowIds()).toEqual(["busy-a"]);
  });

  it("moves a session that finishes from Working to Needs you, with fresh counts", () => {
    const sessions = [session("a")];
    const props = {
      workspaces: [{ name: "zorvo", path: FOLDER }],
      agents,
      onNewSession: vi.fn(),
      onSelectSession: vi.fn(),
    };
    const { rerender } = render(<Sidebar {...props} sessions={sessions} isSessionBusy={() => true} />);
    fireEvent.click(filterButton(/^Working/));
    expect(rowIds()).toEqual(["a"]);
    rerender(<Sidebar {...props} sessions={[session("a", { hasUnread: true })]} isSessionBusy={() => false} />);
    expect(rowIds()).toEqual([]);
    expect(filterButton(/^Needs you/)).toHaveAccessibleName("Needs you 1");
    expect(filterButton(/^Working/)).toHaveAccessibleName("Working");
  });

  it("never changes the selection when the open session drops out of the list", () => {
    const { onSelectSession } = renderSidebar([session("open"), session("busy")], {
      busy: ["busy"],
      activeSessionId: "open",
    });
    fireEvent.click(filterButton(/^Working/));
    expect(screen.queryByTestId("session-row-open")).toBeNull();
    expect(screen.getByTestId("session-row-busy")).toBeInTheDocument();
    expect(onSelectSession).not.toHaveBeenCalled();
  });
});

describe("folder header", () => {
  it("shows an open folder's session count before its actions", () => {
    renderSidebar([session("a"), session("b"), session("c", { forkedFrom: "a" })]);
    const heading = screen.getByRole("button", { name: /zorvo/ });
    const count = within(heading.parentElement as HTMLElement).getByText("3");
    expect(count).toHaveClass("text-fg-subtle");
  });
});
