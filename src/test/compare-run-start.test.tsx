import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import { makeProfile } from "./fixtures/agents";
import App from "../App";
import { useCompareRun, type CompareRunDeps } from "../hooks/useCompareRun";
import { useSessionFork } from "../hooks/useSessionFork";
import type { AgentOptions } from "../lib/acp-draft";
import type { ChatMessage, Session } from "../types";

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

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

const DRAFT_FOLDER = "/Users/test/developer/ai-perpetual-trading";
const ALL = [
  makeProfile({ id: "claude-acp", name: "Claude Code", detected: true }),
  makeProfile({ id: "qwen-code", name: "Qwen Code", detected: true }),
  makeProfile({ id: "kimi", name: "Kimi CLI", detected: true }),
];

interface Worktree {
  path: string;
  cwd: string;
  branch: string;
  startCommit: string;
}

const worktreeNumber = (n: number): Worktree => ({
  path: `/data/worktrees/zorvo/fix-${n}`,
  cwd: `/data/worktrees/zorvo/fix-${n}`,
  branch: `agent/fix-${n}`,
  startCommit: String(n).repeat(40),
});

interface Setup {
  /** Answers `create_session_worktree`, called once per agent in order (1-based); the default makes one. */
  worktree?: (call: number) => Promise<unknown>;
  /** Answers `worktree_attachment_paths`. */
  attachmentPaths?: (args: { cwd: string; paths: string[] }) => Promise<unknown>;
  agentOptions?: Record<string, AgentOptions>;
  sessions?: Session[];
  /** Files `list_directory` offers. */
  files?: boolean;
  /** Models every started agent reports. */
  models?: Array<{ modelId: string; name: string }>;
}

async function renderApp(setup: Setup = {}) {
  const settings = fakeStore().state.settings as FakeTauriStore["state"]["settings"] & { enabledAgents?: string[] };
  settings.enabledAgents = ALL.map((a) => a.id);
  if (setup.agentOptions) fakeStore().state.agentOptions = setup.agentOptions;
  if (setup.sessions) fakeStore().state.sessions = setup.sessions;
  let worktreeCalls = 0;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "get_agent_profiles") return Promise.resolve(structuredClone(ALL));
    if (cmd === "create_session_worktree") {
      worktreeCalls += 1;
      return setup.worktree ? setup.worktree(worktreeCalls) : Promise.resolve(worktreeNumber(worktreeCalls));
    }
    if (cmd === "worktree_attachment_paths" && setup.attachmentPaths) {
      return setup.attachmentPaths(args as { cwd: string; paths: string[] });
    }
    if (cmd === "acp_start_session" && setup.models) {
      return fakeTauriInvoke(cmd, args).then((started) => ({
        ...(started as object),
        models: { currentModelId: "default", availableModels: setup.models },
      }));
    }
    if (cmd === "list_directory" && setup.files) {
      return Promise.resolve([{ name: "README.md", relativePath: "README.md", isDir: false }]);
    }
    return fakeTauriInvoke(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
  return spy;
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** Ticks the agents in the Agent chip's menu, on top of the default one. */
async function tickAgents(...names: string[]) {
  await click(await screen.findByRole("button", { name: /^Agent: / }));
  for (const name of names) {
    await click(await screen.findByRole("checkbox", { name: new RegExp(`^Compare ${name}`) }));
  }
}

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

async function send(text = "fix the login") {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(prompt(), { key: "Enter" });
  });
}

const calls = (spy: { mock: { calls: unknown[][] } }, command: string) =>
  spy.mock.calls.filter(([cmd]) => cmd === command).map(([, args]) => args as Record<string, unknown>);

