import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { CompareRunPanel, type CompareRunPanelProps } from "../components/compare/CompareRunPanel";
import { useCompareRun, type CompareRunDeps } from "../hooks/useCompareRun";
import { rowFactsOf, rowStatus, type CompareRun, type RowFacts } from "../lib/compare-run";
import type { ActionCard, ChatMessage, Session } from "../types";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const NAMES: Record<string, string> = { "claude-acp": "Claude Code", "qwen-code": "Qwen Code", kimi: "Kimi CLI" };

function session(n: number, overrides: Partial<Session> = {}): Session {
  const profileId = ["claude-acp", "qwen-code", "kimi"][n - 1];
  return {
    id: `s-${n}`,
    name: "Fix the login",
    profileId,
    cwd: `/wt/${n}`,
    status: "running",
    createdAt: n,
    transport: "acp",
    compareRunId: "run-1",
    acpSessionId: `acp-${n}`,
    worktree: { repoPath: "/repo", path: `/wt/${n}`, branch: `agent/fix-${n}`, startCommit: String(n).repeat(40) },
    ...overrides,
  };
}

function facts(n: number, overrides: Partial<RowFacts> = {}, sessionOverrides: Partial<Session> = {}): RowFacts {
  return {
    session: session(n, sessionOverrides),
    isBusy: false,
    hasStarted: true,
    pendingCard: null,
    hasOpenForm: false,
    needsSignIn: false,
    failed: false,
    ...overrides,
  };
}

function runOf(rows: RowFacts[]): CompareRun {
  return { id: "run-1", name: "Fix the login", sessions: rows.map((r) => r.session) };
}

function card(overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    id: "card-1",
    sessionId: "s-1",
    title: "Permission requested",
    prompt: "Run rm -rf build?",
    status: "pending",
    timestamp: 1,
    requestId: 7,
    options: [
      { optionId: "allow", name: "Allow once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
    ...overrides,
  };
}

/** The line counts `session_diff_stats_since` answers with, by the worktree's folder. */
function answerDiffs(byPath: Record<string, unknown>) {
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "get_agent_icons") return Promise.resolve({});
    if (cmd !== "session_diff_stats_since") return Promise.resolve(undefined);
    const answer = byPath[String(args?.path)];
    return answer instanceof Error ? Promise.reject(answer.message) : Promise.resolve(answer ?? []);
  });
}

const stat = (path: string, added: number, removed: number) => ({
  path,
  oldPath: null,
  kind: "modified",
  added,
  removed,
  isBinary: false,
  fingerprint: path + added + removed,
});

function props(rows: RowFacts[], overrides: Partial<CompareRunPanelProps> = {}): CompareRunPanelProps {
  return {
    run: runOf(rows),
    rows,
    version: 0,
    agentName: (profileId) => NAMES[profileId] ?? profileId,
    onOpen: vi.fn(),
    onChoose: vi.fn(),
    onPick: vi.fn(),
    ...overrides,
  };
}

async function renderPanel(p: CompareRunPanelProps) {
  const view = render(<CompareRunPanel {...p} />);
  await act(async () => {});
  return view;
}

const rowOf = (name: string) => screen.getByRole("listitem", { name });

