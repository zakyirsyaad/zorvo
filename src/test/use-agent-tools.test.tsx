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
import type { OpenRequest, OpenResult } from "../hooks/useOpenedSessions";
import { ALLOW_ONCE, ALLOW_SESSION, DENY } from "../lib/agent-tool-card";
import { DECLINED, NOT_YET, NO_SESSION } from "../lib/agent-tools";
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
  giveResult: (agentId: string) => GiveTaskResult | Promise<GiveTaskResult>;
  sessions: Session[];
  opens: Array<{ openerId: string; request: OpenRequest }>;
  notices: string[];
  openResult: (request: OpenRequest) => OpenResult;
}

const WORKSPACES = [
  { name: "zorvo", path: "/Users/test/developer/zorvo" },
  { name: "titan", path: "/Users/test/developer/titan" },
];

function setup(overrides: Partial<Env> = {}) {
  const env: Env = {
    messages: { "s-1": [{ id: "m-1", role: "user", content: "have Qwen review it", timestamp: 1 }] },
    given: [],
    attention: [],
    statuses: {},
    giveResult: (agentId) => ({ ok: true, kind: "started", sessionId: `d-${agentId}`, sessionName: `${agentId}: task` }),
    sessions: [SESSION],
    opens: [],
    notices: [],
    openResult: (request) => ({
      ok: true,
      sessionId: "o-1",
      sessionName: request.title ?? "Codex: brief",
      folder: request.folderPath ?? SESSION.cwd,
      handle: "session-1",
    }),
    ...overrides,
  };
  const spy = vi.spyOn(internals(), "invoke");
  const hook = renderHook(
    (props: { sessions: Session[] }) => {
      const deps: AgentToolsDeps = {
        sessions: props.sessions,
        agents: [PI, QWEN, CODEX],
        statusOf: (agentId) => env.statuses[agentId] ?? "ready",
        delegatesOf: () => [{ agentId: "codex-acp", state: "working", task: "Fix the parser" }],
        giveTask: async (sourceId, agentId, task, options) => {
          env.given.push({ sourceId, agentId, task, options });
          return env.giveResult(agentId);
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
        onAttention: (sessionId) => {
          env.attention.push(sessionId);
        },
        onNotice: (message) => {
          env.notices.push(message);
        },
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
        {
          id: "codex-acp",
          name: "Codex",
          status: "not-checked",
          delegate: { handle: "codex-acp", state: "working", task: "Fix the parser" },
        },
      ],
      opened: [{ agent: "Codex", title: "Parser port", state: "idle", folder: SESSION.cwd }],
      folders: [{ name: "titan", path: "/Users/test/developer/titan" }],
    });
    expect(t.cards()).toHaveLength(0);
  });

  it("shows one card for the first delegate call and answers nothing yet", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);

    expect(t.answers()).toHaveLength(0);
    expect(t.env.given).toHaveLength(0);
    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0]).toMatchObject({
      title: "pi ACP wants to give Qwen Code a task",
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
    await t.call("1", "delegate", REVIEW);
    expect(await t.choose(ALLOW_SESSION)).toBe(true);

    expect(t.env.given).toEqual([
      { sourceId: "s-1", agentId: "qwen-code", task: "Review the parser change.", options: { byAgent: true } },
    ]);
    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toMatchObject({ callId: "1", ok: true });
    expect(JSON.parse(t.answers()[0].text)).toMatchObject({ started: true, handle: "qwen-code", session: "qwen-code: task" });
    expect(t.cards()[0]).toMatchObject({ status: "approved", chosenOptionId: ALLOW_SESSION });
    expect(t.result.current.isWaiting("s-1")).toBe(false);
    expect(t.result.current.hasGrant("s-1")).toBe(true);
  });

  it("with a grant, the next call runs with no card", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    await t.choose(ALLOW_SESSION);
    await t.call("2", "delegate", { agent: "Codex", task: "Fix the lexer." });

    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.cards()).toHaveLength(1);
    expect(t.env.given[1]).toMatchObject({ agentId: "codex-acp", task: "Fix the lexer." });
  });

  it("on Deny, answers that the user declined and keeps no grant", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    await t.choose(DENY);

    expect(t.answers()).toEqual([{ callId: "1", ok: false, text: DECLINED }]);
    expect(t.env.given).toHaveLength(0);
    expect(t.cards()[0]).toMatchObject({ status: "rejected", chosenOptionId: DENY });

    await t.call("2", "delegate", REVIEW);
    expect(t.cards().filter((card) => card.status === "pending")).toHaveLength(1);
    expect(t.answers()).toHaveLength(1);
  });

  it("two calls before an answer share one card that shows both; Allow runs both in order", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    await t.call("2", "delegate", { agent: "codex-acp", task: "Fix the lexer." });

    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0].title).toBe("pi ACP wants to give other agents 2 tasks");
    expect(t.cards()[0].prompt).toBe("For Qwen Code:\nReview the parser change.\n\nFor Codex:\nFix the lexer.");
    expect(t.env.attention).toEqual(["s-1"]);

    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.given.map((given) => given.agentId)).toEqual(["qwen-code", "codex-acp"]);
    expect(t.answers().map((answer) => answer.callId)).toEqual(["1", "2"]);
  });

  it("two calls before an answer; Deny declines both", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    await t.call("2", "delegate", { agent: "codex-acp", task: "Fix the lexer." });
    await t.choose(DENY);

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: DECLINED },
      { callId: "2", ok: false, text: DECLINED },
    ]);
  });

  it("withdraws the card when its only call ended, and keeps it while another waits", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    await t.call("2", "delegate", { agent: "codex-acp", task: "Fix the lexer." });

    await t.ended("1");
    expect(t.cards()[0].status).toBe("pending");
    expect(t.cards()[0].title).toBe("pi ACP wants to give Codex a task");

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
    await t.call("1", "delegate", { agent: "qwen", task: "Review it." });

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: 'No agent called "qwen". Use one of: pi-acp, qwen-code, codex-acp.' },
    ]);
    expect(t.cards()).toHaveLength(0);
  });

  it("refuses an agent that needs a sign-in, without a card", async () => {
    const t = setup({ statuses: { "qwen-code": "needs-sign-in" } });
    await t.call("1", "delegate", REVIEW);

    expect(t.answers()).toEqual([
      { callId: "1", ok: false, text: "Qwen Code needs a sign-in first. Ask the user to sign in." },
    ]);
    expect(t.cards()).toHaveLength(0);
  });

  it("passes a refusal from giving the task back to the agent", async () => {
    const t = setup({ giveResult: () => ({ ok: false, reason: "Qwen Code is still working on the previous task." }) });
    await t.call("1", "delegate", REVIEW);
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
    await t.call("1", "delegate", REVIEW);
    await t.choose(ALLOW_SESSION);

    await waitFor(() => expect(t.answers()).toHaveLength(1));
    expect(t.answers()[0]).toEqual({ callId: "1", ok: false, text: "Zorvo could not do that." });
  });

  it("tells a compare-run session, a delegated session and an unknown one that they cannot use the tools", async () => {
    const compared: Session = { ...SESSION, id: "s-c", compareRunId: "run-1" };
    const delegated: Session = { ...SESSION, id: "s-d", delegatedFrom: { sessionId: "s-1", task: "t", startedAt: 1 } };
    const t = setup({ sessions: [SESSION, compared, delegated] });
    await t.call("1", "delegate", REVIEW, "s-c");
    await t.call("2", "list_agents", {}, "s-d");
    await t.call("3", "delegate", REVIEW, "s-gone");

    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual([
      [false, NO_SESSION],
      [false, NO_SESSION],
      [false, NO_SESSION],
    ]);
  });

  it("answers the tools of the last phase as not available yet", async () => {
    const t = setup();
    await t.call("2", "read_session", { handle: "h" });
    await t.call("3", "stop_session", { handle: "h" });
    expect(t.answers().map((answer) => answer.text)).toEqual([NOT_YET, NOT_YET]);
  });

  it("answers even when giving the task throws, and for arguments it cannot read", async () => {
    const t = setup({
      giveResult: () => {
        throw new Error("boom with secret task text");
      },
    });
    await t.call("1", "delegate", REVIEW);
    await t.choose(ALLOW_SESSION);
    await t.call("2", "delegate", { agent: 3, task: "x" });

    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.answers().map((answer) => [answer.ok, answer.text])).toEqual([
      [false, "Zorvo could not do that."],
      [false, "Zorvo could not do that."],
    ]);
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
    await t.call("1", "delegate", REVIEW);
    await t.choose(ALLOW_SESSION);
    expect(t.result.current.hasGrant("s-1")).toBe(true);

    act(() => t.result.current.revokeGrant("s-1"));
    expect(t.result.current.hasGrant("s-1")).toBe(false);
    await t.call("2", "delegate", REVIEW);
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
      { openerId: "s-1", request: { agentId: "codex-acp", brief: "Port the parser.", title: "Parser port", hasOwnWorktree: true } },
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
    expect(t.env.opens[1].request).toEqual({ agentId: "codex-acp", brief: "Write the docs.", hasOwnWorktree: false });
  });

  it("shows a delegate call and a start_session call on one card and runs both on Allow", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
    await t.call("2", "start_session", OPEN);

    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0].title).toBe("pi ACP asks for 2 things");
    expect(t.cards()[0].prompt).toBe("For Qwen Code:\nReview the parser change.\n\nNew Codex session:\nPort the parser.");

    await t.choose(ALLOW_SESSION);
    await waitFor(() => expect(t.answers()).toHaveLength(2));
    expect(t.env.given).toHaveLength(1);
    expect(t.env.opens).toHaveLength(1);
  });

  it("asks with Allow once for another folder even with a grant, and keeps no grant from it", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
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

    await t.call("2", "delegate", REVIEW);
    expect(pendingCards(t)).toHaveLength(1);
    expect(t.env.given).toHaveLength(0);
  });

  it("shows a folder card next to the session's card, each answered on its own", async () => {
    const t = setup();
    await t.call("1", "delegate", REVIEW);
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
});
