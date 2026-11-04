import { describe, it, expect } from "vitest";
import { stillRunning, summarizeTools, toolRow, toolStatusWord } from "../lib/tool-summary";
import type { ToolExecution } from "../types";

function tool(id: string, kind: string | undefined, status: ToolExecution["status"] = "completed"): ToolExecution {
  return { id, name: id, kind, status };
}

describe("summarizeTools", () => {
  it("names command runs by their count", () => {
    expect(summarizeTools([tool("t1", "execute")])).toBe("Ran a command");
    expect(summarizeTools([tool("t1", "execute"), tool("t2", "execute")])).toBe("Ran 2 commands");
  });

  it("names file reads by their count", () => {
    expect(summarizeTools([tool("t1", "read")])).toBe("Read a file");
    expect(summarizeTools([tool("t1", "read"), tool("t2", "read"), tool("t3", "read")])).toBe("Read 3 files");
  });

  it("names edits and other file work", () => {
    expect(summarizeTools([tool("t1", "edit")])).toBe("Edited a file");
    expect(summarizeTools([tool("t1", "edit"), tool("t2", "edit")])).toBe("Edited 2 files");
    expect(summarizeTools([tool("t1", "delete")])).toBe("Deleted a file");
    expect(summarizeTools([tool("t1", "move")])).toBe("Moved a file");
  });

  it("describes searches and fetches", () => {
    expect(summarizeTools([tool("t1", "search"), tool("t2", "search")])).toBe("Searched the code");
    expect(summarizeTools([tool("t1", "fetch")])).toBe("Fetched a page");
  });

  it("calls everything else a tool", () => {
    expect(summarizeTools([tool("t1", "think")])).toBe("Used a tool");
    expect(summarizeTools([tool("t1", "other"), tool("t2", undefined)])).toBe("Used 2 tools");
  });

  it("joins kinds in the order they first appear, lowercasing the rest", () => {
    const tools = [tool("t1", "read"), tool("t2", "read"), tool("t3", "execute")];

    expect(summarizeTools(tools)).toBe("Read 2 files, ran a command");
  });

  it("marks failed tools", () => {
    const tools = [tool("t1", "execute"), tool("t2", "execute", "failed")];

    expect(summarizeTools(tools)).toBe("Ran 2 commands · 1 failed");
  });

  it("treats a kind that names an object member as a tool", () => {
    expect(summarizeTools([tool("t1", "execute"), tool("t2", "constructor")])).toBe(
      "Ran a command, used a tool",
    );
    expect(summarizeTools([tool("t1", "__proto__")])).toBe("Used a tool");
  });

  it("has nothing to say about no tools", () => {
    expect(summarizeTools([])).toBe("");
  });
});

describe("toolRow", () => {
  it("says a command ran and names it", () => {
    expect(toolRow({ id: "t", name: "Run pnpm test", kind: "execute", status: "completed", command: "pnpm test" })).toEqual({
      verb: "Ran",
      target: "pnpm test",
    });
  });

  it("names a file tool's first file", () => {
    expect(toolRow({ id: "t", name: "Edit src/app.ts", kind: "edit", status: "completed", locations: ["src/app.ts", "b.ts"] })).toEqual({
      verb: "Edited",
      target: "src/app.ts",
    });
  });

  it("falls back to the agent's title without a file or for an unknown kind", () => {
    expect(toolRow({ id: "t", name: "Read something", kind: "read", status: "completed" })).toEqual({ verb: "Read something" });
    expect(toolRow({ id: "t", name: "Think", kind: "think", status: "completed" })).toEqual({ verb: "Think" });
  });
});

describe("toolStatusWord", () => {
  it("claims a result only once a tool completed or failed", () => {
    expect(toolStatusWord(tool("t", "read", "completed"), false)).toBe("Done");
    expect(toolStatusWord(tool("t", "read", "failed"), false)).toBe("Failed");
    expect(toolStatusWord(tool("t", "read", "running"), false)).toBeNull();
    expect(toolStatusWord(tool("t", "read", "running"), true)).toBe("Did not finish");
  });
});

describe("stillRunning", () => {
  it("counts running tools only while the turn is not over", () => {
    const tools = [tool("a", "read", "running"), tool("b", "edit", "completed"), tool("c", "execute", "running")];
    expect(stillRunning(tools, false)).toBe(2);
    expect(stillRunning(tools, true)).toBe(0);
  });
});
