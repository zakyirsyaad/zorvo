import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { openInspectorTab } from "./inspector-helpers";
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

/** One file each agent changed in its worktree, as `session_diff_stats_since` answers. */
const CHANGED_FILE = {
  path: "src/login.ts",
  oldPath: null,
  kind: "modified",
  added: 3,
  removed: 1,
  isBinary: false,
  fingerprint: "login-3-1",
};

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
  /** Answers `acp_probe_agent` for an agent, or undefined to leave it to the fake. */
  probe?: (profileId: string) => Promise<unknown> | undefined;
}

async function renderApp(setup: Setup = {}) {
  const settings = fakeStore().state.settings as FakeTauriStore["state"]["settings"] & { enabledAgents?: string[] };
  settings.enabledAgents = ALL.map((a) => a.id);
  if (setup.agentOptions) fakeStore().state.agentOptions = setup.agentOptions;
  if (setup.sessions) fakeStore().state.sessions = setup.sessions;
  let worktreeCalls = 0;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "get_agent_profiles") return Promise.resolve(structuredClone(ALL));
    // Every agent changed a file, so Pick is on: a row with known-empty changes cannot be picked.
    if (cmd === "session_diff_stats_since") return Promise.resolve([CHANGED_FILE]);
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
    if (cmd === "acp_probe_agent" && setup.probe) {
      const answer = setup.probe(String((args as { profileId: string }).profileId));
      if (answer) return answer;
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
  await click(await screen.findByRole("button", { name: "All agents" }));
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

/** Only a session between turns can be archived. */
async function endTurns(spy: { mock: { calls: unknown[][] } }) {
  await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(2));
  for (const { sessionId } of calls(spy, "acp_prompt")) {
    await act(async () => {
      listeners.get("acp-event")?.({ payload: { sessionId, kind: "turn-end", stopReason: "end_turn" } });
    });
  }
}

/** Counts every new-session draft mounted from now on, even one gone by the next render. */
function watchForDrafts(): () => number {
  const DRAFT_ONLY = 'button[aria-label^="Folder:"]';
  let mounted = 0;
  const count = (records: MutationRecord[]) => {
    for (const node of records.flatMap((record) => [...record.addedNodes])) {
      if (node instanceof Element && (node.matches(DRAFT_ONLY) || node.querySelector(DRAFT_ONLY))) mounted += 1;
    }
  };
  const observer = new MutationObserver(count);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    count(observer.takeRecords());
    observer.disconnect();
    return mounted;
  };
}

