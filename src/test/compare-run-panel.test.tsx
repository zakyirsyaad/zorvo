import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import App from "../App";
import { CompareRunPanel, type CompareRunPanelProps } from "../components/compare/CompareRunPanel";
import { useCompareRun, type CompareRunDeps } from "../hooks/useCompareRun";
import {
  pickQuestion,
  rowFactsOf,
  rowStatus,
  runStatusDot,
  stopsLine,
  type CompareRun,
  type RowFacts,
  type RunRowStatus,
} from "../lib/compare-run";
import type { Status } from "../components/ui/StatusLine";
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

const NAMES: Record<string, string> = {
  "claude-acp": "Claude Code",
  "qwen-code": "Qwen Code",
  kimi: "Kimi CLI",
  opencode: "OpenCode",
};

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
    onReview: vi.fn(),
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

  it("reads the numbers from the agent's folder, the one the backend knows, in a run started from a subfolder", async () => {
    answerDiffs({
      "/wt/1": new Error("/wt/1 is not one of your workspaces"),
      "/wt/1/packages/app": [stat("packages/app/a.ts", 3, 1)],
    });
    await renderPanel(props([facts(1, {}, { cwd: "/wt/1/packages/app" })]));

    await waitFor(() => expect(within(rowOf("Claude Code")).getByText("1 file")).toBeInTheDocument());
    expect(within(rowOf("Claude Code")).getByText("+3")).toBeInTheDocument();
  });

  it("shows — when the diff cannot be read and keeps the other rows", async () => {
    answerDiffs({ "/wt/1": new Error("not a repository"), "/wt/2": [stat("c.ts", 4, 1)] });
    await renderPanel(props([facts(1), facts(2)]));

    await waitFor(() => expect(within(rowOf("Qwen Code")).getByText("1 file")).toBeInTheDocument());
    expect(within(rowOf("Claude Code")).getByText("—")).toBeInTheDocument();
    expect(within(rowOf("Claude Code")).getByText("Done")).toBeInTheDocument();
  });

  it.each<[string, Partial<RowFacts>, Partial<Session>]>([
    ["Failed", { failed: true }, { status: "terminated", exitCode: 3 }],
    ["Stopped", {}, { status: "terminated" }],
    ["Done", {}, {}],
  ])("reads the numbers again when a row goes from Working to %s, with no new version", async (label, rowChange, sessionChange) => {
    const answers = { "/wt/1": [stat("a.ts", 1, 0)] };
    answerDiffs(answers);
    const { rerender } = await renderPanel(props([facts(1, { isBusy: true }), facts(2)]));
    await waitFor(() => expect(within(rowOf("Claude Code")).getByText("+1")).toBeInTheDocument());

    answers["/wt/1"] = [stat("a.ts", 7, 2), stat("b.ts", 1, 0)];
    rerender(<CompareRunPanel {...props([facts(1, rowChange, sessionChange), facts(2)])} />);

    expect(within(rowOf("Claude Code")).getByText(label)).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf("Claude Code")).getByText("+8")).toBeInTheDocument());
    expect(within(rowOf("Claude Code")).getByText("2 files")).toBeInTheDocument();
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

  it("a row's numbers open its diff", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 3, 1)] });
    const p = props([facts(1, {}, { profileId: "opencode" }), facts(2)]);
    await renderPanel(p);

    const review = await within(rowOf("OpenCode")).findByRole("button", { name: "Review OpenCode's changes" });
    expect(review).toHaveTextContent("1 file+3−1");
    fireEvent.click(review);

    expect(p.onReview).toHaveBeenCalledWith("s-1");
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it("a row with no changes or no numbers has no review button", async () => {
    answerDiffs({ "/wt/1": [], "/wt/2": new Error("not a repository") });
    await renderPanel(props([facts(1), facts(2)]));

    await waitFor(() => expect(within(rowOf("Claude Code")).getByText("0 files")).toBeInTheDocument());
    expect(within(rowOf("Qwen Code")).getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Review / })).toBeNull();
  });

  it("a permission request shows the agent's own options in the row", async () => {
    answerDiffs({});
    await renderPanel(props([facts(1, { pendingCard: card() }), facts(2)]));

    const row = within(rowOf("Claude Code"));
    expect(row.getByRole("heading", { name: "Claude Code wants to run rm -rf build?" })).toBeInTheDocument();
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

  it("answering Qwen Code's questions in the row sends the answers for that session", async () => {
    answerDiffs({});
    const questions = [
      { question: "Which editor do you use?", header: "Editor", options: [{ label: "Vim" }, { label: "Zed" }], multiSelect: false },
    ];
    const asking = card({
      sessionId: "s-2",
      id: "card-2",
      options: [
        { optionId: "proceed_once", name: "Submit", kind: "allow_once" },
        { optionId: "cancel", name: "Cancel", kind: "reject_once" },
      ],
      questions,
    });
    const p = props([facts(1), facts(2, { pendingCard: asking })]);
    await renderPanel(p);
    const row = within(rowOf("Qwen Code"));

    fireEvent.click(row.getByRole("radio", { name: "Zed" }));
    fireEvent.click(row.getByRole("button", { name: "Submit" }));

    expect(p.onChoose).toHaveBeenCalledWith("s-2", "card-2", "proceed_once", { "0": "Zed" });
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

  it("heads the run with its name, its agents and when it started", async () => {
    answerDiffs({});
    const started = Date.now() - 12 * 60_000;
    await renderPanel(props([facts(1, {}, { createdAt: started }), facts(2, {}, { createdAt: started + 1 })]));

    expect(screen.getByRole("heading", { name: "Fix the login" })).toBeInTheDocument();
    expect(screen.getByText("2 agents, each in its own worktree · started 12 minutes ago")).toBeInTheDocument();
  });

  it("each agent is a card with its status word, its changes, Open and Pick", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 80, 10), stat("b.ts", 3, 1), stat("c.ts", 2, 1), stat("d.ts", 1, 0)] });
    await renderPanel(props([facts(1, { isBusy: true }, { profileId: "opencode" }), facts(2)]));
    const row = within(rowOf("OpenCode"));

    expect(row.getByText("Working")).toBeInTheDocument();
    expect(await row.findByRole("button", { name: "Review OpenCode's changes" })).toHaveTextContent("4 files+86−12");
    expect(row.getByRole("button", { name: "Open OpenCode" })).toHaveTextContent("Open");
    expect(row.getByRole("button", { name: "Pick OpenCode" })).toBeEnabled();
  });

  it("a row with no changes cannot be picked, and says why", async () => {
    answerDiffs({ "/wt/1": [] });
    await renderPanel(props([facts(1), facts(2)]));

    const pickButton = within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" });
    await waitFor(() => expect(pickButton).toBeDisabled());
    expect(pickButton).toHaveAttribute("title", "No changes to keep yet");
  });

  it("a row whose changes cannot be read can still be picked", async () => {
    answerDiffs({ "/wt/1": new Error("not a repository") });
    await renderPanel(props([facts(1), facts(2)]));

    await waitFor(() => expect(within(rowOf("Claude Code")).getByText("—")).toBeInTheDocument());
    expect(within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" })).toBeEnabled();
  });

  it("Pick with nothing running still asks, and Pick in the bar keeps that agent", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    const p = props([facts(1), facts(2, {}, { status: "terminated" }), facts(3, { failed: true })]);
    await renderPanel(p);
    await within(rowOf("Claude Code")).findByText("+1");

    fireEvent.click(within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" }));

    const bar = within(screen.getByRole("group", { name: "Confirm pick" }));
    expect(bar.getByText("Keep Claude Code's work and archive the others?")).toBeInTheDocument();
    expect(bar.queryByText(/mid-turn/)).toBeNull();
    expect(p.onPick).not.toHaveBeenCalled();
    fireEvent.click(bar.getByRole("button", { name: "Pick Claude Code" }));
    expect(p.onPick).toHaveBeenCalledWith("s-1");
  });

  it("Cancel closes the bar and picks nothing", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    const p = props([facts(1), facts(2, { isBusy: true }), facts(3, { isBusy: true })]);
    await renderPanel(p);
    await within(rowOf("Claude Code")).findByText("+1");

    fireEvent.click(within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" }));
    expect(screen.getByText("This stops Qwen Code and Kimi CLI mid-turn.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("group", { name: "Confirm pick" })).toBeNull();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it("names only the agents still working in the bar", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    await renderPanel(props([facts(1), facts(2, { isBusy: true }), facts(3)]));
    await within(rowOf("Claude Code")).findByText("+1");

    fireEvent.click(within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" }));

    expect(screen.getByText("This stops Qwen Code mid-turn.")).toBeInTheDocument();
  });

  it("keeps the bar when the working agents finish, without the stops line, and Pick still works", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)] });
    const p = props([facts(1), facts(2, { isBusy: true })]);
    const { rerender } = await renderPanel(p);
    await within(rowOf("Claude Code")).findByText("+1");
    fireEvent.click(within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" }));
    expect(screen.getByText("This stops Qwen Code mid-turn.")).toBeInTheDocument();

    rerender(<CompareRunPanel {...props([facts(1), facts(2)], { onPick: p.onPick })} />);

    const bar = within(screen.getByRole("group", { name: "Confirm pick" }));
    expect(bar.getByText("Keep Claude Code's work and archive the others?")).toBeInTheDocument();
    expect(screen.queryByText(/mid-turn/)).toBeNull();
    fireEvent.click(bar.getByRole("button", { name: "Pick Claude Code" }));
    expect(p.onPick).toHaveBeenCalledWith("s-1");
  });

  it("Pick in the bar calls onPick once and keeps the buttons off until it is done", async () => {
    answerDiffs({ "/wt/1": [stat("a.ts", 1, 0)], "/wt/2": [stat("b.ts", 1, 0)] });
    let finish!: () => void;
    const onPick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderPanel(props([facts(1), facts(2, { isBusy: true })], { onPick }));
    await within(rowOf("Qwen Code")).findByText("+1");

    fireEvent.click(within(rowOf("Claude Code")).getByRole("button", { name: "Pick Claude Code" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm pick" })).getByRole("button", { name: "Pick Claude Code" }));
    await act(async () => {});

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("s-1");
    expect(screen.queryByRole("group", { name: "Confirm pick" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pick Qwen Code" })).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Pick Qwen Code" })).toBeEnabled();
  });
});

describe("compare run copy", () => {
  it("pickQuestion names the agent kept", () => {
    expect(pickQuestion("Codex")).toBe("Keep Codex's work and archive the others?");
  });

  it.each<[string[], string]>([
    [["Claude Code"], "This stops Claude Code mid-turn."],
    [["Claude Code", "Qwen Code"], "This stops Claude Code and Qwen Code mid-turn."],
    [["A", "B", "C"], "This stops A, B and C mid-turn."],
  ])("stopsLine(%j)", (names, line) => {
    expect(stopsLine(names)).toBe(line);
  });

  it.each<[RunRowStatus, Status]>([
    ["starting", "running"],
    ["working", "running"],
    ["needs-you", "attention"],
    ["needs-sign-in", "attention"],
    ["failed", "danger"],
    ["done", "idle"],
    ["stopped", "idle"],
  ])("runStatusDot(%s) is %s", (status, dot) => {
    expect(runStatusDot(status)).toBe(dot);
  });
});

describe("reviewing a row in the app", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens its session with the diff on the start of its worktree", async () => {
    const store = (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
    store.state.sessions = [session(1), session(2)];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "session_diff_stats_since" ? Promise.resolve([stat("a.ts", 3, 1)]) : fakeTauriInvoke(cmd, args),
    );
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Fix the login.*2 agents/ }));
    });

    const review = await within(screen.getByRole("region", { name: "Compare run" })).findByRole("button", {
      name: "Review Claude Code's changes",
    });
    await act(async () => {
      fireEvent.click(review);
    });

    expect(await screen.findByRole("button", { name: "Diff target: Start of this worktree → working tree" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull();
    expect(await screen.findByText("changed since " + "1".repeat(40))).toBeInTheDocument();
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