describe("CompareRunPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows each status with its label", async () => {
    answerDiffs({});
    await renderPanel(
      props([
        facts(1, { isBusy: true }),
        facts(2, { failed: true }),
        facts(3, { pendingCard: card({ sessionId: "s-3" }) }),
      ]),
    );

    expect(within(rowOf("Claude Code")).getByText("Working")).toBeInTheDocument();
    expect(within(rowOf("Qwen Code")).getByText("Failed")).toBeInTheDocument();
    expect(within(rowOf("Kimi CLI")).getByText("Needs you")).toBeInTheDocument();
  });

  it("shows files, added and removed from useDiffStatsSince", async () => {
    const spy = answerDiffs({
      "/wt/1": [stat("a.ts", 10, 2), stat("b.ts", 5, 1)],
      "/wt/2": [stat("c.ts", 1, 0)],
    });
    await renderPanel(props([facts(1), facts(2)]));

    await waitFor(() => expect(within(rowOf("Claude Code")).getByText("2 files")).toBeInTheDocument());
    expect(within(rowOf("Claude Code")).getByText("+15")).toBeInTheDocument();
    expect(within(rowOf("Claude Code")).getByText("−3")).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf("Qwen Code")).getByText("1 file")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith("session_diff_stats_since", { path: "/wt/1", commit: "1".repeat(40) }, undefined);
  });

  it("shows — when the diff cannot be read and keeps the other rows", async () => {
    answerDiffs({ "/wt/1": new Error("not a repository"), "/wt/2": [stat("c.ts", 4, 1)] });
    await renderPanel(props([facts(1), facts(2)]));

    await waitFor(() => expect(within(rowOf("Qwen Code")).getByText("1 file")).toBeInTheDocument());
    expect(within(rowOf("Claude Code")).getByText("—")).toBeInTheDocument();
    expect(within(rowOf("Claude Code")).getByText("Done")).toBeInTheDocument();
  });

  it("reads the numbers again when the version changes", async () => {
    const spy = answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    const rows = [facts(1), facts(2)];
    const { rerender } = await renderPanel(props(rows, { version: 0 }));
    const reads = () => spy.mock.calls.filter(([cmd]) => cmd === "session_diff_stats_since").length;
    await waitFor(() => expect(reads()).toBe(2));

    rerender(<CompareRunPanel {...props(rows, { version: 1 })} />);

    await waitFor(() => expect(reads()).toBe(4));
  });

  it("a permission request shows the agent's own options in the row", async () => {
    answerDiffs({});
    await renderPanel(props([facts(1, { pendingCard: card() }), facts(2)]));

    const row = within(rowOf("Claude Code"));
    expect(row.getByText("Run rm -rf build?")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(rowOf("Qwen Code")).queryByRole("button", { name: "Allow once" })).toBeNull();
  });

  it("answering it calls chooseOption for that session", async () => {
    answerDiffs({});
    const p = props([facts(1), facts(2, { pendingCard: card({ sessionId: "s-2", id: "card-2" }) })]);
    await renderPanel(p);

    fireEvent.click(within(rowOf("Qwen Code")).getByRole("button", { name: "Allow once" }));

    expect(p.onChoose).toHaveBeenCalledWith("s-2", "card-2", "allow");
  });

  it("a request answered in the chat leaves the row", async () => {
    answerDiffs({});
    const { rerender } = await renderPanel(props([facts(1, { pendingCard: card() }), facts(2)]));
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();

    rerender(<CompareRunPanel {...props([facts(1, { isBusy: true }), facts(2)])} />);

    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(within(rowOf("Claude Code")).getByText("Working")).toBeInTheDocument();
  });

  it("the agent's name opens its chat, and the row holds no nested buttons", async () => {
    answerDiffs({});
    const p = props([facts(1, { pendingCard: card() }), facts(2)]);
    await renderPanel(p);

    fireEvent.click(within(rowOf("Qwen Code")).getByRole("button", { name: "Open Qwen Code" }));

    expect(p.onOpen).toHaveBeenCalledWith("s-2");
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(document.querySelectorAll("button button")).toHaveLength(0);
  });

  it("a form reads Needs you and the row opens the chat", async () => {
    answerDiffs({});
    const p = props([facts(1, { hasOpenForm: true }), facts(2)]);
    await renderPanel(p);

    expect(within(rowOf("Claude Code")).getByText("Needs you")).toBeInTheDocument();
    fireEvent.click(within(rowOf("Claude Code")).getByRole("button", { name: "Open Claude Code" }));

    expect(p.onOpen).toHaveBeenCalledWith("s-1");
  });

  it("Pick with nothing running stops nothing and asks nothing", async () => {
    answerDiffs({});
    const p = props([facts(1), facts(2, {}, { status: "terminated" }), facts(3, { failed: true })]);
    await renderPanel(p);

    fireEvent.click(screen.getByRole("button", { name: "Pick Claude Code" }));

    expect(screen.queryByText(/Stop \d+ agents? and keep/)).toBeNull();
    expect(p.onPick).toHaveBeenCalledWith("s-1");
  });

  it("Pick with two running asks with the exact copy, and Cancel changes nothing", async () => {
    answerDiffs({});
    const p = props([facts(1), facts(2, { isBusy: true }), facts(3, { isBusy: true })]);
    await renderPanel(p);

    fireEvent.click(screen.getByRole("button", { name: "Pick Claude Code" }));

    expect(screen.getByText("Stop 2 agents and keep Claude Code's work?")).toBeInTheDocument();
    expect(p.onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/and keep/)).toBeNull();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it("counts one running agent in the singular, and not the idle ones", async () => {
    answerDiffs({});
    await renderPanel(props([facts(1), facts(2, { isBusy: true }), facts(3)]));

    fireEvent.click(screen.getByRole("button", { name: "Pick Claude Code" }));

    expect(screen.getByText("Stop 1 agent and keep Claude Code's work?")).toBeInTheDocument();
  });

  it("drops the question when the working agents finish, and Pick then needs one more press", async () => {
    answerDiffs({});
    const rows = [facts(1), facts(2, { isBusy: true })];
    const p = props(rows);
    const { rerender } = await renderPanel(p);
    fireEvent.click(screen.getByRole("button", { name: "Pick Claude Code" }));
    expect(screen.getByText("Stop 1 agent and keep Claude Code's work?")).toBeInTheDocument();

    rerender(<CompareRunPanel {...props([facts(1), facts(2)], { onPick: p.onPick })} />);

    expect(screen.queryByText(/and keep/)).toBeNull();
    expect(screen.queryByText(/Stop 0/)).toBeNull();
    expect(p.onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pick Claude Code" }));
    expect(p.onPick).toHaveBeenCalledWith("s-1");
  });

  it("Stop and pick calls onPick once and keeps the buttons off until it is done", async () => {
    answerDiffs({});
    let finish!: () => void;
    const onPick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderPanel(props([facts(1), facts(2, { isBusy: true })], { onPick }));

    fireEvent.click(screen.getByRole("button", { name: "Pick Claude Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop and pick" }));
    await act(async () => {});

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("s-1");
    expect(screen.getByRole("button", { name: "Pick Qwen Code" })).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Pick Qwen Code" })).toBeEnabled();
  });
});

