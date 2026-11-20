import { describe, expect, it } from "vitest";
import { COMMAND_PATH_CONTEXT, MCP_PATH_CONTEXT, workerContext } from "../lib/agent-tools-context";

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

  it("names start_worker and send, and says to end the turn", () => {
    expect(MCP_PATH_CONTEXT).toContain("start_worker");
    expect(MCP_PATH_CONTEXT).toContain("send");
    expect(MCP_PATH_CONTEXT).toContain("end your turn");
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
