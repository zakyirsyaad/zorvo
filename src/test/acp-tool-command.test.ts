import { describe, expect, it } from "vitest";
import { applyAcpUpdate, MAX_COMMAND_LENGTH, type AcpReducerContext } from "../lib/acp-events";
import type { ChatMessage } from "../types";

function ctx(): AcpReducerContext {
  let n = 0;
  return { sessionId: "s-1", now: 1000, createId: (prefix) => `${prefix}-${++n}` };
}

const call = (rawInput: unknown) => ({
  sessionUpdate: "tool_call",
  toolCallId: "t-1",
  title: "Run",
  kind: "execute",
  status: "in_progress",
  rawInput,
});

const toolOf = (messages: ChatMessage[]) => messages[messages.length - 1].tools?.[0];

describe("a tool's command", () => {
  it("keeps a command given as a string", () => {
    expect(toolOf(applyAcpUpdate([], call({ command: "ls -la" }), ctx()))?.command).toBe("ls -la");
  });

  it("keeps a command given as an array, quoting an element with a space", () => {
    expect(toolOf(applyAcpUpdate([], call({ command: ["bash", "-lc", "ls -la"] }), ctx()))?.command).toBe(`bash -lc "ls -la"`);
  });

  it("reads cmd when there is no command", () => {
    expect(toolOf(applyAcpUpdate([], call({ cmd: "pwd" }), ctx()))?.command).toBe("pwd");
  });

  it("ignores a command of the wrong type", () => {
    expect(toolOf(applyAcpUpdate([], call({ command: 5 }), ctx()))?.command).toBeUndefined();
  });

  it("cuts a long command and says so", () => {
    const command = toolOf(applyAcpUpdate([], call({ command: "x".repeat(2500) }), ctx()))?.command ?? "";
    expect(command).toHaveLength(MAX_COMMAND_LENGTH);
    expect(command.endsWith("…")).toBe(true);
  });

  it("takes a command from a later update", () => {
    const started = applyAcpUpdate([], call(undefined), ctx());
    const updated = applyAcpUpdate(started, { sessionUpdate: "tool_call_update", toolCallId: "t-1", rawInput: { command: "pwd" } }, ctx());
    expect(toolOf(updated)?.command).toBe("pwd");
  });
});

describe("known paths", () => {
  const edit = {
    sessionUpdate: "tool_call",
    toolCallId: "t-1",
    title: "Edit",
    kind: "edit",
    status: "in_progress",
    locations: [{ path: "/repo/a.ts" }],
    content: [{ type: "diff", path: "/repo/a.ts", oldText: "a", newText: "b" }],
  };

  it("keeps known locations against an empty update", () => {
    const updated = applyAcpUpdate(applyAcpUpdate([], edit, ctx()), { sessionUpdate: "tool_call_update", toolCallId: "t-1", locations: [] }, ctx());
    expect(toolOf(updated)?.locations).toEqual(["/repo/a.ts"]);
  });

  it("keeps known details against an empty update", () => {
    const updated = applyAcpUpdate(applyAcpUpdate([], edit, ctx()), { sessionUpdate: "tool_call_update", toolCallId: "t-1", content: [] }, ctx());
    expect(toolOf(updated)?.details).toHaveLength(1);
  });

  it("keeps the path of a diff too large to hold", () => {
    const big = { ...edit, content: [{ type: "diff", path: "/repo/a.ts", oldText: null, newText: "x".repeat(300_000) }] };
    expect(toolOf(applyAcpUpdate([], big, ctx()))?.details).toEqual([{ kind: "changed", path: "/repo/a.ts" }]);
  });
});
