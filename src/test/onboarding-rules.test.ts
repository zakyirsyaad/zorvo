import { describe, it, expect } from "vitest";
import {
  POPULAR_AGENT_IDS,
  defaultOf,
  hasMoreAgents,
  rowWords,
  startAgentOf,
  startGate,
  visibleAgents,
} from "../lib/onboarding";
import { makeCatalogAgent } from "./fixtures/catalog";

/** A catalog agent; the first argument only labels the call, `overrides` carries the id and name. */
const agent = (_label: string, overrides: Parameters<typeof makeCatalogAgent>[0]) => makeCatalogAgent(overrides);

const FOLDER = { name: "zorvo", path: "/Users/me/zorvo" };

describe("visibleAgents", () => {
  const catalog = [
    agent("zed", { id: "zed", name: "Zed", status: "ready" }),
    agent("gemini", { id: "gemini", name: "Gemini CLI", status: "not_installed" }),
    agent("mine", { id: "mine", name: "Mine", status: "on_your_mac" }),
    agent("claude-acp", { id: "claude-acp", name: "Claude Code", status: "ready" }),
    agent("qwen-code", { id: "qwen-code", name: "Qwen Code", status: "ready" }),
    agent("codex-acp", { id: "codex-acp", name: "Codex", status: "ready" }),
    agent("aider", { id: "aider", name: "Aider", status: "ready" }),
    agent("soon", { id: "soon", name: "Soon", status: "waiting" }),
    agent("nope", { id: "nope", name: "Nope", status: "unsupported" }),
  ];

  it("puts agents in use or on this Mac first, then the popular ones, five in all", () => {
    expect(visibleAgents(catalog, ["zed"], false).map((a) => a.id)).toEqual(["zed", "mine", "claude-acp", "codex-acp", "gemini"]);
    expect(POPULAR_AGENT_IDS).toEqual(["claude-acp", "codex-acp", "gemini", "qwen-code"]);
  });

  it("shows everything Zorvo can offer with Show all, the rest by name", () => {
    expect(visibleAgents(catalog, ["zed"], true).map((a) => a.id)).toEqual([
      "zed", "mine", "claude-acp", "codex-acp", "gemini", "qwen-code", "aider",
    ]);
  });

  it("never cuts an agent in use", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => agent(id, { id, name: id.toUpperCase(), status: "ready" }));
    expect(visibleAgents(many, ["a", "b", "c", "d", "e", "f"], false)).toHaveLength(6);
  });

  it("says whether there are more to show", () => {
    expect(hasMoreAgents(catalog, ["zed"])).toBe(true);
    expect(hasMoreAgents(catalog.slice(0, 3), [])).toBe(false);
  });
});

describe("rowWords", () => {
  it("says where a ready agent runs and its sign-in", () => {
    expect(rowWords(agent("a", { id: "a", name: "A", status: "on_your_mac" }), "ready", false)).toBe("On this Mac · Ready");
    expect(rowWords(agent("a", { id: "a", name: "A", status: "by_zorvo" }), "unchecked", false)).toBe("Installed by Zorvo · Not checked");
    expect(rowWords(agent("a", { id: "a", name: "A", status: "ready", distribution: "npx" }), "needed", false)).toBe(
      "Runs with npx · Sign in when you start",
    );
    expect(rowWords(agent("a", { id: "a", name: "A", status: "ready" }), "needed", true)).toContain("Set up when you start");
  });

  it("says Zorvo installs an agent that is not installed", () => {
    expect(rowWords(agent("a", { id: "a", name: "A", status: "not_installed" }), "unchecked", false)).toBe("Zorvo installs it when you tick it");
  });

  it("says a ticked agent that is not installed is not installed yet", () => {
    expect(rowWords(agent("a", { id: "a", name: "A", status: "not_installed" }), "unchecked", false, true)).toBe("Not installed yet");
  });
});

describe("defaultOf and startAgentOf", () => {
  it("keeps the saved default while it is ticked", () => {
    expect(defaultOf(["a", "b"], "b")).toBe("b");
  });

  it("the default moves to the first ticked agent when it is unticked", () => {
    expect(defaultOf(["a", "c"], "b")).toBe("a");
    expect(defaultOf([], "b")).toBeNull();
  });

  it("starts with a ready agent over an installing default", () => {
    expect(startAgentOf(["a", "b"], "a", (id) => id === "b")).toBe("b");
    expect(startAgentOf(["a", "b"], "a", () => true)).toBe("a");
    expect(startAgentOf(["a"], "a", () => false)).toBeNull();
  });
});

describe("startGate", () => {
  const row = (id: string, name: string, isReady: boolean, isInstalling = false) => ({ id, name, isReady, isInstalling });

  it("asks for an agent first", () => {
    expect(startGate({ ticked: [], defaultId: null, folder: FOLDER })).toEqual({ canStart: false, note: "Tick an agent to continue." });
  });

  it("waits for an install when nothing ticked is ready", () => {
    expect(startGate({ ticked: [row("x", "Codex", false, true)], defaultId: "x", folder: FOLDER }).note).toBe("Codex is still installing.");
    expect(startGate({ ticked: [row("x", "Codex", false, true), row("y", "Pi", false, true)], defaultId: "x", folder: FOLDER }).note).toBe(
      "Your agents are still installing.",
    );
    expect(startGate({ ticked: [row("x", "Codex", false)], defaultId: "x", folder: FOLDER })).toEqual({
      canStart: false,
      note: "Install one of these agents to continue.",
    });
  });

  it("asks for a folder", () => {
    expect(startGate({ ticked: [row("c", "Claude Code", true)], defaultId: "c", folder: null })).toEqual({
      canStart: false,
      note: "Choose a project folder.",
    });
  });

  it("starts with the ready agent while another installs, and says so", () => {
    expect(startGate({ ticked: [row("x", "Codex", false, true), row("c", "Claude Code", true)], defaultId: "x", folder: FOLDER })).toEqual({
      canStart: true,
      note: "Codex is still installing. You can start with Claude Code now.",
    });
  });

  it("is quiet and closed while the agents load", () => {
    expect(startGate({ ticked: [row("c", "Claude Code", false)], defaultId: "c", folder: FOLDER, isLoading: true })).toEqual({
      canStart: false,
      note: "",
    });
  });

  it("is quiet when all is set", () => {
    expect(startGate({ ticked: [row("c", "Claude Code", true)], defaultId: "c", folder: FOLDER })).toEqual({ canStart: true, note: "" });
  });
});
