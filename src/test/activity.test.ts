import { describe, expect, it } from "vitest";
import { activityOf, reportedPath, statusWord, unreportedFiles, type ActivityEntry } from "../lib/activity";
import type { ActionCard, ChatMessage, ToolExecution } from "../types";
import type { FileStat } from "../lib/diff-stats";

const reply = (tools: Partial<ToolExecution>[], extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m-1",
  role: "agent",
  content: "",
  timestamp: 500,
  tools: tools.map((tool, index) => ({ id: `t-${index}`, name: "Tool", status: "completed", startedAt: 1000, ...tool })),
  ...extra,
});

const card = (patch: Partial<ActionCard>): ActionCard => ({
  id: "c-1",
  sessionId: "s-1",
  title: "Permission requested",
  prompt: "Run rm",
  status: "pending",
  timestamp: 900,
  options: [
    { optionId: "yes", name: "Allow", kind: "allow_once" },
    { optionId: "no", name: "Reject", kind: "reject_once" },
  ],
  ...patch,
});

const stat = (path: string, oldPath: string | null = null): FileStat => ({
  path,
  oldPath,
  kind: "modified",
  added: 1,
  removed: 0,
  isBinary: false,
  fingerprint: path,
});

const targets = { root: "/private/tmp/r", prefix: "" };
const entriesOf = (tools: Partial<ToolExecution>[]) => activityOf([reply(tools)]).entries;

describe("activityOf", () => {
  it("gives one entry for a file named by both locations and a diff, without its line", () => {
    const entries = entriesOf([
      { kind: "edit", locations: ["/r/a.ts:12"], details: [{ kind: "diff", path: "/r/a.ts", oldText: "a", newText: "b" }] },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "file", path: "/r/a.ts", action: "changed" });
  });

  it.each([
    ["edit", "changed"],
    ["delete", "changed"],
    ["move", "changed"],
    ["read", "read"],
    ["search", "read"],
    ["other", "touched"],
  ])("reads a %s tool as %s", (kind, action) => {
    expect(entriesOf([{ kind, locations: ["/r/a.ts"] }])[0]).toMatchObject({ action });
  });

  it("names a too-large change by its path", () => {
    expect(entriesOf([{ kind: "other", details: [{ kind: "changed", path: "/r/a.ts" }] }])[0]).toMatchObject({ path: "/r/a.ts", action: "changed" });
  });

  it("gives an edit naming no file an entry from its name", () => {
    expect(entriesOf([{ kind: "edit", name: "Edit something" }])[0]).toMatchObject({ kind: "file", path: "Edit something", action: "changed", isNamed: false });
  });

  it("gives an execute tool a command entry and touched files", () => {
    const entries = entriesOf([{ kind: "execute", name: "Run", command: "ls", locations: ["/r/a.ts"] }]);
    expect(entries[0]).toMatchObject({ kind: "command", command: "ls" });
    expect(entries[1]).toMatchObject({ kind: "file", path: "/r/a.ts", action: "touched" });
  });

  it("falls back to the tool's name for a command", () => {
    expect(entriesOf([{ kind: "execute", name: "ls -la" }])[0]).toMatchObject({ command: "ls -la" });
  });

  it("ignores a command of the wrong type", () => {
    const tool = { kind: "execute", name: "Run", command: 5 } as unknown as Partial<ToolExecution>;
    expect(entriesOf([tool])[0]).toMatchObject({ command: "Run" });
  });

  it("counts a tool naming no file", () => {
    const list = activityOf([reply([{ kind: "fetch" }, { kind: "search" }])]);
    expect(list.entries).toHaveLength(0);
    expect(list.otherTools).toBe(2);
  });

  it.each([
    [{ status: "pending" }, "waiting"],
    [{ status: "approved", chosenOptionId: "yes" }, "allowed"],
    [{ status: "rejected", chosenOptionId: "no" }, "rejected"],
    [{ status: "rejected" }, "unanswered"],
  ] as const)("reads a card %o as %s", (patch, answer) => {
    const [entry] = activityOf([reply([], { actionCard: card(patch) })]).entries;
    expect(entry).toMatchObject({ kind: "permission", answer });
  });

  it("names the chosen option", () => {
    const [entry] = activityOf([reply([], { actionCard: card({ status: "approved", chosenOptionId: "yes" }) })]).entries;
    expect(entry).toMatchObject({ choice: "Allow" });
  });

  it("orders by message, then tools, then card", () => {
    const entries = activityOf([
      reply([{ kind: "execute", command: "one" }], { id: "m-1", actionCard: card({}) }),
      reply([{ kind: "execute", command: "two", startedAt: 1 }], { id: "m-2" }),
    ]).entries;
    expect(entries.map((e) => e.kind)).toEqual(["command", "permission", "command"]);
    expect(entries.map((e) => e.messageId)).toEqual(["m-1", "m-1", "m-2"]);
  });

  it("shows no time for a replayed message", () => {
    expect(activityOf([reply([{ kind: "execute" }], { hasKnownTime: false })]).entries[0].time).toBeNull();
  });

  it("uses the message's time for a tool with none", () => {
    expect(activityOf([reply([{ kind: "execute", startedAt: undefined }])]).entries[0].time).toBe(500);
  });

  it("gives the same entries for an unchanged message", () => {
    const message = reply([{ kind: "execute" }]);
    expect(activityOf([message]).entries[0]).toBe(activityOf([message]).entries[0]);
  });
});

