import { describe, expect, it } from "vitest";
import { canAskAgentTasks, isWorkingTask, launchedAgentCount, parseAgentTasks, REPORTS_TASKS, type AgentTask } from "../lib/agent-tasks";
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
