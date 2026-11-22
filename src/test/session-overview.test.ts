import { describe, expect, it } from "vitest";
import { overviewOf, pillParts, type OverviewInputs } from "../lib/session-overview";
import type { BackgroundTask } from "../lib/background-tasks";
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

const base: OverviewInputs = { messages: [], isBusy: false, shellTasks: [], pages: [], files: [], pullRequest: null };

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

describe("pillParts", () => {
  it("names only what is not zero", () => {
    expect(pillParts(3, { added: 42, removed: 11 })).toEqual({ running: "3 running", added: 42, removed: 11 });
    expect(pillParts(0, { added: 0, removed: 0 })).toEqual({ running: null, added: 0, removed: 0 });
    expect(pillParts(0, null)).toEqual({ running: null, added: 0, removed: 0 });
  });
});
