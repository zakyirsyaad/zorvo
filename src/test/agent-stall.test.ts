import { describe, it, expect } from "vitest";
import {
  activityKeyOf,
  failureReportOf,
  hasRunningTool,
  isNewsUpdate,
  nextFailures,
  stallNoticeText,
  STALL_MIN_FAILURES,
} from "../lib/agent-stall";
import type { ChatMessage } from "../types";

/** A request lifecycle update as Qwen Code 0.25.2 sends it over ACP. */
function qwenLifecycle(phase: string, outcome?: string) {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "" },
    _meta: {
      executionLifecycle: {
        v: 1,
        kind: "request",
        model: "deepseek-v4.1-flash-1017",
        phase,
        ...(outcome ? { outcome } : {}),
      },
    },
  };
}

/** A retried error as codex-acp sends it to a client without typed session failures. */
function codexRetry(message: string, additionalDetails: string | null = null) {
  return {
    sessionUpdate: "session_info_update",
    _meta: { codex: { error: { message, codexErrorInfo: null, additionalDetails, turnId: "t-1", willRetry: true } } },
  };
}

function agentReply(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: "a-1", role: "agent", content: "", timestamp: 1, ...overrides };
}

describe("failureReportOf", () => {
  it("reads a failed request from Qwen Code's lifecycle metadata, with its model", () => {
    expect(failureReportOf(qwenLifecycle("ended", "error"))).toEqual({
      kind: "failed",
      source: "qwen-lifecycle",
      model: "deepseek-v4.1-flash-1017",
    });
  });

  it("treats a request that ended without an error as recovered", () => {
    expect(failureReportOf(qwenLifecycle("ended", "success"))).toEqual({ kind: "recovered" });
  });

  it("ignores a request that only started", () => {
    expect(failureReportOf(qwenLifecycle("started"))).toBeNull();
  });

  it("reads Codex's retried error and keeps its own words, preferring the details", () => {
    expect(failureReportOf(codexRetry("stream disconnected", "Reconnecting... 2/5"))).toEqual({
      kind: "failed",
      source: "codex",
      detail: "Reconnecting... 2/5",
    });
    expect(failureReportOf(codexRetry("stream disconnected"))).toEqual({
      kind: "failed",
      source: "codex",
      detail: "stream disconnected",
    });
  });

  it("ignores a Codex error that will not be retried: the turn's own error reports it", () => {
    const update = codexRetry("usage limit");
    (update._meta.codex.error as { willRetry: boolean }).willRetry = false;
    expect(failureReportOf(update)).toBeNull();
  });

  it("ignores ordinary updates and malformed metadata", () => {
    expect(failureReportOf({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })).toBeNull();
    expect(failureReportOf({ sessionUpdate: "agent_message_chunk", _meta: { executionLifecycle: "ended" } })).toBeNull();
    expect(failureReportOf(null)).toBeNull();
  });
});

describe("nextFailures", () => {
  it("counts failures in a row and keeps the newest model and detail", () => {
    const once = nextFailures(undefined, { kind: "failed", source: "qwen-lifecycle", model: "m-1" });
    const twice = nextFailures(once, { kind: "failed", source: "qwen-lifecycle", model: "m-1" });
    expect(twice).toEqual({ count: 2, source: "qwen-lifecycle", model: "m-1" });
  });

  it("keeps a detail already read when a later failure carries none", () => {
    const withDetail = { count: 2, source: "qwen-lifecycle" as const, model: "m-1", detail: "429 quota" };
    expect(nextFailures(withDetail, { kind: "failed", source: "qwen-lifecycle", model: "m-1" })).toEqual({
      ...withDetail,
      count: 3,
    });
  });

  it("clears the count once a request goes through", () => {
    expect(nextFailures({ count: 3, source: "codex" }, { kind: "recovered" })).toBeUndefined();
  });
});

describe("isNewsUpdate", () => {
  it("counts text, reasoning, tools and plans, but not empty chunks", () => {
    expect(isNewsUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "O" } })).toBe(true);
    expect(isNewsUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hm" } })).toBe(true);
    expect(isNewsUpdate({ sessionUpdate: "tool_call", toolCallId: "t" })).toBe(true);
    expect(isNewsUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } })).toBe(false);
    expect(isNewsUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "" } })).toBe(false);
  });
});

describe("stallNoticeText", () => {
  it("ends the agent's error with a full stop when it has none", () => {
    expect(
      stallNoticeText("Codex", { failures: { count: 2, source: "codex", detail: "stream disconnected" }, silentForMs: 0 }),
    ).toBe("Codex's requests failed 2 times in a row. Last error: stream disconnected.");
  });

  it("names the agent, the model, the count and the error it reported", () => {
    expect(
      stallNoticeText("Qwen Code", {
        failures: { count: 4, source: "qwen-lifecycle", model: "deepseek-v4.1-flash-1017", detail: "429 Your token-plan quota has been exhausted." },
        silentForMs: 0,
      }),
    ).toBe(
      "Qwen Code's requests to deepseek-v4.1-flash-1017 failed 4 times in a row. Last error: 429 Your token-plan quota has been exhausted.",
    );
  });

  it("says only what it knows when the agent sent no model or error", () => {
    expect(stallNoticeText("Codex", { failures: { count: 2, source: "codex" }, silentForMs: 0 })).toBe(
      "Codex's requests failed 2 times in a row.",
    );
  });

  it(`waits for ${STALL_MIN_FAILURES} failures in a row, since one retried failure is routine`, () => {
    expect(stallNoticeText("Codex", { failures: { count: 1, source: "codex" }, silentForMs: 0 })).toBeNull();
  });

  it("falls back to how long the agent has been silent, with no guess at the cause", () => {
    expect(stallNoticeText("Gemini CLI", { silentForMs: 59_999 })).toBeNull();
    expect(stallNoticeText("Gemini CLI", { silentForMs: 60_000 })).toBe("Gemini CLI hasn't sent anything for 1 minute.");
    expect(stallNoticeText("Gemini CLI", { silentForMs: 185_000 })).toBe("Gemini CLI hasn't sent anything for 3 minutes.");
  });

  it("puts the agent's failure report before its silence", () => {
    expect(stallNoticeText("Qwen Code", { failures: { count: 2, source: "qwen-lifecycle" }, silentForMs: 120_000 })).toBe(
      "Qwen Code's requests failed 2 times in a row.",
    );
  });
});

describe("hasRunningTool", () => {
  it("is true while the turn's last reply has a tool that has not finished", () => {
    const running = agentReply({ tools: [{ id: "t", name: "pnpm build", kind: "execute", status: "running" }] });
    const done = agentReply({ tools: [{ id: "t", name: "pnpm build", kind: "execute", status: "completed" }] });
    expect(hasRunningTool([running])).toBe(true);
    expect(hasRunningTool([done])).toBe(false);
    expect(hasRunningTool([])).toBe(false);
  });
});

describe("activityKeyOf", () => {
  it("changes when the agent writes, thinks or updates a tool, not when nothing arrives", () => {
    const base = [agentReply({ content: "Hel" })];
    expect(activityKeyOf(base)).toBe(activityKeyOf([agentReply({ content: "Hel" })]));
    expect(activityKeyOf([agentReply({ content: "Hello" })])).not.toBe(activityKeyOf(base));
    expect(activityKeyOf([agentReply({ content: "Hel", thinking: "hm" })])).not.toBe(activityKeyOf(base));
  });
});
