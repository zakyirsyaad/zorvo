import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CompareRunPanel, type CompareRunPanelProps } from "../components/compare/CompareRunPanel";
import type { RowFacts } from "../lib/compare-run";
import type { Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const NAMES: Record<string, string> = { "claude-acp": "Claude Code", "qwen-code": "Qwen Code" };
const MIN = 60_000;
const NOW = 1_000 * MIN;

function session(n: number): Session {
  return {
    id: `s-${n}`,
    name: "Fix the login",
    profileId: ["claude-acp", "qwen-code"][n - 1],
    cwd: `/wt/${n}`,
    status: "running",
    createdAt: NOW - 30 * MIN,
    transport: "acp",
    compareRunId: "run-1",
    acpSessionId: `acp-${n}`,
    worktree: { repoPath: "/repo", path: `/wt/${n}`, branch: `agent/fix-${n}`, startCommit: String(n).repeat(40) },
  };
}

function facts(n: number, overrides: Partial<RowFacts> = {}): RowFacts {
  return {
    session: session(n),
    isBusy: false,
    hasStarted: true,
    pendingCard: null,
    hasOpenForm: false,
    needsSignIn: false,
    failed: false,
    turnStartedAt: NOW - 20 * MIN,
    hasUnread: false,
    ...overrides,
  };
}

const stat = (path: string, added: number, removed: number) => ({ path, oldPath: null, kind: "modified", added, removed, isBinary: false, fingerprint: path });

function answerDiffs(byPath: Record<string, unknown>) {
  vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd !== "session_diff_stats_since") return Promise.resolve(cmd === "get_agent_icons" ? {} : undefined);
    return Promise.resolve(byPath[String(args?.path)] ?? []);
  });
}

function props(rows: RowFacts[]): CompareRunPanelProps {
  return {
    run: { id: "run-1", name: "Fix the login", sessions: rows.map((row) => row.session) },
    rows,
    version: 0,
    agentName: (profileId) => NAMES[profileId] ?? profileId,
    onOpen: vi.fn(),
    onReview: vi.fn(),
    onChoose: vi.fn(),
    onPick: vi.fn(),
  };
}

async function renderPanel(rows: RowFacts[]) {
  render(<CompareRunPanel {...props(rows)} />);
  await act(async () => {});
}

const cardOf = (name: string) => screen.getByRole("listitem", { name });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the compare run as drawn", () => {
  it("a card is one row with a logo tile, the status and its buttons", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 54, 9)] });
    await renderPanel([facts(1)]);

    const card = cardOf("Claude Code");
    expect(card).toHaveClass("bg-surface-2", "py-3.5", "px-4");
    expect(card.querySelector(".size-7.bg-surface-hover")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open Claude Code" }).className).toContain("border-transparent");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pick Claude Code" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Pick Claude Code" }).className).toContain("border-border-strong");
    expect(within(card).getByRole("button", { name: "Review Claude Code's changes" })).toHaveTextContent("1 file+54−9");
  });

  it("a finished unread card shows the unread dot", async () => {
    answerDiffs({});
    await renderPanel([facts(1, { hasUnread: true })]);

    expect(within(cardOf("Claude Code")).getByText("Finished")).toBeInTheDocument();
    expect(cardOf("Claude Code").querySelector(".bg-status-unread")).not.toBeNull();
  });

  it("the working time moves on with the clock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    answerDiffs({});
    await renderPanel([facts(1, { isBusy: true, turnStartedAt: NOW - 12 * MIN })]);

    expect(within(cardOf("Claude Code")).getByText("Working · 12 min")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(MIN));
    expect(within(cardOf("Claude Code")).getByText("Working · 13 min")).toBeInTheDocument();
  });

  it("with no changes the card reads No changes yet", async () => {
    answerDiffs({ "/wt/1": [] });
    await renderPanel([facts(1)]);

    await waitFor(() => expect(within(cardOf("Claude Code")).getByText("No changes yet")).toHaveClass("text-fg-subtle"));
    expect(screen.getByRole("button", { name: "Pick Claude Code" })).toBeDisabled();
  });

  it("picking marks the card and its Pick", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    await renderPanel([facts(1), facts(2)]);
    const pick = screen.getByRole("button", { name: "Pick Claude Code" });
    await waitFor(() => expect(pick).toBeEnabled());

    fireEvent.click(pick);

    expect(cardOf("Claude Code")).toHaveClass("border-border-strong");
    expect(pick).toHaveAttribute("aria-pressed", "true");
    expect(cardOf("Qwen Code")).not.toHaveClass("border-border-strong");
  });

  it("the confirm bar floats as one sentence", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    await renderPanel([facts(1), facts(2, { isBusy: true })]);
    const pick = screen.getByRole("button", { name: "Pick Claude Code" });
    await waitFor(() => expect(pick).toBeEnabled());

    fireEvent.click(pick);

    const bar = screen.getByRole("group", { name: "Confirm pick" });
    expect(bar).toHaveClass("absolute", "bg-surface-3");
    expect(bar.closest(".overflow-y-auto")).toBeNull();
    expect(within(bar).getByText("Keep Claude Code's work and archive the others? Qwen Code is still working and will be stopped.")).toBeInTheDocument();
  });

  it("the card keeps its buttons when the name is long", async () => {
    answerDiffs({});
    await renderPanel([facts(1)]);

    const name = within(cardOf("Claude Code")).getByText("Claude Code");
    expect(name).toHaveClass("truncate");
    expect(name.parentElement).toHaveClass("min-w-0", "flex-1");
  });
});