describe("rowFactsOf", () => {
  const sources = (overrides: Partial<Parameters<typeof rowFactsOf>[1]> = {}) => ({
    isBusy: () => false,
    transcripts: {},
    failedTurns: {},
    signInNeeded: new Map<string, unknown>(),
    ...overrides,
  });
  const agentMessage = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: content,
    role: "agent",
    content,
    timestamp: 1,
    ...extra,
  });

  it("reads the refusals it is handed, for those sessions only", () => {
    const run = runOf([facts(1), facts(2)]);

    const rows = rowFactsOf(run, sources({ signInNeeded: new Map([["s-2", {}]]) }));

    expect(rows.map((row) => row.needsSignIn)).toEqual([false, true]);
  });

  it("reads each session's own transcript, not the active one", () => {
    const run = runOf([facts(1), facts(2)]);
    const [first, second] = rowFactsOf(run, sources({
      isBusy: (id) => id === "s-2",
      transcripts: { "s-2": [agentMessage("", { actionCard: card({ sessionId: "s-2" }) })] },
    }));

    expect(first.pendingCard).toBeNull();
    expect(second.pendingCard?.id).toBe("card-1");
  });

  it("marks a session started by its agent session id or any agent message", () => {
    const run = runOf([
      facts(1, {}, { acpSessionId: null }),
      facts(2, {}, { acpSessionId: null }),
      facts(3, {}, { acpSessionId: "acp-3" }),
    ]);
    const rows = rowFactsOf(run, sources({ transcripts: { "s-2": [agentMessage("Hello")] } }));

    expect(rows.map((r) => r.hasStarted)).toEqual([false, true, true]);
  });

  it("marks a failed turn, and an agent that ended with a non-zero exit code, as failed", () => {
    const run = runOf([
      facts(1),
      facts(2, {}, { status: "terminated", exitCode: 1 }),
      facts(3, {}, { status: "terminated", exitCode: 0 }),
    ]);
    const rows = rowFactsOf(run, sources({ failedTurns: { "s-1": "fetch failed" } }));

    expect(rows.map((r) => r.failed)).toEqual([true, true, false]);
  });

  it("reads Stopped, not Needs you, for a saved request whose agent is gone", () => {
    const saved = [agentMessage("", { actionCard: card({ sessionId: "s-1" }) })];
    const form = agentMessage("", {
      elicitation: { key: "e", status: "pending" } as unknown as NonNullable<ChatMessage["elicitation"]>,
    });
    const run = runOf([
      facts(1, {}, { status: "terminated" }),
      facts(2, {}, { status: "terminated" }),
      facts(3, {}, { status: "running" }),
    ]);
    const rows = rowFactsOf(run, sources({
      isBusy: () => false,
      transcripts: { "s-1": saved, "s-2": [form], "s-3": saved },
    }));

    expect(rows.map((r) => rowStatus(r))).toEqual(["stopped", "stopped", "done"]);
    expect(rows.map((r) => [r.pendingCard, r.hasOpenForm])).toEqual([[null, false], [null, false], [null, false]]);
  });

  it("marks an open form and the busy ones", () => {
    const run = runOf([facts(1), facts(2)]);
    const form = agentMessage("", {
      elicitation: { key: "e", status: "pending" } as unknown as NonNullable<ChatMessage["elicitation"]>,
    });
    const rows = rowFactsOf(run, sources({ isBusy: (id) => id === "s-2", transcripts: { "s-1": [form] } }));
    // facts() sessions are running, so the form of s-1 is live.

    expect(rows.map((r) => [r.hasOpenForm, r.isBusy])).toEqual([[true, false], [false, true]]);
  });
});

