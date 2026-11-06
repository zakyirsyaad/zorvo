import { describe, it, expect } from "vitest";
import { agentNameOr } from "../lib/agent-name";

describe("agentNameOr", () => {
  const agents = [{ id: "claude-acp", name: "Claude Code" }];

  it("names a known agent", () => {
    expect(agentNameOr(agents, "claude-acp")).toBe("Claude Code");
  });

  it("says 'the agent' for an id it does not know, rather than the raw id", () => {
    expect(agentNameOr(agents, "gone-acp")).toBe("the agent");
  });
});