describe("statusWord", () => {
  const file = (status: ToolExecution["status"]): ActivityEntry => ({ kind: "file", path: "a", isNamed: true, action: "changed", status, messageId: "m", time: null });

  it("reads Changed only for a completed tool", () => {
    expect(statusWord(file("completed"), false)).toBe("Changed");
    expect(statusWord(file("failed"), false)).toBe("Failed");
  });

  it("reads Running only while the session is busy", () => {
    expect(statusWord(file("running"), true)).toBe("Running");
    expect(statusWord(file("running"), false)).toBe("Did not finish");
  });

  it("words each answer", () => {
    const answers = ["waiting", "allowed", "rejected", "unanswered"] as const;
    const words = answers.map((answer) => statusWord({ kind: "permission", prompt: "p", answer, messageId: "m", time: null }, false));
    expect(words).toEqual(["Waiting for you", "Allowed", "Rejected", "Not answered"]);
  });
});

describe("reportedPath", () => {
  it("reads an absolute path under the root", () => {
    expect(reportedPath("/private/tmp/r/src/a.ts", "/private/tmp/r", targets)).toBe("src/a.ts");
  });

  it("reads a path relative to a subfolder", () => {
    expect(reportedPath("a.ts", "/r/sub", { root: "/r", prefix: "sub/" })).toBe("sub/a.ts");
  });

  it("matches under the cwd when it is not the canonical path", () => {
    expect(reportedPath("/tmp/r/src/a.ts", "/tmp/r", targets)).toBe("src/a.ts");
  });

  it("gives nothing for a path outside the repository", () => {
    expect(reportedPath("/etc/hosts", "/private/tmp/r", targets)).toBeNull();
    expect(reportedPath("../x.ts", "/private/tmp/r", targets)).toBeNull();
  });
});

describe("unreportedFiles", () => {
  const unreported = (tools: Partial<ToolExecution>[], stats: FileStat[]) =>
    unreportedFiles(entriesOf(tools), stats, targets, "/private/tmp/r");

  it("leaves out a completed change", () => {
    expect(unreported([{ kind: "edit", locations: ["/private/tmp/r/a.ts"] }], [stat("a.ts")])).toEqual([]);
  });

  it("leaves out a change from a /tmp cwd against a /private/tmp root", () => {
    const entries = entriesOf([{ kind: "edit", locations: ["/tmp/r/a.ts"] }]);
    expect(unreportedFiles(entries, [stat("a.ts")], targets, "/tmp/r")).toEqual([]);
  });

  it("lists a file the agent only read", () => {
    expect(unreported([{ kind: "read", locations: ["/private/tmp/r/a.ts"] }], [stat("a.ts")])).toEqual(["a.ts"]);
  });

  it("lists a file from a declined edit that sent its diff first", () => {
    const edit = { kind: "edit", status: "failed", details: [{ kind: "diff", path: "/private/tmp/r/a.ts", oldText: "a", newText: "b" }] } as Partial<ToolExecution>;
    expect(unreported([edit], [stat("a.ts")])).toEqual(["a.ts"]);
  });

  it("lists a file a command changed without naming it", () => {
    expect(unreported([{ kind: "execute", command: "sed -i a.ts" }], [stat("a.ts")])).toEqual(["a.ts"]);
  });

  it("does not treat a tool's name as a reported file", () => {
    expect(unreported([{ kind: "edit", name: "a.ts" }], [stat("a.ts")])).toEqual(["a.ts"]);
  });

  it("matches a rename on its old path", () => {
    expect(unreported([{ kind: "move", locations: ["/private/tmp/r/old.ts"] }], [stat("new.ts", "old.ts")])).toEqual([]);
  });
});
