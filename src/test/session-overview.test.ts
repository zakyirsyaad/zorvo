import { describe, expect, it } from "vitest";
import { overviewOf, pillRunning, type OverviewInputs } from "../lib/session-overview";
import type { BackgroundTask } from "../lib/background-tasks";
import type { AgentTask } from "../lib/agent-tasks";
import type { ChatMessage, ToolExecution } from "../types";

function subagent(id: string, status: ToolExecution["status"], startedAt: number): ToolExecution {
  return { id, name: `Explore ${id}`, title: `Agent: explore ${id}`, kind: "other", status, startedAt, steps: [], agentType: "Explore" } as ToolExecution;
}

const user = (id: string, attachments?: string[]): ChatMessage => ({ id, role: "user", content: "go", timestamp: 1, ...(attachments ? { attachments } : {}) });
const reply = (id: string, tools: ToolExecution[], isComplete = true): ChatMessage => ({
  id,
  role: "agent",
  content: "",
  timestamp: 2,
  isComplete,
  tools,
  parts: [{ kind: "tools", toolIds: tools.map((tool) => tool.id) }],
});

const shell = (id: string, startedAt: number): BackgroundTask => ({
  id,
  kind: "shell",
  name: "pnpm tauri dev",
  detail: "localhost:1420",
  status: "Running",
  startedAt,
  sessionId: "s-1",
});

const base: OverviewInputs = { messages: [], isBusy: false, shellTasks: [], pages: [], files: [], pullRequests: [] };

describe("a shell command's row", () => {
  it("is titled by its program, keeps the whole command for a tooltip, and says its ports, not its session", () => {
    const task: BackgroundTask = {
      id: "p9",
      kind: "shell",
      name: "/Users/me/tools/node/bin/node /Users/me/app/server.js --port 1420",
      detail: "Fix login bug · localhost:1420",
      status: "Running",
      startedAt: 5,
      sessionId: "s-1",
    };
    const [row] = overviewOf({ ...base, shellTasks: [task] }).tasks;
    expect(row).toMatchObject({
      title: "node server.js --port 1420",
      fullTitle: "/Users/me/tools/node/bin/node /Users/me/app/server.js --port 1420",
      detail: "Shell · localhost:1420",
    });
    const [plain] = overviewOf({ ...base, shellTasks: [{ ...task, name: "pnpm dev", detail: "Fix login bug" }] }).tasks;
    expect(plain).toMatchObject({ title: "pnpm dev", detail: "Shell" });
    expect(plain.fullTitle).toBeUndefined();
    // A character that reshapes text shows in the tooltip as what it is.
    const [hidden] = overviewOf({ ...base, shellTasks: [{ ...task, name: "/Users/me/bin/tool \u202Egnp.exe" }] }).tasks;
    expect(hidden.fullTitle).not.toContain("\u202E");
    expect(hidden.fullTitle).toContain("tool");
  });
});

