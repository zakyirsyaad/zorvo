import { describe, expect, it } from "vitest";
import { COMMAND_PATH_CONTEXT, MCP_PATH_CONTEXT, isToolsContextTitle, workerContext } from "../lib/agent-tools-context";

describe("the command path's context", () => {
  it("names the artifact tools with their arguments", () => {
    expect(COMMAND_PATH_CONTEXT).toContain('show_artifact {"path": "<file.html>", "title": "<text>"}');
    expect(COMMAND_PATH_CONTEXT).toContain("run artifact_guide first");
  });

  it("names the agent tools, start_worker and send instead of delegate, and stays hidden", () => {
    for (const tool of ["list_agents", "start_worker", "send", "start_session", "read_session", "stop_session"]) {
      expect(COMMAND_PATH_CONTEXT).toContain(tool);
    }
    expect(COMMAND_PATH_CONTEXT).toContain("start_worker {\"agent\": \"<id>\", \"task\": \"<text>\"}");
    expect(COMMAND_PATH_CONTEXT).not.toContain("delegate");
    expect(MCP_PATH_CONTEXT).not.toContain("delegate");
    expect(COMMAND_PATH_CONTEXT.endsWith("Do not mention this note.")).toBe(true);
  });

  it("says when to show a page", () => {
    expect(COMMAND_PATH_CONTEXT).toContain("show_artifact when a page explains something better than text");
  });
});

describe("the MCP path's context", () => {
  it("says when to show a page without being asked, and how to find the tool", () => {
    for (const words of ["without being asked", "show_artifact", "artifact_guide", "diagram", "tool discovery"]) {
      expect(MCP_PATH_CONTEXT).toContain(words);
    }
  });

  it("tells both paths to use a worker unasked, in place of the agent's own background task", () => {
    for (const note of [MCP_PATH_CONTEXT, COMMAND_PATH_CONTEXT]) {
      expect(note).toContain("use start_worker without being asked for it by name");
      expect(note).toContain("in place of a subagent or background task of your own");
      expect(note).toContain("A worker may be the same agent as you");
    }
    expect(COMMAND_PATH_CONTEXT).not.toContain("only when the user asks for another agent");
  });

  it("says the tools may carry the server's name, and to search for zorvo before falling back", () => {
    expect(MCP_PATH_CONTEXT).toContain("mcp__zorvo__start_worker");
    expect(MCP_PATH_CONTEXT).toContain("search for zorvo before you fall back to a tool of your own");
    expect(MCP_PATH_CONTEXT).toContain("one reply may hold several, each beside the text it explains");
    expect(MCP_PATH_CONTEXT).toContain("something they keep, reopen, scroll or click through, or that needs a script, is a page");
  });

  it("names start_worker and send, and says to end the turn", () => {
    expect(MCP_PATH_CONTEXT).toContain("start_worker");
    expect(MCP_PATH_CONTEXT).toContain("send");
    expect(MCP_PATH_CONTEXT).toContain("end your turn");
  });

  it("names the canvas in the MCP note", () => {
    expect(MCP_PATH_CONTEXT).toContain("call artifact_guide with kind canvas, then show_artifact with kind canvas");
    expect(COMMAND_PATH_CONTEXT).toContain('"kind":"canvas"');
  });

  it("stays hidden and leaves short answers in the chat", () => {
    expect(MCP_PATH_CONTEXT).toContain("short text or code");
    expect(MCP_PATH_CONTEXT.endsWith("Do not mention this note.")).toBe(true);
  });
});

describe("a worker's note", () => {
  it("names the coordinator and the done tool", () => {
    const note = workerContext("mcp", "Claude Code");
    expect(note).toContain(
      "You are a worker. Claude Code, in another Zorvo session, gave you this task and cannot see this chat.",
    );
    expect(note).toContain("call the done tool once with outcome succeeded or failed");
    expect(note).not.toContain("start_worker");
    expect(note).not.toContain("Do not mention");
  });

  it("shows the done command on the command path", () => {
    const note = workerContext("command", "Claude Code");
    expect(note).toContain("\"$ZORVO_TOOLS\" tools done '{\"outcome\":\"succeeded\",\"summary\":");
    expect(note).not.toContain("call the done tool once");
  });

  it("makes a name from the registry visible text", () => {
    expect(workerContext("mcp", "Bad\u202eName")).not.toContain("\u202e");
  });
});

describe("a title an agent cut from Zorvo's hidden note", () => {
  it("is recognised when it is the start of a note, with or without an ellipsis", () => {
    expect(isToolsContextTitle(MCP_PATH_CONTEXT.slice(0, 60))).toBe(true);
    expect(isToolsContextTitle(`${MCP_PATH_CONTEXT.slice(0, 120)}…`)).toBe(true);
    expect(isToolsContextTitle(`${COMMAND_PATH_CONTEXT.slice(0, 80)}...`)).toBe(true);
    expect(isToolsContextTitle(workerContext("mcp", "Codex").slice(0, 70))).toBe(true);
    expect(isToolsContextTitle("You are a worker.")).toBe(true);
  });

  it("is recognised when the whole note is followed by the user's message", () => {
    expect(isToolsContextTitle(`${MCP_PATH_CONTEXT} explain the parser`)).toBe(true);
    expect(isToolsContextTitle(`${COMMAND_PATH_CONTEXT} explain the parser`)).toBe(true);
  });

  it("is recognised whatever the agent did to its spacing", () => {
    expect(isToolsContextTitle(`  ${MCP_PATH_CONTEXT.slice(0, 60).replace(/ /g, "  ")}\n`)).toBe(true);
  });

  it("leaves an agent's own title alone, even one that starts like a note", () => {
    expect(isToolsContextTitle("Parser walkthrough")).toBe(false);
    expect(isToolsContextTitle("Zorvo")).toBe(false);
    expect(isToolsContextTitle("Zorvo, the app")).toBe(false);
    expect(isToolsContextTitle("Zorvo, the app this session runs in, crashes on start")).toBe(false);
    expect(isToolsContextTitle("")).toBe(false);
  });

  it("says in both contexts when to show a visual", () => {
    for (const context of [MCP_PATH_CONTEXT, COMMAND_PATH_CONTEXT]) expect(context).toContain("show_visual");
  });
});

describe("the end of a turn", () => {
  it("tells both paths to call wrap_up", () => {
    for (const note of [COMMAND_PATH_CONTEXT, MCP_PATH_CONTEXT]) {
      expect(note).toContain("call wrap_up");
      expect(note.indexOf("call wrap_up")).toBeLessThan(note.indexOf("Do not mention this note."));
    }
  });
});
