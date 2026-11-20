import { describe, it, expect } from "vitest";
import {
  activityKeyOf,
  failureReportOf,
  isNewsUpdate,
  nextFailures,
  runningToolOf,
  stallNoticeParts,
  stallNoticeText,
  STALL_MIN_FAILURES,
  STALL_TOOL_SILENCE_MS,
  STOP_IGNORED_MS,
  stopIgnoredParts,
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

/** OpenCode V2 2.2.6's retry extension, including its clear-on-next-step update. */
function opencodeRetry(attempt: number | null = 2, message = 'Streaming response failed: [500] Internal server error') {
  return {
    sessionUpdate: 'session_info_update',
    _meta: { 'opencode/retry': attempt === null ? null : { attempt, nextRetryAt: '2026-11-20T14:59:05.476Z', error: { type: 'provider.internal', message } } },
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

  it('reads the actual OpenCode retry message and absolute attempt', () => {
    expect(failureReportOf(opencodeRetry())).toEqual({
      kind: 'failed', source: 'opencode', attempt: 2,
      detail: 'Streaming response failed: [500] Internal server error',
    });
    expect(failureReportOf(opencodeRetry(null))).toEqual({ kind: 'recovered', source: 'opencode' });
  });

  it('ignores malformed OpenCode retries and unrelated update kinds', () => {
    const retry = opencodeRetry()._meta['opencode/retry'];
    for (const value of [
      undefined, 'retry', {}, { ...retry, attempt: 0 }, { ...retry, attempt: -1 },
      { ...retry, attempt: 1.5 }, { ...retry, attempt: Number.MAX_SAFE_INTEGER + 1 },
      { ...retry, nextRetryAt: 'later' }, { ...retry, nextRetryAt: 1795186745476 },
      { ...retry, nextRetryAt: '2026-02-30T14:59:05.476Z' },
      { ...retry, error: 'failed' }, { ...retry, error: { message: '' } },
    ]) {
      expect(failureReportOf({ sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': value } })).toBeNull();
    }
    expect(failureReportOf({ ...opencodeRetry(), sessionUpdate: 'tool_call_update' })).toBeNull();
    expect(failureReportOf({ ...opencodeRetry(null), sessionUpdate: 'tool_call_update' })).toBeNull();
  });

  it('bounds and escapes the message without exposing the raw provider response', () => {
    const update = opencodeRetry(2, `bad\u202E${'x'.repeat(900)}`);
    Object.assign(update._meta['opencode/retry']!.error, { response: { body: 'private provider body' } });
    const report = failureReportOf(update);
    expect(report?.kind === 'failed' && 'detail' in report ? report.detail : '').toHaveLength(500);
    expect(report?.kind === 'failed' && 'detail' in report ? report.detail : '').toContain('bad\\u202E');
    expect(JSON.stringify(report)).not.toContain('private provider body');
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

  it('uses OpenCode absolute attempts and does not count duplicate or stale updates twice', () => {
    const first = nextFailures(undefined, failureReportOf(opencodeRetry(1))!);
    expect(first).toEqual({ count: 1, source: 'opencode', detail: 'Streaming response failed: [500] Internal server error' });
    const second = nextFailures(first, failureReportOf(opencodeRetry(2))!);
    expect(second?.count).toBe(2);
    expect(nextFailures(second, failureReportOf(opencodeRetry(2))!)).toBe(second);
    expect(nextFailures(second, failureReportOf(opencodeRetry(1, 'older error'))!)).toBe(second);
    expect(nextFailures(second, failureReportOf(opencodeRetry(4))!)?.count).toBe(4);
    expect(nextFailures(second, failureReportOf(opencodeRetry(null))!)).toBeUndefined();
  });

  it('does not clear or inherit another provider\'s failure state', () => {
    const previous = { count: 4, source: 'qwen-lifecycle' as const, model: 'qwen', detail: 'Qwen error' };
    expect(nextFailures(previous, failureReportOf(opencodeRetry(null))!)).toBe(previous);
    const current = nextFailures(previous, failureReportOf(opencodeRetry(1))!);
    expect(current).toEqual({ count: 1, source: 'opencode', detail: 'Streaming response failed: [500] Internal server error' });
    expect(nextFailures(current, { kind: 'failed', source: 'codex', detail: 'Codex error' })).toEqual({ count: 1, source: 'codex', detail: 'Codex error' });
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

  it('shows the reported OpenCode server error after repeated retries', () => {
    const failures = nextFailures(undefined, failureReportOf(opencodeRetry())!);
    expect(stallNoticeText('OpenCode V2', { failures, silentForMs: 0 })).toBe("OpenCode V2's requests failed 2 times in a row. Last error: Streaming response failed: [500] Internal server error.");
    expect(stallNoticeText('OpenCode V2', { failures: nextFailures(undefined, failureReportOf(opencodeRetry(1))!), silentForMs: 0 })).toBeNull();
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
    // "It may be stuck" is the spec's line: it says what you may see, not why.
    expect(stallNoticeText("Gemini CLI", { silentForMs: 59_999 })).toBeNull();
    expect(stallNoticeText("Gemini CLI", { silentForMs: 60_000 })).toBe("Gemini CLI hasn't sent anything for 1 minute. It may be stuck.");
    expect(stallNoticeText("Gemini CLI", { silentForMs: 185_000 })).toBe("Gemini CLI hasn't sent anything for 3 minutes. It may be stuck.");
  });

  it("puts the agent's failure report before its silence", () => {
    expect(stallNoticeText("Qwen Code", { failures: { count: 2, source: "qwen-lifecycle" }, silentForMs: 120_000 })).toBe(
      "Qwen Code's requests failed 2 times in a row.",
    );
  });
});

describe("runningToolOf", () => {
  it("names the first tool of the turn's last reply that has not finished", () => {
    const tools = [
      { id: "a", name: "Read file", kind: "read" as const, status: "completed" as const },
      { id: "b", name: "Glob: '**/btc-eth-540.png'", kind: "search" as const, status: "running" as const },
      { id: "c", name: "pnpm build", kind: "execute" as const, status: "running" as const },
    ];
    expect(runningToolOf([agentReply({ tools })])).toBe("Glob: '**/btc-eth-540.png'");
    expect(runningToolOf([agentReply({ tools: [tools[0]] })])).toBeUndefined();
    expect(runningToolOf([])).toBeUndefined();
  });

  it("spells out control and bidi characters and cuts a long name", () => {
    const name = `rm\u202E${"x".repeat(200)}`;
    const shown = runningToolOf([agentReply({ tools: [{ id: "t", name, kind: "execute", status: "running" }] })]);
    expect(shown).not.toContain("\u202E");
    expect(shown?.startsWith("rm\\u202E")).toBe(true);
    expect(shown?.length).toBeLessThanOrEqual(81);
    expect(shown?.endsWith("…")).toBe(true);
  });
});

describe("a tool that runs for long", () => {
  const glob = "Glob: '**/btc-eth-540.png'";

  it("stays quiet for five minutes without news, since builds and tests take a while", () => {
    expect(STALL_TOOL_SILENCE_MS).toBe(5 * 60_000);
    expect(stallNoticeParts("Qwen Code", { runningTool: glob, silentForMs: STALL_TOOL_SILENCE_MS - 1 })).toBeNull();
  });

  it("then names the agent, how long and the tool, with no guess at the cause", () => {
    expect(stallNoticeParts("Qwen Code", { runningTool: glob, silentForMs: 12 * 60_000 + 5_000 })).toEqual({
      title: "Qwen Code has been running one tool for 12 minutes.",
      body: `${glob}. It may be stuck.`,
    });
  });

  it("still puts the agent's failure report first", () => {
    expect(
      stallNoticeText("Qwen Code", { failures: { count: 2, source: "qwen-lifecycle" }, runningTool: glob, silentForMs: 10 * 60_000 }),
    ).toBe("Qwen Code's requests failed 2 times in a row.");
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

describe("stallNoticeParts", () => {
  it("ends the title at 'in a row.' even when the model and the error hold periods", () => {
    const parts = stallNoticeParts("Qwen Code", {
      failures: { count: 4, source: "qwen-lifecycle", model: "qwen3.5-coder", detail: "503 from api.example.com. Retry later" },
      silentForMs: 0,
    });
    expect(parts).toEqual({
      title: "Qwen Code's requests to qwen3.5-coder failed 4 times in a row.",
      body: "Last error: 503 from api.example.com. Retry later.",
    });
  });

  it("has no body for failures without a detail, and splits silence into the fact and the guess", () => {
    expect(stallNoticeParts("Codex", { failures: { count: 3, source: "codex" }, silentForMs: 0 })).toEqual({
      title: "Codex's requests failed 3 times in a row.",
      body: undefined,
    });
    expect(stallNoticeParts("Codex", { silentForMs: 120_000 })).toEqual({
      title: "Codex hasn't sent anything for 2 minutes.",
      body: "It may be stuck.",
    });
    expect(stallNoticeParts("Codex", { silentForMs: 1_000 })).toBeNull();
  });
});

describe("a Stop the agent does not act on", () => {
  it("waits ten seconds, as an agent may finish a step before it ends the turn", () => {
    expect(STOP_IGNORED_MS).toBe(10_000);
  });

  it("says the agent has not stopped and what End agent does", () => {
    expect(stopIgnoredParts("Qwen Code")).toEqual({
      title: "Qwen Code hasn't stopped.",
      body: "End agent stops its process now. You can continue this session afterwards.",
    });
  });
});
