import { describe, it, expect } from "vitest";
import { agentNameOr } from "../lib/agent-name";

describe("agentNameOr", () => {
  it("names a known agent", () => {
    expect(agentNameOr({ name: "Claude Code" })).toBe("Claude Code");
  });

  it("says 'the agent' for an agent it does not know, rather than the raw id", () => {
    expect(agentNameOr(undefined)).toBe("the agent");
  });
});
