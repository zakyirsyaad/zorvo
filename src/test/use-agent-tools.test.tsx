import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAgentTools, type AgentToolsDeps } from "../hooks/useAgentTools";
import type { GiveTaskResult } from "../hooks/useDelegation";
import type { StartWorkerResult } from "../lib/delegation-helpers";
import type { OpenRequest, OpenResult } from "../hooks/useOpenedSessions";
import { ALLOW_ONCE, ALLOW_SESSION, DENY } from "../lib/agent-tool-card";
import { DECLINED, DONE_RECORDED, NOT_A_WORKER, NO_SESSION, NO_SUCH_HANDLE } from "../lib/agent-tools";
import type { MentionAgentStatus } from "../lib/delegation";
import { makeProfile } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const PI = makeProfile({ id: "pi-acp", name: "pi ACP", detected: true });
const QWEN = makeProfile({ id: "qwen-code", name: "Qwen Code", detected: true });
const CODEX = makeProfile({ id: "codex-acp", name: "Codex", detected: true });

const SESSION: Session = {
  id: "s-1",
  name: "Parser work",
  profileId: "pi-acp",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
};

interface Env {
  messages: Record<string, ChatMessage[]>;
  given: Array<{ sourceId: string; agentId: string; task: string; options: unknown }>;
  attention: string[];
  statuses: Record<string, MentionAgentStatus>;
  giveResult: (agentId: string) => StartWorkerResult | Promise<StartWorkerResult>;
  sent: Array<{ coordinatorId: string; workerId: string; task: string }>;
  sendResult: () => GiveTaskResult;
  sessions: Session[];
  opens: Array<{ openerId: string; request: OpenRequest }>;
  notices: string[];
  stopped: string[];
  states: Record<string, "idle" | "working" | "needs-answer">;
  transcripts: Record<string, ChatMessage[] | "unreadable">;
  openResult: (request: OpenRequest) => OpenResult;
  dones: Array<{ workerId: string; done: unknown }>;
  doneResult: () => boolean;
  /** What the engine's flush lands: the agent's streamed text that still waits for a frame. */
  queued?: (messages: Record<string, ChatMessage[]>) => void;
}

const WORKSPACES = [
  { name: "zorvo", path: "/Users/test/developer/zorvo" },
  { name: "titan", path: "/Users/test/developer/titan" },
];

function setup(overrides: Partial<Env> = {}) {
  const env: Env = {
    messages: { "s-1": [{ id: "m-1", role: "user", content: "have Qwen review it", timestamp: 1 }] },
    given: [],
    sent: [],
    sendResult: () => ({ ok: true, kind: "sent", sessionId: "w-1", sessionName: "Qwen Code: Review" }),
    attention: [],
    statuses: {},
    giveResult: (agentId) => ({
      ok: true,
      sessionId: `d-${agentId}`,
      sessionName: `${agentId}: task`,
      handle: "worker-1",
      folder: SESSION.cwd,
    }),
    sessions: [SESSION],
    opens: [],
    notices: [],
    stopped: [],
    states: {},
    transcripts: {},
    openResult: (request) => ({
      ok: true,
      sessionId: "o-1",
      sessionName: request.title ?? "Codex: brief",
      folder: request.folderPath ?? SESSION.cwd,
      handle: "session-1",
    }),
    dones: [],
    doneResult: () => true,
    ...overrides,
  };
  const spy = vi.spyOn(internals(), "invoke");
  const hook = renderHook(
    (props: { sessions: Session[] }) => {
      const deps: AgentToolsDeps = {
        sessions: props.sessions,
        agents: [PI, QWEN, CODEX],
        statusOf: (agentId) => env.statuses[agentId] ?? "ready",
        workersOf: () => [
          { handle: "worker-1", agent: "qwen-code", title: "Qwen Code: Review", state: "working", outcome: null },
          { handle: "worker-2", agent: "qwen-code", title: "Qwen Code: Lint", state: "succeeded", outcome: "succeeded" },
        ],
        startWorker: async (sourceId, input) => {
          env.given.push({ sourceId, agentId: input.agentId, task: input.task, options: input });
          return env.giveResult(input.agentId);
        },
        sendToWorker: async (coordinatorId, workerId, task) => {
          env.sent.push({ coordinatorId, workerId, task });
          return env.sendResult();
        },
        recordDone: (workerId, done) => {
          env.dones.push({ workerId, done });
          return env.doneResult();
        },
        workspaces: WORKSPACES,
        openSession: async (openerId, request) => {
          env.opens.push({ openerId, request });
          return env.openResult(request);
        },
        openedOf: () => [{ agent: "Codex", title: "Parser port", state: "idle", folder: SESSION.cwd }],
        updateMessages: (sessionId, update) => {
          env.messages[sessionId] = update(env.messages[sessionId] ?? []);
        },
        flushUpdates: () => env.queued?.(env.messages),
        onAttention: (sessionId) => {
          env.attention.push(sessionId);
        },
        onNotice: (message) => {
          env.notices.push(message);
        },
        messagesOf: async (sessionId) => {
          const messages = env.transcripts[sessionId];
          if (messages === "unreadable") throw new Error("ENOENT /Users/test/secret/transcripts");
          return messages ?? [];
        },
        stateOf: (sessionId) => env.states[sessionId] ?? "idle",
        stopTurn: (sessionId) => {
          env.stopped.push(sessionId);
        },
        onArtifactShown: () => undefined,
      };
      return useAgentTools(deps);
    },
    { initialProps: { sessions: env.sessions } },
  );
  const answers = () =>
    spy.mock.calls.filter(([cmd]) => cmd === "agent_tool_respond").map(([, args]) => args as { callId: string; ok: boolean; text: string });
  const call = async (callId: string, tool: string, args: Record<string, unknown> = {}, sessionId = "s-1") => {
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));
    await act(async () => {
      listeners.get("agent-tool-call")?.({ payload: { callId, sessionId, tool, args } });
    });
  };
  const ended = async (callId: string) => {
    await act(async () => {
      listeners.get("agent-tool-call-ended")?.({ payload: { callId } });
    });
  };
  const cards = (sessionId = "s-1") =>
    (env.messages[sessionId] ?? []).flatMap((message) => (message.actionCard ? [message.actionCard] : []));
  const choose = async (optionId: string, sessionId = "s-1") => {
    const card = cards(sessionId).find((candidate) => candidate.status === "pending");
    let taken = false;
    await act(async () => {
      taken = hook.result.current.chooseCard(sessionId, card?.id ?? "none", optionId);
    });
    await act(async () => {});
    return taken;
  };
  return { ...hook, env, spy, answers, call, ended, cards, choose };
}