/** A promise settled from outside, to hold a command open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const savedSessions = () => fakeStore().state.sessions as Array<Session & { compareRunId?: string | null }>;

describe("starting a compare run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("makes one worktree and one session per agent, one at a time", async () => {
    const first = deferred<Worktree>();
    const spy = await renderApp({ worktree: (call) => (call === 1 ? first.promise : Promise.resolve(worktreeNumber(call))) });
    await tickAgents("Qwen Code");

    await send();
    await act(async () => {});
    expect(calls(spy, "create_session_worktree")).toHaveLength(1);
    expect(calls(spy, "acp_start_session")).toHaveLength(0);

    await act(async () => first.resolve(worktreeNumber(1)));
    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
    expect(calls(spy, "create_session_worktree")).toHaveLength(2);
    expect(calls(spy, "acp_start_session").map((a) => [a.profileId, a.cwd])).toEqual([
      ["claude-acp", worktreeNumber(1).cwd],
      ["qwen-code", worktreeNumber(2).cwd],
    ]);
  });

  it("keeps the composer busy for the whole run, so a second Send cannot start", async () => {
    const first = deferred<Worktree>();
    const spy = await renderApp({ worktree: (call) => (call === 1 ? first.promise : Promise.resolve(worktreeNumber(call))) });
    await tickAgents("Qwen Code");
    await send();

    expect(prompt()).toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });
    await act(async () => first.resolve(worktreeNumber(1)));
    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
    expect(calls(spy, "create_session_worktree")).toHaveLength(2);
  });

  it("gives every session one compareRunId and its worktree's startCommit", async () => {
    const spy = await renderApp();
    await tickAgents("Qwen Code", "Kimi CLI");
    await send();

    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(3));
    await waitFor(() => expect(savedSessions()).toHaveLength(3), { timeout: 3000 });
    const sessions = savedSessions();
    const runIds = new Set(sessions.map((s) => s.compareRunId));
    expect(runIds.size).toBe(1);
    expect([...runIds][0]).toMatch(/^run-/);
    expect(sessions.map((s) => [s.profileId, s.worktree?.startCommit]).sort()).toEqual([
      ["claude-acp", "1".repeat(40)],
      ["kimi", "3".repeat(40)],
      ["qwen-code", "2".repeat(40)],
    ]);
  });

  it("gives each agent its own remembered choices", async () => {
    const modelsOf = (id: string) => ({
      currentModelId: `${id}-default`,
      availableModels: [{ modelId: `${id}-fast`, name: `${id} fast` }],
    });
    const spy = await renderApp({
      models: [{ modelId: "claude-fast", name: "Claude fast" }, { modelId: "qwen-fast", name: "Qwen fast" }],
      agentOptions: {
        "claude-acp": { modes: null, configOptions: [], models: modelsOf("claude"), preferredModelId: "claude-fast" },
        "qwen-code": { modes: null, configOptions: [], models: modelsOf("qwen"), preferredModelId: "qwen-fast" },
      },
    });
    await tickAgents("Qwen Code");
    await send();
    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
    await waitFor(() => expect(calls(spy, "acp_set_model").length).toBeGreaterThanOrEqual(2));

    const agentOfSession = new Map(calls(spy, "acp_start_session").map((a) => [a.sessionId, a.profileId]));
    const picks = calls(spy, "acp_set_model").map((a) => [agentOfSession.get(a.sessionId), a.modelId]);
    expect(picks).toEqual(expect.arrayContaining([["claude-acp", "claude-fast"], ["qwen-code", "qwen-fast"]]));
    expect(picks).toHaveLength(2);
  });

  it("points each agent's attachments into its own worktree", async () => {
    const spy = await renderApp({
      files: true,
      attachmentPaths: ({ cwd, paths }) => Promise.resolve(paths.map((p) => p.replace(DRAFT_FOLDER, cwd))),
    });
    await click(within(screen.getAllByRole("banner")[0]).getByRole("button", { name: "Toggle files panel" }));
    await click(await screen.findByRole("button", { name: "Add README.md to prompt" }));
    await tickAgents("Qwen Code");
    await send();

    await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(2));
    expect(calls(spy, "worktree_attachment_paths").map((a) => a.cwd)).toEqual([worktreeNumber(1).cwd, worktreeNumber(2).cwd]);
    const agentOfSession = new Map(calls(spy, "acp_start_session").map((a) => [a.sessionId, a.cwd]));
    for (const prompted of calls(spy, "acp_prompt")) {
      expect(prompted.attachments).toEqual([`${agentOfSession.get(prompted.sessionId)}/README.md`]);
    }
  });

  it("opens the run's panel in the chat's place, with no composer and no draft behind it", async () => {
    await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");

    const panel = await screen.findByRole("region", { name: "Compare run" });
    await act(async () => {});
    expect(within(panel).getAllByRole("listitem").map((row) => row.getAttribute("aria-label"))).toEqual(["Claude Code", "Qwen Code"]);
    expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Agent: / })).toBeNull();
  });

  it("opens one agent's chat from its row, and leaves the panel", async () => {
    await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await click(await screen.findByRole("button", { name: "Open Qwen Code" }));

    expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull();
    expect(await screen.findByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
  });

  it("Pick keeps one agent: asks first, stops and archives the other, and opens the keeper's chat", async () => {
    const spy = await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await click(await screen.findByRole("button", { name: "Pick Claude Code" }));

    expect(await screen.findByText("Stop 1 agent and keep Claude Code's work?")).toBeInTheDocument();
    expect(calls(spy, "acp_stop_session")).toHaveLength(0);
    await click(screen.getByRole("button", { name: "Stop and pick" }));

    // The keeper's own chat: not the panel, and not the new-session draft the view falls to when the run is gone.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull());
    expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull();
    expect(prompt()).not.toHaveAttribute("placeholder", expect.stringContaining("start a new session"));
    await waitFor(() => expect(savedSessions().filter((s) => s.archivedAt)).toHaveLength(1));
    expect(savedSessions().find((s) => s.archivedAt)?.profileId).toBe("qwen-code");
    expect(calls(spy, "acp_stop_session")).toHaveLength(1);
  });

  it("opens the draft again from + New session while a run is open", async () => {
    await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull());

    await click(screen.getByRole("button", { name: "+ New session" }));

    expect(await screen.findByRole("button", { name: /^Folder:/ })).toBeInTheDocument();
    expect(prompt()).toHaveAttribute("placeholder", expect.stringContaining("start a new session"));
    // Nor does the run come back on its own.
    await act(async () => {});
    expect(screen.getByRole("button", { name: /^Folder:/ })).toBeInTheDocument();
  });

  it("does not jump back into a run that was archived away and brought back", async () => {
    const spy = await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull());
    // Only a session between turns can be archived.
    await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(2));
    for (const { sessionId } of calls(spy, "acp_prompt")) {
      await act(async () => {
        listeners.get("acp-event")?.({ payload: { sessionId, kind: "turn-end", stopReason: "end_turn" } });
      });
    }
    const sidebar = within(screen.getByRole("complementary"));

    await click(sidebar.getAllByRole("button", { name: /^More actions for (Claude|Qwen)/ })[0]);
    await click(screen.getByRole("menuitem", { name: "Archive" }));
    // One listed session is no run: the draft shows.
    expect(await screen.findByRole("button", { name: /^Folder:/ })).toBeInTheDocument();

    await click(await sidebar.findByRole("button", { name: "Archived (1)" }));
    await click(sidebar.getAllByRole("button", { name: "More actions for fix the login" }).at(-1) as HTMLElement);
    await click(screen.getByRole("menuitem", { name: "Unarchive" }));

    await act(async () => {});
    expect(screen.getByRole("button", { name: /^Folder:/ })).toBeInTheDocument();
  });

  it("keeps the session the user opened meanwhile", async () => {
    const first = deferred<Worktree>();
    const spy = await renderApp({
      worktree: (call) => (call === 1 ? first.promise : Promise.resolve(worktreeNumber(call))),
      sessions: [
        { id: "s-old", name: "Older work", profileId: "claude-acp", cwd: DRAFT_FOLDER, status: "terminated", createdAt: 1, transport: "acp" },
      ],
    });
    await click(screen.getByRole("button", { name: "+ New session" }));
    await tickAgents("Qwen Code");
    await send();
    await click(within(screen.getByRole("complementary")).getByText("Older work"));

    await act(async () => first.resolve(worktreeNumber(1)));
    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
    await act(async () => {});

    expect(within(screen.getAllByRole("banner")[0]).getByText("Older work")).toBeInTheDocument();
  });

  it("opens a new draft with the message when no worktree could be made and the user is elsewhere", async () => {
    const first = deferred<Worktree>();
    await renderApp({
      worktree: (call) => (call === 1 ? first.promise : Promise.reject("no space")),
      sessions: [
        { id: "s-old", name: "Older work", profileId: "claude-acp", cwd: DRAFT_FOLDER, status: "terminated", createdAt: 1, transport: "acp" },
      ],
    });
    await click(screen.getByRole("button", { name: "+ New session" }));
    await tickAgents("Qwen Code");
    await send("fix the login");
    await click(within(screen.getByRole("complementary")).getByText("Older work"));

    await act(async () => first.reject("no space"));
    await act(async () => {});

    expect(await screen.findByRole("button", { name: /^Folder:/ })).toBeInTheDocument();
    expect(prompt()).toHaveValue("fix the login");
  });

  /** Run A is open on its panel, then run B's worktrees are held while the user clicks A's group in the sidebar. */
  async function openRunAWhileRunBIsMaking(worktree: (call: number) => Promise<unknown>) {
    const spy = await renderApp({ worktree });
    await tickAgents("Qwen Code");
    await send("fix the login");
    await screen.findByRole("region", { name: "Compare run" });
    await click(screen.getByRole("button", { name: "+ New session" }));
    await tickAgents("Qwen Code");
    await send("add a readme");
    await click(within(screen.getByRole("complementary")).getByRole("button", { name: /fix the login.*2 agents/ }));
    return spy;
  }

  it("keeps the open run's panel when another run's worktrees finish", async () => {
    const heldFirst = deferred<Worktree>();
    const spy = await openRunAWhileRunBIsMaking((call) => (call === 3 ? heldFirst.promise : Promise.resolve(worktreeNumber(call))));
    expect(within(await screen.findByRole("region", { name: "Compare run" })).getByRole("heading", { name: "fix the login" })).toBeInTheDocument();

    await act(async () => heldFirst.resolve(worktreeNumber(3)));
    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(4));
    await act(async () => {});

    const panel = screen.getByRole("region", { name: "Compare run" });
    expect(within(panel).getByRole("heading", { name: "fix the login" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Compare run" })).toHaveLength(1);
    // The second run is in the sidebar, not on screen.
    expect(within(screen.getByRole("complementary")).getByRole("button", { name: /add a readme.*2 agents/ })).toBeInTheDocument();
  });

  it("brings the message back in a new draft when the other run's worktrees all failed", async () => {
    const heldFirst = deferred<Worktree>();
    await openRunAWhileRunBIsMaking((call) =>
      call === 3 ? heldFirst.promise : call === 4 ? Promise.reject("no space") : Promise.resolve(worktreeNumber(call)),
    );

    await act(async () => heldFirst.reject("no space"));
    await act(async () => {});

    expect(await screen.findByRole("button", { name: /^Folder:/ })).toBeInTheDocument();
    expect(prompt()).toHaveValue("add a readme");
    expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull();
  });

  it("skips an agent whose worktree cannot be made and names it", async () => {
    const spy = await renderApp({
      worktree: (call) => (call === 2 ? Promise.reject("branch already exists") : Promise.resolve(worktreeNumber(call))),
    });
    await tickAgents("Qwen Code", "Kimi CLI");
    await send();

    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
    expect(calls(spy, "acp_start_session").map((a) => a.profileId)).toEqual(["claude-acp", "kimi"]);
    expect(screen.getByRole("alert").textContent).toContain("Qwen Code");
    expect(screen.getByRole("alert").textContent).toContain("branch already exists");
    await waitFor(() => expect(savedSessions()).toHaveLength(2), { timeout: 3000 });
    expect(new Set(savedSessions().map((s) => s.compareRunId)).size).toBe(1);
    expect(savedSessions()[0].compareRunId).toBeTruthy();
  });

  it("makes a normal session, with no run id and no panel, when only one could start", async () => {
    const spy = await renderApp({
      worktree: (call) => (call === 1 ? Promise.reject("disk full") : Promise.resolve(worktreeNumber(call))),
    });
    await tickAgents("Qwen Code");
    await send();

    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(1));
    expect(calls(spy, "acp_start_session")[0]).toMatchObject({ profileId: "qwen-code", cwd: worktreeNumber(2).cwd });
    expect(screen.getByRole("alert").textContent).toContain("Claude Code");
    await waitFor(() => expect(savedSessions()).toHaveLength(1), { timeout: 3000 });
    expect(savedSessions()[0].compareRunId ?? null).toBeNull();
    // The session opens like any other.
    expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull();
  });

  it("puts the message back in the composer when no session could start", async () => {
    const spy = await renderApp({ worktree: () => Promise.reject("not a git repository") });
    await tickAgents("Qwen Code");
    await send("fix the login");

    await waitFor(() => expect(prompt().value).toBe("fix the login"));
    expect(calls(spy, "acp_start_session")).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("not a git repository");
    expect(prompt()).toBeEnabled();
    // The draft keeps its ticks.
    expect(screen.getByText("Runs in 2 worktrees. Each agent uses its own quota.")).toBeInTheDocument();
  });

  it("keeps the composer busy until a single worktree session's attachments are resolved", async () => {
    const paths = deferred<string[]>();
    const spy = await renderApp({ files: true, attachmentPaths: () => paths.promise });
    await click(within(screen.getAllByRole("banner")[0]).getByRole("button", { name: "Toggle files panel" }));
    await click(await screen.findByRole("button", { name: "Add README.md to prompt" }));
    await click(screen.getByRole("button", { name: /^Folder:/ }));
    await click(await screen.findByRole("switch", { name: "Worktree" }));
    await send();
    await act(async () => {});

    expect(calls(spy, "worktree_attachment_paths")).toHaveLength(1);
    expect(calls(spy, "acp_start_session")).toHaveLength(0);
    expect(prompt()).toBeDisabled();
    await act(async () => paths.resolve([`${worktreeNumber(1).cwd}/README.md`]));
    await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(1));
  });
});