describe("overviewOf", () => {
  it("lists running subagents and shell commands newest first, with the finished folded apart", () => {
    const overview = overviewOf({
      ...base,
      isBusy: true,
      messages: [user("u1"), reply("a1", [subagent("done", "completed", 10), subagent("live", "running", 30)], false)],
      shellTasks: [shell("p1", 20)],
    });

    expect(overview.tasks.map((task) => task.key)).toEqual(["subagent:live", "shell:p1"]);
    expect(overview.finished.map((task) => task.key)).toEqual(["subagent:done"]);
    expect(overview.runningCount).toBe(2);
    expect(overview.tasks[0]).toMatchObject({ detail: "Subagent · Explore · 0 steps", tab: { kind: "subagent", toolId: "live" } });
    expect(overview.tasks[1]).toMatchObject({ detail: "Shell · localhost:1420", tab: { kind: "shell", taskId: "p1" } });
  });

  it("keeps a failed task in sight, after the ones at work, and not in the running count", () => {
    const overview = overviewOf({
      ...base,
      isBusy: true,
      messages: [user("u1"), reply("a1", [subagent("broke", "failed", 40), subagent("live", "running", 30)], false)],
    });

    expect(overview.tasks.map((task) => [task.key, task.state])).toEqual([
      ["subagent:live", "running"],
      ["subagent:broke", "failed"],
    ]);
    expect(overview.runningCount).toBe(1);
  });

  it("counts a subagent left running in an ended turn as finished, not running", () => {
    const overview = overviewOf({
      ...base,
      isBusy: true,
      messages: [user("u1"), reply("a1", [subagent("stale", "running", 10)]), user("u2"), reply("a2", [], false)],
    });

    expect(overview.tasks).toEqual([]);
    expect(overview.finished.map((task) => task.status)).toEqual(["Did not finish"]);
  });

  it("leaves out a tool that is not a marked subagent", () => {
    const plain = { ...subagent("plain", "running", 5), steps: undefined };
    expect(overviewOf({ ...base, isBusy: true, messages: [user("u1"), reply("a1", [plain], false)] }).tasks).toEqual([]);
  });

  it("lists the files the user attached, newest first, each once", () => {
    const overview = overviewOf({
      ...base,
      messages: [user("u1", ["/w/a.ts", "/tmp/paste-1.png"]), reply("a1", []), user("u2", ["/w/b.md", "/w/a.ts"])],
    });

    expect(overview.sources).toEqual([
      { path: "/w/a.ts", isImage: false },
      { path: "/w/b.md", isImage: false },
      { path: "/tmp/paste-1.png", isImage: true },
    ]);
  });
});

describe("pillRunning", () => {
  it("says how many tasks run, and nothing when none does", () => {
    expect(pillRunning(3)).toBe("3 running");
    expect(pillRunning(0)).toBeNull();
  });
});

const bgTask = (id: string, over: Partial<AgentTask> = {}): AgentTask => ({
  id,
  label: `Agent ${id}`,
  description: "",
  status: "working",
  startedAt: 50,
  isBackground: true,
  activities: [],
  ...over,
});

