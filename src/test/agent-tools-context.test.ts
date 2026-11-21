import { describe, expect, it } from "vitest";
import { COMMAND_PATH_CONTEXT, MCP_PATH_CONTEXT } from "../lib/agent-tools-context";

describe("the command path's context", () => {
  it("names the artifact tools with their arguments", () => {
    expect(COMMAND_PATH_CONTEXT).toContain('show_artifact {"path": "<file.html>", "title": "<text>"}');
    expect(COMMAND_PATH_CONTEXT).toContain("run artifact_guide first");
  });

  it("still names the five agent tools and stays hidden", () => {
    for (const tool of ["list_agents", "delegate", "start_session", "read_session", "stop_session"]) {
      expect(COMMAND_PATH_CONTEXT).toContain(tool);
    }
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

  it("names the canvas in the MCP note", () => {
    expect(MCP_PATH_CONTEXT).toContain("call artifact_guide with kind canvas, then show_artifact with kind canvas");
    expect(COMMAND_PATH_CONTEXT).toContain('"kind":"canvas"');
  });

  it("stays hidden and leaves short answers in the chat", () => {
    expect(MCP_PATH_CONTEXT).toContain("short text or code");
    expect(MCP_PATH_CONTEXT.endsWith("Do not mention this note.")).toBe(true);
  });
});