describe("useCompareRun pick", () => {
  function setup(sessions: Session[], options: { cannotStop?: string[] } = {}) {
    let listed = sessions.map((s) => ({ ...s }));
    const notices: string[] = [];
    const opened: string[] = [];
    const log: string[] = [];
    const archive = vi.fn(async (id: string, isArchived: boolean) => {
      log.push(`start ${id}`);
      await Promise.resolve();
      log.push(`end ${id}`);
      if (options.cannotStop?.includes(id)) {
        notices.push(`Did not archive "Fix the login": its agent could not be stopped.`);
        return;
      }
      listed = listed.map((s) => (s.id === id ? { ...s, archivedAt: isArchived ? 1 : null } : s));
    });
    const deps: CompareRunDeps = {
      repoPath: "/repo",
      baseBranch: undefined,
      agentOptions: undefined,
      startSession: vi.fn(),
      isOnDraft: () => true,
      openRun: vi.fn(),
      setIsBusy: vi.fn(),
      restoreMessage: vi.fn(),
      onStarted: vi.fn(),
      archiveSession: archive,
      readSessions: () => listed,
      openSession: (id: string) => opened.push(id),
      agentName: (profileId: string) => NAMES[profileId] ?? profileId,
      onNotice: (message: string) => notices.push(message),
      sessions: listed,
      sources: { isBusy: () => false, transcripts: {}, failedTurns: {} },
      askSignIn: vi.fn(),
      notifyRun: vi.fn(),
    };
    const { result } = renderHook(() => useCompareRun(deps));
    return { pick: result.current.pick, archive, notices, opened, log };
  }

  const three = [session(1), session(2, { status: "terminated" }), session(3)];
  const run = (sessions: Session[]): CompareRun => ({ id: "run-1", name: "Fix the login", sessions });

  it("archives every other session, one at a time, then opens the winner", async () => {
    const { pick, archive, opened, log } = setup(three);

    await act(async () => pick(run(three), "s-1"));

    expect(log).toEqual(["start s-2", "end s-2", "start s-3", "end s-3"]);
    expect(archive.mock.calls.map(([id, isArchived]) => [id, isArchived])).toEqual([["s-2", true], ["s-3", true]]);
    expect(opened).toEqual(["s-1"]);
  });

  it("an agent that cannot be stopped stays listed, is named, and the group stays", async () => {
    const { pick, notices, opened } = setup(three, { cannotStop: ["s-3"] });

    await act(async () => pick(run(three), "s-1"));

    expect(opened).toEqual([]);
    expect(notices.at(-1)).toBe("Kimi CLI could not be stopped, so it is still in the run.");
  });

  it("a second pick while one runs does nothing, even from another panel", async () => {
    const { pick, archive, opened } = setup(three);
    let release!: () => void;
    const archiveNormally = archive.getMockImplementation()!;
    const gate = new Promise<void>((resolve) => (release = resolve));
    archive.mockImplementationOnce(async (id, isArchived) => {
      await gate;
      await archiveNormally(id, isArchived);
    });

    let first!: Promise<void>;
    await act(async () => {
      first = pick(run(three), "s-1");
      await pick(run(three), "s-3");
    });
    expect(archive).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await first;
    });

    // Only the first pick's archives ran: the second would have archived s-1.
    expect(archive.mock.calls.map(([id]) => id)).toEqual(["s-2", "s-3"]);
    expect(opened).toEqual(["s-1"]);
  });

  it("a failed agent can be picked and archived", async () => {
    const sessions = [session(1, { status: "terminated", exitCode: 1 }), session(2)];
    const { pick, archive, opened } = setup(sessions);

    await act(async () => pick(run(sessions), "s-1"));
    expect(archive).toHaveBeenCalledWith("s-2", true);
    expect(opened).toEqual(["s-1"]);

    const again = setup(sessions);
    await act(async () => again.pick(run(sessions), "s-2"));
    expect(again.archive).toHaveBeenCalledWith("s-1", true);
    expect(again.opened).toEqual(["s-2"]);
  });
});

describe("answering a permission request", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a stale option press does nothing", async () => {
    const { useAcpEngine } = await import("../hooks/session-engine/useAcpEngine");
    const { fakeProfiles } = await import("./fixtures/agents");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const answered = card({ status: "rejected", chosenOptionId: "reject" });
    const messages: ChatMessage[] = [{ id: "m", role: "agent", content: "", timestamp: 1, actionCard: answered }];
    const updates = vi.fn();
    const reportError = vi.fn();
    const { result } = renderHook(() =>
      useAcpEngine({
        sessions: [session(1)],
        agents: fakeProfiles,
        updateMessages: updates,
        patchSession: () => {},
        reportError,
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

    act(() => result.current.chooseOption("s-1", messages, "card-1", "allow"));
    await act(async () => {});

    expect(spy.mock.calls.filter(([cmd]) => cmd === "acp_respond_permission")).toHaveLength(0);
    expect(updates).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