describe("the run's start failing unexpectedly", () => {
  function runDeps(startSession: CompareRunDeps["startSession"]) {
    return {
      repoPath: "/w",
      baseBranch: undefined,
      agentOptions: undefined,
      startSession,
      isOnDraft: () => true,
      openRun: vi.fn(),
      setIsBusy: vi.fn(),
      restoreMessage: vi.fn(),
      onStarted: vi.fn(),
      onNotice: vi.fn(),
      archiveSession: vi.fn(),
      readSessions: () => [],
      openSession: vi.fn(),
      agentName: (profileId: string) => profileId,
    };
  }

  beforeEach(() => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "create_session_worktree" ? Promise.resolve(worktreeNumber(1)) : fakeTauriInvoke(cmd, args),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("gives the message back and says so when nothing started", async () => {
    const deps = runDeps(() => {
      throw new Error("state is gone");
    });
    const { result } = renderHook(() => useCompareRun(deps));

    await act(async () => result.current.startRun(ALL.slice(0, 2), { text: "go" }));

    expect(deps.restoreMessage).toHaveBeenCalledWith({ text: "go" }, "claude-acp");
    expect(deps.onNotice).toHaveBeenCalledWith(expect.stringContaining("state is gone"));
    expect(deps.setIsBusy).toHaveBeenLastCalledWith(false);
    expect(deps.openRun).not.toHaveBeenCalled();
  });

  it("does not put the message back once a session has started", async () => {
    let calls = 0;
    const deps = runDeps(() => {
      calls += 1;
      if (calls === 2) throw new Error("state is gone");
    });
    const { result } = renderHook(() => useCompareRun(deps));

    await act(async () => result.current.startRun(ALL.slice(0, 2), { text: "go" }));

    expect(deps.restoreMessage).not.toHaveBeenCalled();
    expect(deps.onNotice).toHaveBeenCalledWith(expect.stringContaining("state is gone"));
    expect(deps.setIsBusy).toHaveBeenLastCalledWith(false);
  });

  it("can start another run after a failed one", async () => {
    let fail = true;
    const startSession = vi.fn(() => {
      if (fail) throw new Error("once");
    });
    const deps = runDeps(startSession);
    const { result } = renderHook(() => useCompareRun(deps));
    await act(async () => result.current.startRun(ALL.slice(0, 2), { text: "go" }));
    fail = false;

    await act(async () => result.current.startRun(ALL.slice(0, 2), { text: "go" }));

    expect(deps.openRun).toHaveBeenCalledTimes(1);
  });
});

describe("forking a run's session", () => {
  it("starts a fork with no compareRunId", async () => {
    const source: Session = {
      id: "s-1",
      name: "Compare",
      profileId: "claude-acp",
      cwd: "/w",
      status: "terminated",
      createdAt: 1,
      transport: "acp",
      compareRunId: "run-1",
    };
    const messages: ChatMessage[] = [{ id: "m-1", role: "user", content: "hi", timestamp: 1 } as unknown as ChatMessage];
    const startSession = vi.fn();
    const { result } = renderHook(() =>
      useSessionFork({
        source,
        agents: ALL,
        transcripts: { "s-1": messages },
        acp: { canFork: () => false, fork: vi.fn() },
        recordSession: vi.fn() as never,
        startSession,
        onNotice: vi.fn(),
      }),
    );

    await act(async () => result.current("m-1"));

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession.mock.calls[0][0]).not.toHaveProperty("compareRunId");
  });
});
