import { describe, it, expect } from "vitest";
import {
  DECLINED,
  NOT_YET,
  NO_SESSION,
  delegateResultText,
  listAgentsText,
  parseToolCall,
  resolveAgent,
  statusRefusal,
} from "../lib/agent-tools";

const AGENTS = [
  { id: "qwen-code", name: "Qwen Code" },
  { id: "codex-acp", name: "Codex" },
  { id: "pi-acp", name: "pi ACP" },
];

describe("resolveAgent", () => {
  it("takes an exact id", () => {
    expect(resolveAgent("qwen-code", AGENTS)).toEqual({ id: "qwen-code" });
  });

  it("takes a name whatever its case and surrounding space", () => {
    expect(resolveAgent("  qwen code ", AGENTS)).toEqual({ id: "qwen-code" });
    expect(resolveAgent("CODEX", AGENTS)).toEqual({ id: "codex-acp" });
  });

  it("does not guess from part of a name", () => {
    expect(resolveAgent("qwen", AGENTS)).toEqual({
      error: 'No agent called "qwen". Use one of: qwen-code, codex-acp, pi-acp.',
    });
  });

  it("does not pick between two agents with the same name", () => {
    const twins = [...AGENTS, { id: "codex-two", name: "Codex" }];
    expect(resolveAgent("Codex", twins)).toHaveProperty("error");
    expect(resolveAgent("codex-two", twins)).toEqual({ id: "codex-two" });
  });

  it("shows what was asked for as text, cut at 60 characters", () => {
    const result = resolveAgent(`bad"\nname${"x".repeat(100)}`, AGENTS);
    const error = "error" in result ? result.error : "";
    expect(error).not.toContain("\n");
    expect(error).toContain("\\u000A");
    expect(error.length).toBeLessThan(200);
  });

  it("says so when no agent can be used", () => {
    expect(resolveAgent("codex", [])).toEqual({ error: "No agent can take a task right now." });
  });
});

describe("statusRefusal", () => {
  it("refuses an agent that is not installed or needs a sign-in, and nothing else", () => {
    expect(statusRefusal("Codex", "not-installed")).toBe("Codex isn't installed.");
    expect(statusRefusal("Codex", "needs-sign-in")).toBe("Codex needs a sign-in first. Ask the user to sign in.");
    expect(statusRefusal("Codex", "ready")).toBeNull();
    expect(statusRefusal("Codex", "not-checked")).toBeNull();
  });
});

describe("listAgentsText", () => {
  it("lists usable agents with this session's delegates", () => {
    const text = listAgentsText({
      agents: [
        { id: "qwen-code", name: "Qwen Code", status: "ready" },
        { id: "codex-acp", name: "Codex", status: "not-checked" },
        { id: "claude-acp", name: "Claude Code", status: "needs-sign-in" },
        { id: "kilo", name: "Kilo", status: "not-installed" },
      ],
      delegates: [{ agentId: "qwen-code", state: "working", task: "Review the fix" }],
    });
    expect(JSON.parse(text)).toEqual({
      agents: [
        { id: "qwen-code", name: "Qwen Code", status: "ready", delegate: { state: "working", task: "Review the fix" } },
        { id: "codex-acp", name: "Codex", status: "not-checked" },
        { id: "claude-acp", name: "Claude Code", status: "needs-sign-in" },
      ],
    });
  });

  it("cuts a delegate's task at 200 characters", () => {
    const text = listAgentsText({
      agents: [{ id: "qwen-code", name: "Qwen Code", status: "ready" }],
      delegates: [{ agentId: "qwen-code", state: "idle", task: "t".repeat(500) }],
    });
    expect(JSON.parse(text).agents[0].delegate.task).toHaveLength(200);
  });
});

describe("delegateResultText", () => {
  it("says a delegate started, or that the task was sent to the one that exists", () => {
    expect(JSON.parse(delegateResultText({ kind: "started", sessionName: "Qwen Code: Review", agentName: "Qwen Code" }))).toEqual({
      started: true,
      session: "Qwen Code: Review",
      note: "The answer arrives as a message when Qwen Code finishes. Do not wait for it.",
    });
    expect(JSON.parse(delegateResultText({ kind: "sent", sessionName: "Qwen Code: Review", agentName: "Qwen Code" }))).toMatchObject({
      sent: true,
      session: "Qwen Code: Review",
    });
  });
});

describe("parseToolCall", () => {
  it("reads a call with an object of arguments", () => {
    expect(parseToolCall({ callId: "7", sessionId: "s-1", tool: "delegate", args: { agent: "a", task: "t" } })).toEqual({
      callId: "7",
      sessionId: "s-1",
      tool: "delegate",
      args: { agent: "a", task: "t" },
    });
  });

  it("refuses anything else", () => {
    for (const payload of [
      null,
      "call",
      { callId: 7, sessionId: "s", tool: "t", args: {} },
      { callId: "7", sessionId: "s", tool: "t", args: "text" },
      { callId: "7", sessionId: "s", tool: "t", args: [1] },
      { callId: "7", tool: "t", args: {} },
    ]) {
      expect(parseToolCall(payload)).toBeNull();
    }
  });
});

describe("fixed answers", () => {
  it("are the sentences an agent is told", () => {
    expect(DECLINED).toBe("The user declined.");
    expect(NOT_YET).toBe("This tool is not available yet.");
    expect(NO_SESSION).toBe("This session cannot use Zorvo's tools.");
  });
});
