import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_EXITED_REASON } from "../lib/workers";

describe("the agent's exit sentence", () => {
  it("is the one the backend fails a waiting request with", () => {
    const rust = readFileSync("src-tauri/src/acp/connection.rs", "utf8");
    expect(rust).toContain(`json!({ "message": "${AGENT_EXITED_REASON}" })`);
  });
});