const REVIEW = { agent: "qwen-code", task: "Review the parser change." };

afterEach(() => {
  vi.restoreAllMocks();
  listeners.clear();
});

describe("useAgentTools", () => {
  it("answers list_agents with the agents and this session's delegates, no card", async () => {
    const t = setup({ statuses: { "codex-acp": "not-checked" } });
    await t.call("1", "list_agents");

    expect(t.answers()).toHaveLength(1);
    expect(t.answers()[0]).toMatchObject({ callId: "1", ok: true });
    expect(JSON.parse(t.answers()[0].text)).toEqual({
      agents: [
        { id: "pi-acp", name: "pi ACP", status: "ready" },
        { id: "qwen-code", name: "Qwen Code", status: "ready" },
        { id: "codex-acp", name: "Codex", status: "not-checked" },
      ],
      workers: [
        { handle: "worker-1", agent: "qwen-code", title: "Qwen Code: Review", state: "working", outcome: null },
        { handle: "worker-2", agent: "qwen-code", title: "Qwen Code: Lint", state: "succeeded", outcome: "succeeded" },
      ],
      opened: [{ agent: "Codex", title: "Parser port", state: "idle", folder: SESSION.cwd }],
      folders: [{ name: "titan", path: "/Users/test/developer/titan" }],
    });
    expect(t.cards()).toHaveLength(0);
  });

  it("shows one card for the first delegate call and answers nothing yet", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);

    expect(t.answers()).toHaveLength(0);
    expect(t.env.given).toHaveLength(0);
    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0]).toMatchObject({
      title: "pi ACP wants to start a Qwen Code worker",
      prompt: "Review the parser change.",
      status: "pending",
      zorvoTool: { callerName: "pi ACP", targetName: "Qwen Code", targetId: "qwen-code", folder: SESSION.cwd },
    });
    expect(t.env.attention).toEqual(["s-1"]);
    expect(t.result.current.isWaiting("s-1")).toBe(true);
    expect(t.result.current.hasGrant("s-1")).toBe(false);
  });

  it("on Allow, gives the task and answers that it started", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    expect(await t.choose(ALLOW_SESSION)).toBe(true);

    expect(t.env.given).toEqual([
      { sourceId: "s-1", agentId: "qwen-code", task: "Review the parser change.", options: expect.objectContaining({ agentId: "qwen-code", byAgent: true, hasOwnWorktree: false }) },
    ]);
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toMatchObject({ callId: "1", ok: true });
    expect(JSON.parse(t.answers()[0].text)).toMatchObject({ started: true, handle: "worker-1", session: "qwen-code: task" });
    expect(t.cards()[0]).toMatchObject({ status: "approved", chosenOptionId: ALLOW_SESSION });
    expect(t.result.current.isWaiting("s-1")).toBe(false);
    expect(t.result.current.hasGrant("s-1")).toBe(true);
  });

  it("with a grant, the next call runs with no card", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    await t.call("2", "start_worker", { agent: "Codex", task: "Fix the lexer." });

    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.cards()).toHaveLength(1);
    expect(t.env.given[1]).toMatchObject({ agentId: "codex-acp", task: "Fix the lexer." });
  });

  it("on Deny, answers that the user declined and keeps no grant", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.choose(DENY);

    expect(t.answers()).toEqual([{ callId: "1", ok: false, text: DECLINED }]);
    expect(t.env.given).toHaveLength(0);
    expect(t.cards()[0]).toMatchObject({ status: "rejected", chosenOptionId: DENY });

    await t.call("2", "start_worker", REVIEW);
    expect(t.cards().filter((card) => card.status === "pending")).toHaveLength(1);
    expect(t.answers()).toHaveLength(1);
  });

  it("two calls before an answer share one card that shows both; Allow runs both in order", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.call("2", "start_worker", { agent: "codex-acp", task: "Fix the lexer." });

    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0].title).toBe("pi ACP wants to give other agents 2 tasks");
    expect(t.cards()[0].prompt).toBe("For Qwen Code:\n> Review the parser change.\n\nFor Codex:\n> Fix the lexer.");
    expect(t.env.attention).toEqual(["s-1"]);

    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.given.map((given) => given.agentId)).toEqual(["qwen-code", "codex-acp"]);
    expect(t.answers().map((answer) => answer.callId)).toEqual(["1", "2"]);
  });

  it("two calls before an answer; Deny declines both", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.call("2", "start_worker", { agent: "codex-acp", task: "Fix the lexer." });
    await t.choose(DENY);

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: DECLINED },
      { callId: "2", ok: false, text: DECLINED },
    ]);
  });

  it("withdraws the card when its only call ended, and keeps it while another waits", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.call("2", "start_worker", { agent: "codex-acp", task: "Fix the lexer." });

    await t.ended("1");
    expect(t.cards()[0].status).toBe("pending");
    expect(t.cards()[0].title).toBe("pi ACP wants to start a Codex worker");

    await t.ended("2");
    expect(t.cards()[0].status).toBe("rejected");
    expect(t.cards()[0].chosenOptionId).toBeUndefined();
    expect(t.result.current.isWaiting("s-1")).toBe(false);
    // Nobody waits: the buttons of the old card do nothing.
    expect(t.result.current.chooseCard("s-1", t.cards()[0].id, ALLOW_SESSION)).toBe(false);
    expect(t.answers()).toHaveLength(0);
  });

  it("refuses an unknown agent with the list of ids, without a card", async () => {
    const t = setup();
    await t.call("1", "start_worker", { agent: "qwen", task: "Review it." });

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: 'No agent called "qwen". Use one of: pi-acp, qwen-code, codex-acp.' },
    ]);
    expect(t.cards()).toHaveLength(0);
  });

  it("refuses an agent that needs a sign-in, without a card", async () => {
    const t = setup({ statuses: { "qwen-code": "needs-sign-in" } });
    await t.call("1", "start_worker", REVIEW);

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: "Qwen Code needs a sign-in first. Ask the user to sign in." },
    ]);
    expect(t.cards()).toHaveLength(0);
  });

  it("passes a refusal from giving the task back to the agent", async () => {
    const t = setup({ giveResult: () => ({ ok: false, reason: "Qwen Code is still working on the previous task." }) });
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);

    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "1", ok: false, text: "Qwen Code is still working on the previous task." });
  });

  it("does not pass Zorvo's own failure on to the agent", async () => {
    const t = setup({
      giveResult: () => ({
        ok: false,
        reason: "The task could not be handed over.",
        isInternal: true,
        detail: "Error: disk full at /Users/someone/secret",
      }),
    });
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);

    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "1", ok: false, text: "Zorvo could not do that." });
  });

  it("tells a compare-run session, a delegated session and an unknown one that they cannot use the tools", async () => {
    const compared: Session = { ...SESSION, id: "s-c", compareRunId: "run-1" };
    const delegated: Session = { ...SESSION, id: "s-d", delegatedFrom: { sessionId: "s-1", task: "t", startedAt: 1 } };
    const t = setup({ sessions: [SESSION, compared, delegated] });
    await t.call("1", "start_worker", REVIEW, "s-c");
    await t.call("2", "list_agents", {}, "s-d");
    await t.call("3", "start_worker", REVIEW, "s-gone");

    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual([
      [false, NO_SESSION],
      [false, NO_SESSION],
      [false, NO_SESSION],
    ]);
  });

  it("tells a worker that every tool but done is out of its reach", async () => {
    const worker: Session = { ...SESSION, id: "s-w", delegatedFrom: { sessionId: "s-1", task: "t", startedAt: 1 } };
    const t = setup({ sessions: [SESSION, worker] });
    const tools = ["list_agents", "start_worker", "send", "start_session", "read_session", "stop_session", "show_artifact", "artifact_guide"];
    for (const [index, tool] of tools.entries()) await t.call(String(index), tool, {}, "s-w");

    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual(tools.map(() => [false, NO_SESSION]));
  });

  it("answers done from a coordinator with NOT_A_WORKER", async () => {
    const t = setup();
    await t.call("1", "done", { outcome: "succeeded", summary: "x" });
    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual([[false, NOT_A_WORKER]]);
  });

  it("answers even when giving the task throws, and for arguments it cannot read", async () => {
    const t = setup({
      giveResult: () => {
        throw new Error("boom with secret task text");
      },
    });
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    await t.call("2", "start_worker", { agent: 3, task: "x" });

    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual([
      [false, "Zorvo could not do that."],
      [false, "Zorvo could not do that."],
    ]);
  });

  it("start_worker under a grant starts a worker with its own worktree and answers with its handle", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    await t.call("2", "start_worker", { agent: "qwen-code", task: "Part one", worktree: "new", title: "Part one" });

    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.given[1].options).toEqual(
      expect.objectContaining({ agentId: "qwen-code", task: "Part one", title: "Part one", hasOwnWorktree: true, byAgent: true }),
    );
    expect(JSON.parse(t.answers()[1].text)).toMatchObject({ started: true, handle: "worker-1", folder: SESSION.cwd });
  });

  it("start_worker without a grant waits on the card; Deny answers DECLINED and starts nothing", async () => {
    const t = setup();
    await t.call("1", "start_worker", { ...REVIEW, worktree: "new" });
    expect(t.cards()[0].zorvoTool).toMatchObject({ targetId: "qwen-code" });
    expect(t.cards()[0].prompt).toBe("Review the parser change.");
    await t.choose(DENY);
    expect(t.answers()).toEqual([{ callId: "1", ok: false, text: DECLINED }]);
    expect(t.env.given).toHaveLength(0);
  });

  it("a start_worker call with worktree new and no grant shows a card that says so", async () => {
    const t = setup();
    await t.call("1", "start_worker", { ...REVIEW, worktree: "new" });
    expect(t.cards()[0].zorvoTool?.hasOwnWorktree).toBe(true);
    await t.call("2", "start_worker", { agent: "codex-acp", task: "Plain." });
    expect(t.cards()[0].zorvoTool?.hasOwnWorktree).toBeUndefined();
    expect(t.cards()[0].prompt).toContain("For Qwen Code, in its own worktree:");
  });

  it("an internal failure is FAILED to the agent and its detail goes to the user's notice", async () => {
    const t = setup({
      giveResult: () => ({
        ok: false,
        reason: "A worktree could not be made for this worker.",
        isInternal: true,
        detail: "/Users/x locked",
      }),
    });
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "1", ok: false, text: "Zorvo could not do that." });
    expect(t.env.notices).toEqual(["pi ACP could not start a Qwen Code worker: /Users/x locked"]);
  });

  it("a cancelled start (empty reason) is answered FAILED", async () => {
    const t = setup({ giveResult: () => ({ ok: false, reason: "" }) });
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "1", ok: false, text: "Zorvo could not do that." });
  });

  const WORKER: Session = {
    ...SESSION,
    id: "w-1",
    name: "Qwen Code: Review",
    profileId: "qwen-code",
    delegatedFrom: { sessionId: "s-1", task: "Review", startedAt: 5, handle: "worker-1" },
  };

  it("send reaches only the caller's own worker", async () => {
    const t = setup({ sessions: [SESSION, WORKER] });
    await t.call("c2", "send", { handle: "worker-9", message: "x" });
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "c2", ok: false, text: NO_SUCH_HANDLE });
    expect(t.cards()).toHaveLength(0);
  });

  it("send waits on the card, then gives the worker a further task and answers sent", async () => {
    const t = setup({ sessions: [SESSION, WORKER] });
    await t.call("c1", "send", { handle: "worker-1", message: "Now the lexer.\nThen stop." });
    expect(t.cards()[0].prompt).toBe("Now the lexer.\nThen stop.");
    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.env.sent).toEqual([{ coordinatorId: "s-1", workerId: "w-1", task: "Now the lexer.\nThen stop." }]);
    expect(JSON.parse(t.answers()[0].text)).toEqual({ sent: true, handle: "worker-1", session: "Qwen Code: Review" });
  });

  it("send passes a refusal on, and answers FAILED for an unreadable call", async () => {
    const t = setup({
      sessions: [SESSION, WORKER],
      sendResult: () => ({ ok: false, reason: "worker-1 is still working. Send this when it reports." }),
    });
    await t.call("1", "send", { handle: "worker-1", message: "again" });
    await t.call("2", "send", { handle: 3, message: "x" });
    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.answers().map((answer) => [answer.callId, answer.ok, answer.text])).toEqual([
      ["2", false, "Zorvo could not do that."],
      ["1", false, "worker-1 is still working. Send this when it reports."],
    ]);
  });

  it("read_session and stop_session accept a worker's handle", async () => {
    const t = setup({ sessions: [SESSION, WORKER], states: { "w-1": "working" } });
    await t.call("1", "stop_session", { handle: "worker-1" });
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.env.stopped).toEqual(["w-1"]);
  });

  it("delegate is no longer a tool: it is answered and never left hanging", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    expect(t.answers()).toEqual([{ callId: "1", ok: false, text: "Zorvo could not do that." }]);
    expect(t.cards()).toHaveLength(0);
  });

  it("ignores a payload that is not a call", async () => {
    const t = setup();
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));
    await act(async () => {
      listeners.get("agent-tool-call")?.({ payload: { callId: 7 } });
    });
    expect(t.answers()).toHaveLength(0);
  });

  it("forgets the grant when the session is gone or revoked", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    expect(t.result.current.hasGrant("s-1")).toBe(true);

    act(() => t.result.current.revokeGrant("s-1"));
    expect(t.result.current.hasGrant("s-1")).toBe(false);
    await t.call("2", "start_worker", REVIEW);
    expect(t.cards().filter((card) => card.status === "pending")).toHaveLength(1);
    await t.choose(ALLOW_SESSION);
    expect(t.result.current.hasGrant("s-1")).toBe(true);

    t.rerender({ sessions: [] });
    expect(t.result.current.hasGrant("s-1")).toBe(false);
  });

  it("does not take a card it did not make", async () => {
    const t = setup();
    expect(t.result.current.chooseCard("s-1", "act-of-the-agent", "allow")).toBe(false);
  });

  const pendingCards = (t: ReturnType<typeof setup>) => t.cards().filter((card) => card.status === "pending");
  const chooseOn = async (t: ReturnType<typeof setup>, cardId: string, optionId: string) => {
    let taken = false;
    await act(async () => {
      taken = t.result.current.chooseCard("s-1", cardId, optionId);
    });
    await act(async () => {});
    return taken;
  };
  const OPEN = { agent: "codex-acp", brief: "Port the parser.", title: "Parser port" };
  const TITAN = "/Users/test/developer/titan";

  it("opens a session after Allow on the session's card, and with a grant asks nothing", async () => {
    const t = setup();
    await t.call("1", "start_session", { ...OPEN, worktree: true });

    expect(t.cards()[0]).toMatchObject({
      title: "pi ACP wants to open a Codex session",
      prompt: "Port the parser.",
      zorvoTool: { tool: "start_session", hasOwnWorktree: true },
    });
    expect(t.env.opens).toHaveLength(0);

    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.env.opens).toEqual([
      {
        openerId: "s-1",
        request: {
          agentId: "codex-acp",
          brief: "Port the parser.",
          title: "Parser port",
          hasOwnWorktree: true,
          isCancelled: expect.any(Function),
        },
      },
    ]);
    expect(JSON.parse(t.answers()[0].text)).toEqual({
      opened: true,
      handle: "session-1",
      session: "Parser port",
      folder: SESSION.cwd,
      note: "It works on its own and does not report back.",
    });

    await t.call("2", "start_session", { agent: "Codex", brief: "Write the docs." });
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.cards()).toHaveLength(1);
    expect(t.env.opens[1].request).toEqual({
      agentId: "codex-acp",
      brief: "Write the docs.",
      hasOwnWorktree: false,
      isCancelled: expect.any(Function),
    });
  });

  it("shows a delegate call and a start_session call on one card and runs both on Allow", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.call("2", "start_session", OPEN);

    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0].title).toBe("pi ACP asks for 2 things");
    expect(t.cards()[0].prompt).toBe("For Qwen Code:\n> Review the parser change.\n\nNew Codex session:\n> Port the parser.");

    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.given).toHaveLength(1);
    expect(t.env.opens).toHaveLength(1);
  });

  it("asks with Allow once for another folder even with a grant, and keeps no grant from it", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.choose(ALLOW_SESSION);
    expect(t.result.current.hasGrant("s-1")).toBe(true);

    await t.call("2", "start_session", { ...OPEN, folder: TITAN });
    expect(t.env.opens).toHaveLength(0);
    const [card] = pendingCards(t);
    expect(card).toMatchObject({
      title: "pi ACP wants to open a Codex session in another folder",
      zorvoTool: { isOtherFolder: true, folder: TITAN },
    });
    expect(card.options?.map((option) => option.optionId)).toEqual([ALLOW_ONCE, DENY]);
    expect(t.result.current.isWaiting("s-1")).toBe(true);

    expect(await chooseOn(t, card.id, ALLOW_ONCE)).toBe(true);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.opens[0].request).toMatchObject({ folderPath: TITAN, agentId: "codex-acp" });
    expect(t.cards().find((candidate) => candidate.id === card.id)).toMatchObject({ status: "approved", chosenOptionId: ALLOW_ONCE });

    // The next one asks again.
    await t.call("3", "start_session", { ...OPEN, folder: TITAN });
    expect(pendingCards(t)).toHaveLength(1);
    expect(t.env.opens).toHaveLength(1);
  });

  it("gives no grant when the only thing allowed was a session in another folder", async () => {
    const t = setup();
    await t.call("1", "start_session", { ...OPEN, folder: TITAN });
    const [card] = pendingCards(t);
    await chooseOn(t, card.id, ALLOW_ONCE);
    expect(t.result.current.hasGrant("s-1")).toBe(false);

    await t.call("2", "start_worker", REVIEW);
    expect(pendingCards(t)).toHaveLength(1);
    expect(t.env.given).toHaveLength(0);
  });

  it("shows a folder card next to the session's card, each answered on its own", async () => {
    const t = setup();
    await t.call("1", "start_worker", REVIEW);
    await t.call("2", "start_session", { ...OPEN, folder: TITAN });
    const cards = pendingCards(t);
    expect(cards).toHaveLength(2);
    const folder = cards.find((card) => card.zorvoTool?.isOtherFolder);
    const grant = cards.find((card) => !card.zorvoTool?.isOtherFolder);

    await chooseOn(t, folder?.id ?? "", DENY);
    expect(t.answers()).toEqual([{ callId: "2", ok: false, text: DECLINED }]);
    expect(t.result.current.isWaiting("s-1")).toBe(true);

    await chooseOn(t, grant?.id ?? "", ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.given).toHaveLength(1);
    expect(t.result.current.isWaiting("s-1")).toBe(false);
  });

  it("refuses a folder that is not listed, and the session's own folder, without a card", async () => {
    const t = setup();
    await t.call("1", "start_session", { ...OPEN, folder: "/Users/test/developer/zorvo/../titan" });
    await t.call("2", "start_session", { ...OPEN, folder: SESSION.cwd });

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: "That folder is not one Zorvo knows. Use a path from list_agents' folders: titan." },
      { callId: "2", ok: false, text: 'That is this session\'s own folder. Leave "folder" out to work here.' },
    ]);
    expect(t.cards()).toHaveLength(0);
  });

  it("passes a refusal to open on to the agent, and hides nothing it may know", async () => {
    const t = setup({
      openResult: () => ({
        ok: false,
        reason: "A worktree could not be made there. Open the session without one, or in a repository.",
        isInternal: true,
        detail: "Error: fatal: not a git repository: /Users/test/secret",
      }),
    });
    await t.call("1", "start_session", { ...OPEN, worktree: true });
    await t.choose(ALLOW_SESSION);

    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({
      callId: "1",
      ok: false,
      text: "A worktree could not be made there. Open the session without one, or in a repository.",
    });
  });

  it("tells the user why a session could not be opened, and the agent only that it failed", async () => {
    const t = setup({
      openResult: () => ({
        ok: false,
        reason: "A worktree could not be made there. Open the session without one, or in a repository.",
        isInternal: true,
        detail: "Error: fatal: not a git repository",
      }),
    });
    await t.call("1", "start_session", { ...OPEN, worktree: true });
    await t.choose(ALLOW_SESSION);

    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.env.notices).toEqual(["pi ACP could not open a Codex session: Error: fatal: not a git repository"]);
    expect(t.answers()[0].text).not.toContain("fatal");
  });

  it("runs four waiting start_session calls one after another on Allow", async () => {
    const t = setup();
    for (const callId of ["1", "2", "3", "4"]) await t.call(callId, "start_session", OPEN);
    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0].title).toBe("pi ACP asks for 4 things");
    expect(t.cards()[0].zorvoTool?.hasOwnWorktree).toBeUndefined();

    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(4));
    expect(t.answers().map((answer) => answer.callId)).toEqual(["1", "2", "3", "4"]);
    expect(t.env.opens).toHaveLength(4);
  });

  it("marks an open whose call ended while it runs as cancelled", async () => {
    const t = setup();
    let finish: (value: OpenResult) => void = () => undefined;
    let request: OpenRequest | undefined;
    t.env.openResult = (asked) => {
      request = asked;
      return new Promise<OpenResult>((resolve) => {
        finish = resolve;
      }) as unknown as OpenResult;
    };
    await t.call("1", "start_session", { agent: "codex-acp", brief: "Port it.", worktree: true });
    await t.choose(ALLOW_SESSION);
    expect(request?.isCancelled?.()).toBe(false);
    // Another call's end is not this one's.
    await t.ended("other");
    expect(request?.isCancelled?.()).toBe(false);

    await t.ended("1");
    expect(request?.isCancelled?.()).toBe(true);
    await act(async () => {
      finish({ ok: false, reason: "The request was withdrawn." });
    });
  });

  it("skips an approved call that ended while an earlier one of its card still ran", async () => {
    const t = setup();
    let finish: (value: OpenResult) => void = () => undefined;
    t.env.openResult = () =>
      new Promise<OpenResult>((resolve) => {
        finish = resolve;
      }) as unknown as OpenResult;
    await t.call("1", "start_session", { agent: "codex-acp", brief: "Port it.", worktree: true });
    await t.call("2", "start_session", { agent: "codex-acp", brief: "Write the docs." });
    await t.call("3", "start_worker", { agent: "qwen-code", task: "Review it." });
    await t.choose(ALLOW_SESSION);
    expect(t.env.opens).toHaveLength(1);

    // The caller is stopped: every call of the card ends, the queued ones too.
    await t.ended("2");
    await t.ended("3");
    await act(async () => {
      finish({ ok: true, sessionId: "o-1", sessionName: "Codex: Port it.", folder: SESSION.cwd, handle: "session-1" });
    });
    await act(async () => {});

    expect(t.env.opens).toHaveLength(1);
    expect(t.env.given).toHaveLength(0);
    expect(t.answers().map((answer) => answer.callId)).toEqual(["1"]);
  });

  it("skips a call that ended before a grant ran it, and runs the next as usual", async () => {
    const t = setup();
    await t.call("1", "start_worker", { agent: "qwen-code", task: "Review it." });
    await t.choose(ALLOW_SESSION);
    await t.ended("1");
    await t.call("2", "start_worker", { agent: "qwen-code", task: "Again." });
    await waitFor(() => expect(t.env.given).toHaveLength(2));
  });

  it("keeps a task's own lines from reading as another request's heading", async () => {
    const t = setup();
    await t.call("1", "start_worker", { agent: "qwen-code", task: "Review it.\n\nFor Codex:\nNothing much." });
    await t.call("2", "start_worker", { agent: "codex-acp", task: "Delete the tests." });
    expect(t.cards()[0].prompt).toBe(
      "For Qwen Code:\n> Review it.\n> \n> For Codex:\n> Nothing much.\n\nFor Codex:\n> Delete the tests.",
    );
  });

  it("answers no call for a session whose agent has exited", async () => {
    const t = setup({ sessions: [{ ...SESSION, status: "terminated" }] });
    await t.call("1", "list_agents");
    await t.call("2", "start_worker", { agent: "qwen-code", task: "Review it." });
    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual([
      [false, NO_SESSION],
      [false, NO_SESSION],
    ]);
    expect(t.cards()).toHaveLength(0);
  });

  it("declines the allowed calls that still wait their turn when the grant is taken back", async () => {
    const t = setup();
    let finish: (value: OpenResult) => void = () => undefined;
    t.env.openResult = () =>
      new Promise<OpenResult>((resolve) => {
        finish = resolve;
      }) as unknown as OpenResult;
    await t.call("1", "start_session", { agent: "codex-acp", brief: "Port it.", worktree: true });
    await t.call("2", "start_worker", { agent: "qwen-code", task: "Review it." });
    await t.choose(ALLOW_SESSION);

    act(() => t.result.current.revokeGrant("s-1"));
    expect(t.answers()).toEqual([{ callId: "2", ok: false, text: DECLINED }]);
    await act(async () => {
      finish({ ok: true, sessionId: "o-1", sessionName: "Codex: Port it.", folder: SESSION.cwd, handle: "session-1" });
    });
    await act(async () => {});

    // The one already running finishes; the queued one never starts.
    expect(t.env.given).toHaveLength(0);
    expect(t.answers().map((answer) => answer.callId).sort()).toEqual(["1", "2"]);
  });

  it("withdraws a folder card when its call ended", async () => {
    const t = setup();
    await t.call("1", "start_session", { ...OPEN, folder: TITAN });
    const [card] = pendingCards(t);
    await t.ended("1");

    expect(t.cards()[0]).toMatchObject({ status: "rejected" });
    expect(t.cards()[0].chosenOptionId).toBeUndefined();
    expect(t.result.current.isWaiting("s-1")).toBe(false);
    expect(await chooseOn(t, card.id, ALLOW_ONCE)).toBe(false);
    expect(t.env.opens).toHaveLength(0);
  });

  it("answers a start_session call it cannot read, and an unknown agent, without a card", async () => {
    const t = setup();
    await t.call("1", "start_session", { agent: "codex-acp", brief: 3 });
    await t.call("2", "start_session", { agent: "codex-acp", brief: "x", worktree: "yes" });
    await t.call("3", "start_session", { agent: "nobody", brief: "x" });

    expect(t.answers().map((answer) => answer.ok)).toEqual([false, false, false]);
    expect(t.answers()[0].text).toBe("Zorvo could not do that.");
    expect(t.answers()[1].text).toBe("Zorvo could not do that.");
    expect(t.answers()[2].text).toContain('No agent called "nobody"');
    expect(t.cards()).toHaveLength(0);
  });

  const OPENED: Session = {
    ...SESSION,
    id: "o-1",
    name: "Parser port",
    profileId: "codex-acp",
    openedBy: { sessionId: "s-1", at: 5, handle: "session-1" },
  };
  const DELEGATE: Session = {
    ...SESSION,
    id: "d-1",
    name: "Qwen Code: Review",
    profileId: "qwen-code",
    delegatedFrom: { sessionId: "s-1", task: "Review", startedAt: 5 },
  };
  const OTHERS: Session = { ...OPENED, id: "o-z", openedBy: { sessionId: "s-other", at: 5, handle: "session-2" } };
  const ANSWER: ChatMessage[] = [
    { id: "m-1", role: "user", content: "Port the parser.", timestamp: 1 },
    { id: "m-2", role: "agent", content: "Ported. Tests pass.", timestamp: 2, isComplete: true },
  ];
  const UNKNOWN = "No session with that handle. Use list_agents to see yours.";

  it("reads the last answer of a session it opened and of its delegate, with no card and no grant", async () => {
    const t = setup({ sessions: [SESSION, OPENED, DELEGATE], transcripts: { "o-1": ANSWER, "d-1": ANSWER }, states: { "d-1": "working" } });
    await t.call("1", "read_session", { handle: "session-1" });
    await t.call("2", "read_session", { handle: "qwen-code" });

    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.cards()).toHaveLength(0);
    expect(t.result.current.hasGrant("s-1")).toBe(false);
    expect(JSON.parse(t.answers()[0].text)).toMatchObject({ state: "idle", answer: "Ported. Tests pass." });
    expect(JSON.parse(t.answers()[1].text)).toMatchObject({ state: "working", answer: "Ported. Tests pass." });
    // Zorvo's own ids never reach the agent.
    for (const answer of t.answers()) {
      expect(answer.ok).toBe(true);
      expect(answer.text).not.toMatch(/o-1|d-1|s-1/);
    }
  });

  it("cuts the answer to max_chars", async () => {
    const t = setup({ sessions: [SESSION, OPENED], transcripts: { "o-1": ANSWER } });
    await t.call("1", "read_session", { handle: "session-1", max_chars: 6 });
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(JSON.parse(t.answers()[0].text).answer).toBe("Ported");
  });

  it("refuses a handle that is not the caller's own, with one sentence for every case", async () => {
    const archived: Session = { ...OPENED, id: "o-2", archivedAt: 9, openedBy: { sessionId: "s-1", at: 6, handle: "session-3" } };
    const t = setup({ sessions: [SESSION, OPENED, OTHERS, archived] });
    const handles = ["session-2", "session-3", "o-1", "codex-acp", "s-1", "nope"];
    for (const [index, handle] of handles.entries()) {
      await t.call(String(index), index % 2 === 0 ? "read_session" : "stop_session", { handle });
    }
    await waitFor(() => expect(t.answers()).toHaveLength(handles.length));
    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual(handles.map(() => [false, UNKNOWN]));
    expect(t.env.stopped).toHaveLength(0);
  });

  it("says a session could not be read without saying why", async () => {
    const t = setup({ sessions: [SESSION, OPENED], transcripts: { "o-1": "unreadable" } });
    await t.call("1", "read_session", { handle: "session-1" });
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "1", ok: false, text: "That session could not be read." });
  });

  it("stops a working or waiting session as Stop does, and only says so for an idle one", async () => {
    const t = setup({ sessions: [SESSION, OPENED, DELEGATE], states: { "o-1": "working", "d-1": "needs-answer" } });
    await t.call("1", "stop_session", { handle: "session-1" });
    await t.call("2", "stop_session", { handle: "qwen-code" });
    expect(t.env.stopped).toEqual(["o-1", "d-1"]);
    expect(t.answers().map((answer) => JSON.parse(answer.text))).toEqual([{ stopped: true }, { stopped: true }]);

    t.env.states["o-1"] = "idle";
    await t.call("3", "stop_session", { handle: "session-1" });
    expect(t.env.stopped).toHaveLength(2);
    expect(JSON.parse(t.answers()[2].text)).toEqual({ stopped: false, note: "It was not working." });
    expect(t.cards()).toHaveLength(0);
  });

  it("answers a read or stop call it cannot read", async () => {
    const t = setup({ sessions: [SESSION, OPENED] });
    await t.call("1", "read_session", { handle: 3 });
    await t.call("2", "stop_session", {});
    await t.call("3", "read_session", { handle: "session-1", max_chars: "all" });
    expect(t.answers().map((answer) => answer.text)).toEqual([
      "Zorvo could not do that.",
      "Zorvo could not do that.",
      "Zorvo could not do that.",
    ]);
  });
});

