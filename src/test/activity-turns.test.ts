import { describe, expect, it } from "vitest";
import { activityOf, type ActivityEntry } from "../lib/activity";
import { activityResult, activityTurns, activityVerb, dotTone } from "../lib/activity-turns";
import type { ChatMessage, ToolExecution } from "../types";

const user = (id: string, content: string, timestamp: number): ChatMessage => ({ id, role: "user", content, timestamp });
const reply = (id: string, tools: Partial<ToolExecution>[]): ChatMessage => ({
  id,
  role: "agent",
  content: "",
  timestamp: 0,
  tools: tools.map((tool, index) => ({ id: `${id}-t${index}`, name: "Tool", status: "completed", startedAt: 1000, ...tool })),
});
const read = (path: string): Partial<ToolExecution> => ({ kind: "read", locations: [path] });

const fileEntry = (action: "read" | "changed" | "touched", status: ToolExecution["status"]): ActivityEntry => ({
  key: "k",
  messageId: "m",
  time: null,
  kind: "file",
  path: "src/a.ts",
  isNamed: true,
  action,
  status,
});
const commandEntry = (status: ToolExecution["status"]): ActivityEntry => ({ key: "k", messageId: "m", time: null, kind: "command", command: "pnpm test", status });
const permissionEntry = (answer: "waiting" | "allowed" | "rejected" | "unanswered"): ActivityEntry => ({
  key: "k",
  messageId: "m",
  time: null,
  kind: "permission",
  prompt: "Run rm",
  answer,
});

describe("activityTurns", () => {
  it("groups entries by turn, newest turn first, oldest entry first", () => {
    const messages = [
      user("u1", "A", 10),
      reply("r1", [read("/w/one.ts"), { kind: "edit", locations: ["/w/two.ts"] }]),
      user("u2", "  B\n  please ", 20),
      reply("r2", [read("/w/three.ts")]),
    ];
    const turns = activityTurns(activityOf(messages).entries, messages);

    expect(turns.map((turn) => turn.number)).toEqual([2, 1]);
    expect(turns[0].prompt).toBe("B please");
    expect(turns[1].entries.map((entry) => (entry.kind === "file" ? entry.path : ""))).toEqual(["/w/one.ts", "/w/two.ts"]);
  });

  it("entries before the first prompt go under Earlier", () => {
    const messages = [reply("r0", [read("/w/old.ts")]), user("u1", "Go", 10), reply("r1", [])];
    const turns = activityTurns(activityOf(messages).entries, messages);

    expect(turns.map((turn) => turn.number)).toEqual([null]);
    expect(turns[0].prompt).toBe("");
    expect(turns[0].entries).toHaveLength(1);
  });

  it("a turn's start time is its prompt's timestamp", () => {
    const messages = [user("u1", "Go", 1234), reply("r1", [read("/w/a.ts")])];
    expect(activityTurns(activityOf(messages).entries, messages)[0].startedAt).toBe(1234);

    const replayed = [{ ...user("u1", "Go", 1234), hasKnownTime: false }, reply("r1", [read("/w/a.ts")])];
    expect(activityTurns(activityOf(replayed).entries, replayed)[0].startedAt).toBeNull();
  });

  it("leaves out a turn with no entries", () => {
    const messages = [user("u1", "Hi", 1), reply("r1", []), user("u2", "Read", 2), reply("r2", [read("/w/a.ts")])];
    expect(activityTurns(activityOf(messages).entries, messages).map((turn) => turn.number)).toEqual([2]);
  });
});

describe("activityVerb", () => {
  it("verbs are past tense only when the tool completed", () => {
    expect(activityVerb(fileEntry("changed", "completed"))).toBe("Edited");
    expect(activityVerb(fileEntry("changed", "failed"))).toBe("Edit");
    expect(activityVerb(fileEntry("changed", "running"))).toBe("Edit");
    expect(activityVerb(fileEntry("touched", "completed"))).toBe("Touched");
    expect(activityVerb(fileEntry("touched", "running"))).toBe("Touch");
    expect(activityVerb(fileEntry("read", "running"))).toBe("Read");
    expect(activityVerb(commandEntry("completed"))).toBe("Ran");
    expect(activityVerb(commandEntry("failed"))).toBe("Run");
    expect(activityVerb(permissionEntry("waiting"))).toBe("Asked");
  });

  it("a search reads as a search, not a read", () => {
    const [entry] = activityOf([reply("r1", [{ kind: "search", locations: ["/w/src"] }])]).entries;
    expect(activityVerb(entry)).toBe("Searched");
    const [running] = activityOf([reply("r2", [{ kind: "search", locations: ["/w/src"], status: "running" }])]).entries;
    expect(activityVerb(running)).toBe("Search");
    const [read] = activityOf([reply("r3", [{ kind: "read", locations: ["/w/a.ts"] }])]).entries;
    expect(activityVerb(read)).toBe("Read");
  });
});

describe("activityResult", () => {
  it("results say Done for finished files and You denied for a refusal", () => {
    expect(activityResult(fileEntry("read", "completed"), false)).toBe("Done");
    expect(activityResult(fileEntry("changed", "completed"), false)).toBe("Done");
    expect(activityResult(commandEntry("completed"), false)).toBe("Done");
    expect(activityResult(permissionEntry("rejected"), false)).toBe("You denied");
    expect(activityResult(permissionEntry("allowed"), false)).toBe("Allowed");
    expect(activityResult(fileEntry("changed", "running"), false)).toBe("Did not finish");
    expect(activityResult(fileEntry("changed", "running"), true)).toBe("Running");
    expect(activityResult(commandEntry("failed"), false)).toBe("Failed");
  });
});

describe("dotTone", () => {
  it("dot tones follow the result", () => {
    expect(dotTone(fileEntry("changed", "completed"), false)).toBe("done");
    expect(dotTone(permissionEntry("allowed"), false)).toBe("done");
    expect(dotTone(commandEntry("failed"), false)).toBe("failed");
    expect(dotTone(permissionEntry("rejected"), false)).toBe("failed");
    expect(dotTone(commandEntry("running"), true)).toBe("running");
    expect(dotTone(permissionEntry("waiting"), false)).toBe("waiting");
    expect(dotTone(commandEntry("running"), false)).toBe("open");
    expect(dotTone(permissionEntry("unanswered"), false)).toBe("open");
  });
});