const draftQuestions = (spy: { mock: { calls: unknown[][] } }) =>
  [...calls(spy, "acp_probe_agent"), ...calls(spy, "acp_list_sessions")].length;

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

  describe("choosing each agent's model", () => {
    const modelsOf = (id: string): AgentOptions => ({
      modes: null,
      configOptions: [],
      models: {
        currentModelId: `${id}-default`,
        availableModels: [
          { modelId: `${id}-default`, name: `${id} default` },
          { modelId: `${id}-fast`, name: `${id} fast` },
        ],
      },
    });
    const startedModels = [
      { modelId: "claude-default", name: "claude default" },
      { modelId: "qwen-default", name: "qwen default" },
      { modelId: "qwen-fast", name: "qwen fast" },
    ];
    const PROBED = { modes: null, configOptions: [], commands: [], models: modelsOf("qwen").models, signInChecked: false, canListSessions: false };
    const probesFor = (spy: { mock: { calls: unknown[][] } }, id: string) => calls(spy, "acp_probe_agent").filter((a) => a.profileId === id);
    const notice = "Qwen Code needs a sign-in, so it left the run. Pick it alone to sign in.";

    it("starts each agent on the model picked in its chip", async () => {
      const spy = await renderApp({ models: startedModels, agentOptions: { "claude-acp": modelsOf("claude"), "qwen-code": modelsOf("qwen") } });
      await tickAgents("Qwen Code");
      await click(await screen.findByRole("button", { name: "Qwen Code model: qwen default" }));
      await click(screen.getByRole("option", { name: "qwen fast" }));
      expect(screen.getByRole("button", { name: "Qwen Code model: qwen fast" })).toBeInTheDocument();
      await send();
      await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
      await waitFor(() => expect(calls(spy, "acp_set_model").length).toBeGreaterThanOrEqual(1));

      const agentOfSession = new Map(calls(spy, "acp_start_session").map((a) => [a.sessionId, a.profileId]));
      const picks = calls(spy, "acp_set_model").map((a) => [agentOfSession.get(a.sessionId), a.modelId]);
      expect(picks).toEqual([["qwen-code", "qwen-fast"]]);
    });

    it("makes the pick that agent's model in its next single draft", async () => {
      await renderApp({ agentOptions: { "claude-acp": modelsOf("claude"), "qwen-code": modelsOf("qwen") } });
      await tickAgents("Qwen Code");
      await click(await screen.findByRole("button", { name: "Qwen Code model: qwen default" }));
      await click(screen.getByRole("option", { name: "qwen fast" }));
      // Untick Claude Code: Qwen Code is the draft's only agent now.
      await tickAgents("Claude Code");
      expect(await screen.findByRole("button", { name: "Model: qwen fast" })).toBeInTheDocument();
    });

    it("makes a compare pick for the draft's own agent its model in the single draft again", async () => {
      await renderApp({ agentOptions: { "claude-acp": modelsOf("claude"), "qwen-code": modelsOf("qwen") } });
      // Picked in the single draft first, then changed in the compare chip.
      await click(await screen.findByRole("button", { name: "Model: claude default" }));
      await click(screen.getByRole("option", { name: "claude fast" }));
      await tickAgents("Qwen Code");
      await click(await screen.findByRole("button", { name: "Claude Code model: claude fast" }));
      await click(screen.getByRole("option", { name: "claude default" }));
      // Untick Qwen Code: Claude Code is alone again, on the model last picked for it.
      await tickAgents("Qwen Code");
      expect(await screen.findByRole("button", { name: "Model: claude default" })).toBeInTheDocument();
    });

    it("asks a never-used agent only when its chip opens", async () => {
      const spy = await renderApp({
        agentOptions: { "claude-acp": modelsOf("claude") },
        probe: (id) => (id === "qwen-code" ? Promise.resolve(PROBED) : undefined),
      });
      await tickAgents("Qwen Code");
      expect(probesFor(spy, "qwen-code")).toHaveLength(0);
      await click(await screen.findByRole("button", { name: "Qwen Code model: Default" }));
      await waitFor(() => expect(probesFor(spy, "qwen-code")).toHaveLength(1));
      expect(probesFor(spy, "qwen-code")[0]).toMatchObject({ needsOptions: true });
    });

    it("drops an agent that needs a sign-in from the run, and says so", async () => {
      await renderApp({
        agentOptions: { "claude-acp": modelsOf("claude") },
        probe: (id) => (id === "qwen-code" ? Promise.reject(`ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "x", name: "X" }])}`) : undefined),
      });
      await tickAgents("Qwen Code");
      await click(await screen.findByRole("button", { name: "Qwen Code model: Default" }));
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Qwen Code model:/ })).toBeNull();
    });

    it("says nothing about leaving when the agent was already unticked", async () => {
      const answer = deferred<unknown>();
      await renderApp({
        agentOptions: { "claude-acp": modelsOf("claude") },
        probe: (id) => (id === "qwen-code" ? answer.promise : undefined),
      });
      await tickAgents("Qwen Code");
      await click(await screen.findByRole("button", { name: "Qwen Code model: Default" }));
      await tickAgents("Qwen Code");
      await act(async () => answer.reject(`ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "x", name: "X" }])}`));
      expect(screen.queryByText(notice)).toBeNull();
    });

    it("still starts a run on an agent's default when asking for its models failed", async () => {
      const spy = await renderApp({
        models: startedModels,
        agentOptions: { "claude-acp": modelsOf("claude") },
        probe: (id) => (id === "qwen-code" ? Promise.reject("boom") : undefined),
      });
      await tickAgents("Qwen Code");
      await click(await screen.findByRole("button", { name: "Qwen Code model: Default" }));
      expect(await screen.findByText("Could not ask Qwen Code for its models.")).toBeInTheDocument();
      await send();
      await waitFor(() => expect(calls(spy, "acp_start_session")).toHaveLength(2));
      const qwenSession = calls(spy, "acp_start_session").find((a) => a.profileId === "qwen-code")?.sessionId;
      expect(calls(spy, "acp_set_model").filter((a) => a.sessionId === qwenSession)).toHaveLength(0);
    });
  });

  it("points each agent's attachments into its own worktree", async () => {
    const spy = await renderApp({
      files: true,
      attachmentPaths: ({ cwd, paths }) => Promise.resolve(paths.map((p) => p.replace(DRAFT_FOLDER, cwd))),
    });
    await openInspectorTab("Files");
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
    expect(screen.queryByRole("button", { name: "All agents" })).toBeNull();
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

    const bar = within(await screen.findByRole("group", { name: "Confirm pick" }));
    expect(bar.getByText(/^Keep Claude Code's work and archive the others\?/)).toBeInTheDocument();
    expect(bar.getByText(/Qwen Code is still working and will be stopped\.$/)).toBeInTheDocument();
    expect(calls(spy, "acp_stop_session")).toHaveLength(0);
    await click(bar.getByRole("button", { name: "Pick Claude Code" }));

    // The keeper's own chat: not the panel, and not the new-session draft the view falls to when the run is gone.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull());
    expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull();
    expect(prompt()).not.toHaveAttribute("placeholder", expect.stringContaining("start a new session"));
    await waitFor(() => expect(savedSessions().filter((s) => s.archivedAt)).toHaveLength(1));
    expect(savedSessions().find((s) => s.archivedAt)?.profileId).toBe("qwen-code");
    expect(calls(spy, "acp_stop_session")).toHaveLength(1);
  });

  it("goes from Pick straight to the keeper's chat: no draft mounts and no agent is asked anything", async () => {
    const spy = await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await endTurns(spy);
    const panel = await screen.findByRole("region", { name: "Compare run" });
    const asked = draftQuestions(spy);
    const draftsMounted = watchForDrafts();

    await click(within(panel).getByRole("button", { name: "Pick Claude Code" }));
    await click(within(screen.getByRole("group", { name: "Confirm pick" })).getByRole("button", { name: "Pick Claude Code" }));
    await waitFor(() => expect(savedSessions().filter((s) => s.archivedAt)).toHaveLength(1));
    await act(async () => {});

    expect(draftsMounted()).toBe(0);
    expect(draftQuestions(spy)).toBe(asked);
    expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull();
    expect(prompt()).not.toHaveAttribute("placeholder", expect.stringContaining("start a new session"));
  });

  it("opens the agent left when one is archived by hand with the panel open, and no draft mounts", async () => {
    const spy = await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await endTurns(spy);
    await screen.findByRole("region", { name: "Compare run" });
    const asked = draftQuestions(spy);
    const draftsMounted = watchForDrafts();
    const sidebar = within(screen.getByRole("complementary"));

    await click(sidebar.getAllByRole("button", { name: /^More actions for (Claude|Qwen)/ })[0]);
    await click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull());
    await act(async () => {});

    expect(draftsMounted()).toBe(0);
    expect(draftQuestions(spy)).toBe(asked);
    expect(prompt()).not.toHaveAttribute("placeholder", expect.stringContaining("start a new session"));
  });

  it("stays on the session the user opened when a run goes away behind it", async () => {
    const spy = await renderApp({
      sessions: [
        { id: "s-old", name: "Older work", profileId: "claude-acp", cwd: DRAFT_FOLDER, status: "terminated", createdAt: 1, transport: "acp" },
      ],
    });
    await click(screen.getByRole("button", { name: "New session" }));
    await tickAgents("Qwen Code");
    await send("fix the login");
    await endTurns(spy);
    await screen.findByRole("region", { name: "Compare run" });
    const sidebar = within(screen.getByRole("complementary"));
    await click(sidebar.getByText("Older work"));

    await click(sidebar.getAllByRole("button", { name: /^More actions for (Claude|Qwen)/ })[0]);
    await click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(savedSessions().filter((s) => s.archivedAt)).toHaveLength(1));
    await act(async () => {});

    expect(within(screen.getAllByRole("banner")[0]).getByText("Older work")).toBeInTheDocument();
  });

  it("opens the draft again from + New session while a run is open", async () => {
    await renderApp();
    await tickAgents("Qwen Code");
    await send("fix the login");
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull());

    await click(screen.getByRole("button", { name: "New session" }));

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
    await endTurns(spy);
    const sidebar = within(screen.getByRole("complementary"));

    await click(sidebar.getAllByRole("button", { name: /^More actions for (Claude|Qwen)/ })[0]);
    await click(screen.getByRole("menuitem", { name: "Archive" }));
    // One listed session is no run: its chat shows.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull());

    await click(await sidebar.findByRole("button", { name: "Archived (1)" }));
    await click(sidebar.getAllByRole("button", { name: "More actions for fix the login" }).at(-1) as HTMLElement);
    await click(screen.getByRole("menuitem", { name: "Unarchive" }));

    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull();
  });

  it("keeps the session the user opened meanwhile", async () => {
    const first = deferred<Worktree>();
    const spy = await renderApp({
      worktree: (call) => (call === 1 ? first.promise : Promise.resolve(worktreeNumber(call))),
      sessions: [
        { id: "s-old", name: "Older work", profileId: "claude-acp", cwd: DRAFT_FOLDER, status: "terminated", createdAt: 1, transport: "acp" },
      ],
    });
    await click(screen.getByRole("button", { name: "New session" }));
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
    await click(screen.getByRole("button", { name: "New session" }));
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
    await click(screen.getByRole("button", { name: "New session" }));
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
    expect(screen.getByText("Each agent starts in its safest mode, in its own worktree.")).toBeInTheDocument();
  });

  it("keeps the composer busy until a single worktree session's attachments are resolved", async () => {
    const paths = deferred<string[]>();
    const spy = await renderApp({ files: true, attachmentPaths: () => paths.promise });
    await openInspectorTab("Files");
    await click(await screen.findByRole("button", { name: "Add README.md to prompt" }));
    await click(screen.getByRole("button", { name: /^Branch:/ }));
    await click(await screen.findByRole("switch", { name: "New worktree" }));
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
      sessions: [],
      sources: { isBusy: () => false, transcripts: {}, failedTurns: {} },
      askSignIn: vi.fn(),
      notifyRun: vi.fn(),
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
