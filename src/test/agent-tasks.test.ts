import { describe, expect, it } from "vitest";
import {
  canAskAgentTasks,
  isQuiet,
  isWorkingTask,
  launchedAgentCount,
  parseAgentTasks,
  quietMinutes,
  quietMs,
  quietNoticeParts,
  quietShortText,
  quietSpanText,
  QUIET_AFTER_MS,
  REPORTS_TASKS,
  type AgentTask,
} from "../lib/agent-tasks";
import type { ChatMessage, ToolExecution } from "../types";

const rawTask = (over: Record<string, unknown> = {}) => ({
  id: "agent-1",
  label: "Explore",
  description: "Find the auth flow",
  status: "working",
  startedAt: 100,
  isBackground: true,
  activities: [],
  ...over,
});

describe("parseAgentTasks", () => {
  it("reads the command's answer", () => {
    const parsed = parseAgentTasks({
      tasks: [rawTask({ endedAt: 200, agentType: "Explore", toolUseId: "call_1", activities: [{ name: "grep", description: "x", at: 5 }] })],
      more: 2,
    });
    expect(parsed).toEqual({
      more: 2,
      tasks: [
        {
          id: "agent-1",
          label: "Explore",
          description: "Find the auth flow",
          status: "working",
          startedAt: 100,
          endedAt: 200,
          agentType: "Explore",
          toolUseId: "call_1",
          isBackground: true,
          activities: [{ name: "grep", description: "x", at: 5 }],
        },
      ],
    });
  });

  it("gives null for a shape it does not know", () => {
    for (const value of [null, "x", 3, [], {}, { tasks: {} }, { tasks: [], more: -1 }, { tasks: [], more: "1" }]) {
      expect(parseAgentTasks(value)).toBeNull();
    }
  });

  it("drops an entry that is not a task, and reads an unknown status as unknown", () => {
    const parsed = parseAgentTasks({ tasks: ["x", rawTask({ id: "" }), rawTask({ id: "b", status: "odd" }), rawTask({ id: "c", activities: "no" })], more: 0 });
    expect(parsed?.tasks.map((task) => [task.id, task.status])).toEqual([
      ["b", "unknown"],
      ["c", "working"],
    ]);
    expect(parsed?.tasks[1].activities).toEqual([]);
  });

  it("cuts a string again and keeps only the newest five activities", () => {
    const activities = Array.from({ length: 8 }, (_, n) => ({ name: `t${n}`, description: "d".repeat(500), at: n }));
    const parsed = parseAgentTasks({ tasks: [rawTask({ label: "l".repeat(500), activities })], more: 0 });
    expect(parsed?.tasks[0].label).toHaveLength(120);
    expect(parsed?.tasks[0].activities.map((a) => a.name)).toEqual(["t3", "t4", "t5", "t6", "t7"]);
    expect(parsed?.tasks[0].activities[0].description).toHaveLength(200);
  });

  it("refuses a time above the largest safe integer", () => {
    const parsed = parseAgentTasks({ asOf: 2 ** 60, tasks: [rawTask({ startedAt: 2 ** 63, endedAt: Number.MAX_SAFE_INTEGER, lastActivityAt: 2 ** 55 })], more: 0 });
    expect(parsed?.asOf).toBeUndefined();
    expect(parsed?.tasks[0].startedAt).toBeUndefined();
    expect(parsed?.tasks[0].lastActivityAt).toBeUndefined();
    expect(parsed?.tasks[0].endedAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("keeps the answer's clock and a task's last activity", () => {
    const parsed = parseAgentTasks({ asOf: 900, tasks: [rawTask({ lastActivityAt: 800 })], more: 0 });
    expect(parsed?.asOf).toBe(900);
    expect(parsed?.tasks[0].lastActivityAt).toBe(800);
  });

  it("keeps a time only when it is a finite, non-negative number", () => {
    const parsed = parseAgentTasks({ tasks: [rawTask({ startedAt: -1, endedAt: "5" })], more: 0 });
    expect(parsed?.tasks[0].startedAt).toBeUndefined();
    expect(parsed?.tasks[0].endedAt).toBeUndefined();
  });
});

describe("isWorkingTask", () => {
  const task = (status: AgentTask["status"], endedAt?: number): AgentTask => ({
    id: "a", label: "", description: "", status, isBackground: true, activities: [], ...(endedAt === undefined ? {} : { endedAt }),
  });
  it("counts working, and unknown only while it has no end", () => {
    expect(isWorkingTask(task("working"))).toBe(true);
    expect(isWorkingTask(task("unknown"))).toBe(true);
    expect(isWorkingTask(task("unknown", 9))).toBe(false);
    expect(isWorkingTask(task("done"))).toBe(false);
    expect(isWorkingTask(task("failed"))).toBe(false);
    expect(isWorkingTask(task("stopped"))).toBe(false);
  });
});

const tool = (id: string, providerToolName?: string): ToolExecution =>
  ({ id, name: id, status: "completed", ...(providerToolName ? { providerToolName } : {}) }) as ToolExecution;
const reply = (tools: ToolExecution[]): ChatMessage =>
  ({ id: `m-${tools[0]?.id}`, role: "agent", content: "", timestamp: 1, isComplete: true, tools }) as ChatMessage;

describe("launchedAgentCount", () => {
  it("counts Qwen Code's agent tool calls in every reply, and nothing else", () => {
    const messages = [
      { id: "u", role: "user", content: "go", timestamp: 1 } as ChatMessage,
      reply([tool("a", "agent"), tool("b", "Agent"), tool("c", "read_file"), tool("d")]),
      reply([tool("e", "agent")]),
    ];
    expect(launchedAgentCount(messages)).toBe(3);
    expect(launchedAgentCount([])).toBe(0);
  });

  it("does not count Claude's Task", () => {
    expect(launchedAgentCount([reply([tool("t", "Task")])])).toBe(0);
  });
});

describe("canAskAgentTasks", () => {
  it("asks only for a running Qwen Code session that launched an agent", () => {
    expect(REPORTS_TASKS.has("qwen-code")).toBe(true);
    expect(canAskAgentTasks({ agentId: "qwen-code", isRunning: true, launched: 1 })).toBe(true);
    expect(canAskAgentTasks({ agentId: "qwen-code", isRunning: true, launched: 0 })).toBe(false);
    expect(canAskAgentTasks({ agentId: "qwen-code", isRunning: false, launched: 2 })).toBe(false);
    expect(canAskAgentTasks({ agentId: "claude-acp", isRunning: true, launched: 2 })).toBe(false);
    expect(canAskAgentTasks({ agentId: undefined, isRunning: true, launched: 2 })).toBe(false);
  });
});

describe("quiet agents", () => {
  const MIN = 60_000;
  const working = (over: Partial<AgentTask> = {}): AgentTask => ({
    id: "a", label: "A", description: "", status: "working", isBackground: true, activities: [], startedAt: 0, lastActivityAt: 0, ...over,
  });

  it("measures the silence against the answer's clock, and is 0 for what cannot be told", () => {
    expect(QUIET_AFTER_MS).toBe(5 * MIN);
    expect(quietMs(working({ lastActivityAt: 1000 }), 1000 + 7 * MIN)).toBe(7 * MIN);
    expect(quietMs(working(), undefined)).toBe(0);
    expect(quietMs(working({ lastActivityAt: undefined }), 10 * MIN)).toBe(0);
    expect(quietMs(working({ lastActivityAt: 5 * MIN }), MIN)).toBe(0);
    expect(quietMs(working({ status: "done" }), 99 * MIN)).toBe(0);
  });

  it("is quiet from five minutes, not before", () => {
    expect(isQuiet(working(), 5 * MIN - 1)).toBe(false);
    expect(isQuiet(working(), 5 * MIN)).toBe(true);
    expect(isQuiet(working({ status: "failed" }), 60 * MIN)).toBe(false);
  });

  it("rounds minutes down and says hours past 90 minutes", () => {
    expect(quietMinutes(5 * MIN + 59_000)).toBe(5);
    expect(quietSpanText(5)).toBe("5 minutes");
    expect(quietSpanText(55)).toBe("55 minutes");
    expect(quietSpanText(90)).toBe("90 minutes");
    expect(quietSpanText(95)).toBe("1 hour 35 minutes");
    expect(quietSpanText(120)).toBe("2 hours");
    expect(quietSpanText(121)).toBe("2 hours 1 minute");
    expect(quietSpanText(61 + 60)).toBe("2 hours 1 minute");
    expect(quietSpanText(91)).toBe("1 hour 31 minutes");
    expect(quietShortText(95)).toBe("1 h 35 min");
  });

  it("words the notice for one agent and for several, with the longest time", () => {
    const one = quietNoticeParts("Qwen Code", [working(), working({ id: "b", status: "done" })], 55 * MIN);
    expect(one).toEqual({
      title: "A background agent of Qwen Code has not reported anything for 55 minutes.",
      body: "It may be waiting on the model or running a long tool. Send a message to check.",
    });
    const many = quietNoticeParts("Qwen Code", [working({ lastActivityAt: 10 * MIN }), working({ id: "b", lastActivityAt: 0 }), working({ id: "c", lastActivityAt: 59 * MIN })], 100 * MIN);
    expect(many?.title).toBe("3 of Qwen Code's background agents have not reported anything for 1 hour 40 minutes.");
    expect(many?.body).toBe("They may be waiting on the model or running a long tool. Send a message to check.");
    expect(quietNoticeParts(undefined, [working()], 55 * MIN)?.title).toBe("A background agent has not reported anything for 55 minutes.");
    expect(quietNoticeParts(undefined, [working(), working({ id: "b" })], 55 * MIN)?.title).toBe("2 background agents have not reported anything for 55 minutes.");
    expect(quietNoticeParts("Qwen Code", [working({ lastActivityAt: 58 * MIN })], 60 * MIN)).toBeNull();
    expect(quietNoticeParts("Qwen Code", [], 60 * MIN)).toBeNull();
    expect(quietNoticeParts("Qwen Code", [working()], undefined)).toBeNull();
  });
});