describe("a permission card after text the agent already sent", () => {
  const queued = (messages: Record<string, ChatMessage[]>) => {
    if (messages["s-1"].some((message) => message.id === "m-2")) return;
    messages["s-1"] = [...messages["s-1"], { id: "m-2", role: "agent", content: "I will ask Qwen Code:", timestamp: 2 }];
  };
  // The card joins the open reply, so it sits on the queued text's own message or on a later one.
  const expectCardAfterText = (messages: ChatMessage[], isCard: (message: ChatMessage) => boolean) => {
    const text = messages.findIndex((message) => message.id === "m-2");
    expect(text).toBeGreaterThan(-1);
    expect(messages.findIndex(isCard)).toBeGreaterThanOrEqual(text);
  };

  it("puts the session's card after that text", async () => {
    const t = setup({ queued });
    await t.call("1", "start_worker", REVIEW);
    expectCardAfterText(t.env.messages["s-1"], (message) => message.actionCard !== undefined);
  });

  it("puts another folder's card after that text", async () => {
    const t = setup({ queued });
    await t.call("1", "start_session", { agent: "codex-acp", brief: "Port it.", folder: "/Users/test/developer/titan" });
    expectCardAfterText(t.env.messages["s-1"], (message) => message.actionCard?.zorvoTool?.isOtherFolder === true);
  });
});

