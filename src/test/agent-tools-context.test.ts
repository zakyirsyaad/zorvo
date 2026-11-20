import { describe, expect, it } from "vitest";
import { COMMAND_PATH_CONTEXT, MCP_PATH_CONTEXT } from "../lib/agent-tools-context";

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
