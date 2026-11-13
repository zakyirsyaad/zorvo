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
import { ALLOW_SESSION, DENY } from "../lib/agent-tool-card";
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
}

function setup(overrides: Partial<Env> = {}) {
  const env: Env = {
    messages: { "s-1": [{ id: "m-1", role: "user", content: "have Qwen review it", timestamp: 1 }] },
    given: [],
    attention: [],
    statuses: {},
    giveResult: (agentId) => ({ ok: true, kind: "started", sessionId: `d-${agentId}`, sessionName: `${agentId}: task` }),
    sessions: [SESSION],
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
        updateMessages: (sessionId, update) => {
          env.messages[sessionId] = update(env.messages[sessionId] ?? []);
        },
        onAttention: (sessionId) => {
          env.attention.push(sessionId);
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
        { id: "codex-acp", name: "Codex", status: "not-checked", delegate: { state: "working", task: "Fix the parser" } },
      ],
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
    expect(JSON.parse(t.answers()[0].text)).toMatchObject({ started: true, session: "qwen-code: task" });
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

  it("answers the tools of later phases as not available yet", async () => {
    const t = setup();
    await t.call("1", "start_session", { agent: "qwen-code", brief: "x" });
    await t.call("2", "read_session", { handle: "h" });
    await t.call("3", "stop_session", { handle: "h" });
    expect(t.answers().map((answer) => answer.text)).toEqual([NOT_YET, NOT_YET, NOT_YET]);
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
});
