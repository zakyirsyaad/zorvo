import { describe, it, expect } from "vitest";
import { explainTurnError } from "../lib/turn-error";

describe("explainTurnError", () => {
  it.each([
    "exception TypeError: fetch failed sending request",
    "read ECONNRESET",
    "connect ETIMEDOUT 142.250.0.1:443",
    "getaddrinfo ENOTFOUND generativelanguage.googleapis.com",
    "A Network error occurred",
  ])("explains %j as a network failure and keeps the raw text for details", (raw) => {
    expect(explainTurnError("Gemini CLI", raw)).toEqual({
      title: "Gemini CLI could not reach the network.",
      body: "Check your connection or proxy, then try again.",
      summary: "Gemini CLI could not reach the network.",
      hint: "Check your connection or proxy, then try again.",
      details: raw,
    });
  });

  it("names the agent it is told, and falls back to \"The agent\" without a name", () => {
    expect(explainTurnError("Qwen Code", "fetch failed").summary).toBe("Qwen Code could not reach the network.");
    expect(explainTurnError(undefined, "fetch failed").summary).toBe("The agent could not reach the network.");
  });

  it("matches the patterns whatever their case", () => {
    expect(explainTurnError("Codex", "Fetch Failed").hint).toBeDefined();
    expect(explainTurnError("Codex", "econnreset").hint).toBeDefined();
  });

  it("keeps the raw text of an unknown error, with nothing hidden behind details", () => {
    expect(explainTurnError("Gemini CLI", "quota exceeded for this model")).toEqual({
      title: "The agent's turn failed",
      body: "quota exceeded for this model",
      summary: "The agent's turn failed: quota exceeded for this model",
    });
  });

  it("says only that the turn failed when there is no text", () => {
    expect(explainTurnError("Gemini CLI", "")).toEqual({ title: "The agent's turn failed.", summary: "The agent's turn failed." });
    expect(explainTurnError("Gemini CLI", "   ")).toEqual({ title: "The agent's turn failed.", summary: "The agent's turn failed." });
  });
});