describe("overviewOf with Qwen Code's background agents", () => {
  it("lists them in Running, newest first among the other tasks, and counts the ones at work", () => {
    const overview = overviewOf({
      ...base,
      messages: [user("u1"), reply("a1", [subagent("fg", "running", 10)], false)],
      isBusy: true,
      agentTasks: [bgTask("old", { startedAt: 15 }), bgTask("new", { startedAt: 60 })],
    });

    expect(overview.tasks.map((task) => task.key)).toEqual(["agent-task:new", "agent-task:old", "subagent:fg"]);
    expect(overview.runningCount).toBe(3);
    expect(overview.tasks[0]).toMatchObject({ kind: "subagent", state: "running", status: "Working", title: "Agent new" });
    expect(overview.tasks[0].tab).toBeUndefined();
  });

  it("folds a paused agent with the finished rows and does not count it as running", () => {
    const overview = overviewOf({ ...base, agentTasks: [bgTask("p", { status: "stopped", endedAt: 40 })] });
    expect(overview.tasks).toEqual([]);
    expect(overview.finished.map((task) => [task.key, task.status])).toEqual([["agent-task:p", "Did not finish"]]);
    expect(overview.runningCount).toBe(0);
  });

  it("calls a working agent Quiet after five minutes without news, counted as running, with how long and its last activity", () => {
    const MIN = 60_000;
    const quiet = bgTask("q", { lastActivityAt: 0, activities: [{ name: "run_shell_command\n", description: "", at: 0 }] });
    const fresh = bgTask("f", { startedAt: 60, lastActivityAt: 54 * MIN });
    const overview = overviewOf({ ...base, agentTasksAsOf: 55 * MIN, agentTasks: [quiet, fresh] });
    const row = (key: string) => overview.tasks.find((task) => task.key === key);
    expect(row("agent-task:q")).toMatchObject({
      status: "Quiet",
      state: "running",
      detail: "No activity for 55 min. Last: run_shell_command\\u000A",
    });
    expect(row("agent-task:f")).toMatchObject({ status: "Working" });
    expect(overview.runningCount).toBe(2);
  });

  it("says hours and minutes past 90 minutes, and no Last when it did nothing yet", () => {
    const overview = overviewOf({ ...base, agentTasksAsOf: 95 * 60_000, agentTasks: [bgTask("q", { lastActivityAt: 0 })] });
    expect(overview.tasks[0].detail).toBe("No activity for 1 h 35 min");
  });

  it("says Done, Failed and Did not finish, and folds the finished ones", () => {
    const overview = overviewOf({
      ...base,
      agentTasks: [
        bgTask("done", { status: "done", endedAt: 90 }),
        bgTask("bad", { status: "failed" }),
        bgTask("stop", { status: "stopped" }),
        bgTask("live"),
      ],
    });

    expect(overview.tasks.map((task) => [task.key, task.state, task.status])).toEqual([
      ["agent-task:live", "running", "Working"],
      ["agent-task:bad", "failed", "Failed"],
    ]);
    expect(overview.finished.map((task) => [task.key, task.status])).toEqual([
      ["agent-task:done", "Done"],
      ["agent-task:stop", "Did not finish"],
    ]);
    expect(overview.runningCount).toBe(1);
  });

  it("reads an unknown status as Working only while it has not ended", () => {
    const overview = overviewOf({
      ...base,
      agentTasks: [bgTask("open", { status: "unknown" }), bgTask("shut", { status: "unknown", endedAt: 70 })],
    });
    expect(overview.tasks.map((task) => task.key)).toEqual(["agent-task:open"]);
    expect(overview.finished.map((task) => [task.key, task.status])).toEqual([["agent-task:shut", "Done"]]);
  });

  it("titles a row by its label, else its description, else Background agent", () => {
    const overview = overviewOf({
      ...base,
      agentTasks: [
        bgTask("a", { label: "", description: "Find it", startedAt: 3 }),
        bgTask("b", { label: "", description: "", startedAt: 2 }),
        bgTask("c", { label: "Named", startedAt: 1 }),
      ],
    });
    expect(overview.tasks.map((task) => task.title)).toEqual(["Find it", "Background agent", "Named"]);
  });

  it("uses the newest activity as the second line, else the agent type", () => {
    const overview = overviewOf({
      ...base,
      agentTasks: [
        bgTask("a", { startedAt: 3, activities: [{ name: "read_file", description: "a.ts", at: 1 }, { name: "grep", description: "foo", at: 2 }] }),
        bgTask("b", { startedAt: 2, agentType: "Explore" }),
        bgTask("c", { startedAt: 1, activities: [{ name: "think", description: "", at: 1 }] }),
        bgTask("d", { startedAt: 0 }),
      ],
    });
    expect(overview.tasks.map((task) => task.detail)).toEqual(["grep: foo", "Explore", "think", "Subagent"]);
  });

  it("leaves out a task a foreground subagent with steps already shows", () => {
    const overview = overviewOf({
      ...base,
      messages: [user("u1"), reply("a1", [subagent("call_1", "running", 10)], false)],
      isBusy: true,
      agentTasks: [bgTask("dup", { toolUseId: "call_1" }), bgTask("other", { toolUseId: "call_9" })],
    });
    expect(overview.tasks.map((task) => task.key)).toEqual(["agent-task:other", "subagent:call_1"]);
  });

  it("keeps a task whose launching tool shows no steps", () => {
    const plain = { id: "call_2", name: "Agent", status: "completed", providerToolName: "agent" } as ToolExecution;
    const overview = overviewOf({
      ...base,
      messages: [user("u1"), reply("a1", [plain])],
      agentTasks: [bgTask("bg", { toolUseId: "call_2" })],
    });
    expect(overview.tasks.map((task) => task.key)).toEqual(["agent-task:bg"]);
  });

  it("shows what the agent wrote with line breaks and direction marks made visible", () => {
    const overview = overviewOf({
      ...base,
      agentTasks: [
        bgTask("x", { label: "Fix\nit \u202Eevil", activities: [{ name: "run\r", description: "a\u200Bb", at: 1 }] }),
      ],
    });
    expect(overview.tasks[0].title).toBe("Fix\\u000Ait \\u202Eevil");
    expect(overview.tasks[0].detail).toBe("run\\u000D: a\\u200Bb");
  });
});