describe("useAgentTools done", () => {
  const WORKER: Session = {
    ...SESSION,
    id: "w-1",
    name: "Worker",
    delegatedFrom: { sessionId: "s-1", task: "Fix it", startedAt: 5, endedAt: null },
  };
  const withWorker = () => setup({ sessions: [SESSION, WORKER] });

  it("done records the outcome and answers at once, with no card", async () => {
    const t = withWorker();
    await t.call("c1", "done", { outcome: "succeeded", summary: "Fixed it", files: ["a.ts"] }, "w-1");
    await waitFor(() => expect(t.answers()).toEqual([{ callId: "c1", ok: true, text: DONE_RECORDED }]));
    expect(t.env.dones).toEqual([{ workerId: "w-1", done: { result: "succeeded", summary: "Fixed it", files: ["a.ts"] } }]);
    expect(t.cards("w-1")).toEqual([]);
  });

  it("done from a session whose link has ended answers NOT_A_WORKER", async () => {
    const t = withWorker();
    t.env.doneResult = () => false;
    await t.call("c2", "done", { outcome: "succeeded", summary: "x" }, "w-1");
    await waitFor(() => expect(t.answers()).toEqual([{ callId: "c2", ok: false, text: NOT_A_WORKER }]));
  });

  it("done from a coordinator answers NOT_A_WORKER and writes nothing", async () => {
    const t = withWorker();
    await t.call("c3", "done", { outcome: "succeeded", summary: "x" }, "s-1");
    await waitFor(() => expect(t.answers()).toEqual([{ callId: "c3", ok: false, text: NOT_A_WORKER }]));
    expect(t.env.dones).toEqual([]);
  });

  it("done with a wrong outcome or a non-string summary fails and writes nothing", async () => {
    const t = withWorker();
    await t.call("c4", "done", { outcome: "great", summary: "x" }, "w-1");
    await t.call("c5", "done", { outcome: "failed", summary: 7 }, "w-1");
    await t.call("c6", "done", { outcome: "failed", summary: "" }, "w-1");
    await t.call("c7", "done", { outcome: "failed", summary: "x", files: [1] }, "w-1");
    await waitFor(() => expect(t.answers()).toHaveLength(4));
    for (const answer of t.answers()) expect(answer).toMatchObject({ ok: false, text: "Zorvo could not do that." });
    expect(t.env.dones).toEqual([]);
  });

  it("a worker calling any other tool is still NO_SESSION", async () => {
    const t = withWorker();
    await t.call("c8", "list_agents", {}, "w-1");
    await t.call("c9", "start_worker", REVIEW, "w-1");
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    for (const answer of t.answers()) expect(answer).toMatchObject({ ok: false, text: NO_SESSION });
  });

  it("the answer never repeats the summary", async () => {
    const t = withWorker();
    await t.call("c10", "done", { outcome: "succeeded", summary: "secret words" }, "w-1");
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0].text).not.toContain("secret");
  });
});
