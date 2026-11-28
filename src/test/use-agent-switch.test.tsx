import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSwitch, type AgentSwitchDeps } from "../hooks/useAgentSwitch";
import { NO_CHOICES } from "../lib/acp-draft";
import type { AgentProfile, ChatMessage, Session } from "../types";

const agent = (id: string, name: string): AgentProfile => ({
  id,
  name,
  command: id,
  detected: true,
  acp_args: [],
  source: "registry",
  version: "1.0.0",
  distribution: "npx",
  availability: "ready",
  install_plan: null,
  description: null,
  installed_on_system: true,
  listed: true,
});

const qwen = agent("qwen-code", "Qwen Code");
const claude = agent("claude-acp", "Claude Code");

const session = (over: Partial<Session> = {}): Session => ({
  id: "s-1",
  name: "Fix login bug",
  profileId: "qwen-code",
  cwd: "/w",
  status: "running",
  createdAt: 1,
  ...over,
});

const MESSAGES = [
  { id: "m-1", role: "user", content: "hi", timestamp: 1 },
  { id: "m-2", role: "agent", content: "stuck", timestamp: 2, isComplete: true },
] as unknown as ChatMessage[];

function renderSwitch(over: Partial<AgentSwitchDeps> = {}) {
  const forkSession = vi.fn(() => Promise.resolve(true));
  const initial: AgentSwitchDeps = {
    sessions: [session()],
    agentsInUse: [qwen, claude],
    transcripts: { "s-1": MESSAGES },
    agentOptions: { "claude-acp": {
      modes: null,
      configOptions: [],
      models: { currentModelId: "auto", availableModels: [{ modelId: "opus", name: "Opus" }, { modelId: "sonnet", name: "Sonnet" }] },
      preferredModelId: "opus",
    } },
    forkSession,
    ...over,
  };
  const hook = renderHook((deps: AgentSwitchDeps) => useAgentSwitch(deps), { initialProps: initial });
  return { ...hook, forkSession, initial };
}

describe("useAgentSwitch", () => {
  it("pick stores the agent with its remembered choices", () => {
    const { result } = renderSwitch();

    act(() => result.current.pick("s-1", "claude-acp"));

    expect(result.current.pendingOf("s-1")?.agentId).toBe("claude-acp");
    expect(result.current.pendingOf("s-1")?.choices.modelId).toBe("opus");
  });

  it("picking the source agent clears it, and so does keep", () => {
    const { result } = renderSwitch();

    act(() => result.current.pick("s-1", "claude-acp"));
    act(() => result.current.pick("s-1", "qwen-code"));
    expect(result.current.pendingOf("s-1")).toBeUndefined();

    act(() => result.current.pick("s-1", "claude-acp"));
    act(() => result.current.keep("s-1"));
    expect(result.current.pendingOf("s-1")).toBeUndefined();
  });

  it("setChoices changes the pending switch's choices only", () => {
    const { result } = renderSwitch();

    act(() => result.current.pick("s-1", "claude-acp"));
    act(() => result.current.setChoices("s-1", { ...NO_CHOICES, modelId: "sonnet" }));

    expect(result.current.pendingOf("s-1")?.choices.modelId).toBe("sonnet");
  });

  it("survives showing another session", () => {
    const { result, rerender, initial } = renderSwitch();

    act(() => result.current.pick("s-1", "claude-acp"));
    rerender({ ...initial, sessions: [session(), session({ id: "s-2" })] });

    expect(result.current.pendingOf("s-1")?.agentId).toBe("claude-acp");
  });

  it("drops a switch whose session is deleted or archived", () => {
    const { result, rerender, initial } = renderSwitch();

    act(() => result.current.pick("s-1", "claude-acp"));
    rerender({ ...initial, sessions: [session({ archivedAt: 5 })] });
    expect(result.current.pendingOf("s-1")).toBeUndefined();

    rerender({ ...initial });
    act(() => result.current.pick("s-1", "claude-acp"));
    rerender({ ...initial, sessions: [] });
    expect(result.current.pendingOf("s-1")).toBeUndefined();
  });

  it("drops a switch whose agent was taken out of use", () => {
    const { result, rerender, initial } = renderSwitch();

    act(() => result.current.pick("s-1", "claude-acp"));
    rerender({ ...initial, agentsInUse: [qwen] });

    expect(result.current.pendingOf("s-1")).toBeUndefined();
  });

  it("send forks from the last message with the agent, the choices and the message, then clears", async () => {
    const { result, forkSession } = renderSwitch();
    act(() => result.current.pick("s-1", "claude-acp"));
    let isSent: boolean | undefined;

    await act(async () => {
      isSent = await result.current.send("s-1", { text: "Fix it", attachments: ["/w/a.png"] });
    });

    expect(isSent).toBe(true);
    expect(forkSession).toHaveBeenCalledWith("m-2", {
      agent: claude,
      choices: expect.objectContaining({ modelId: "opus" }),
      firstMessage: { text: "Fix it", attachments: ["/w/a.png"] },
    });
    expect(result.current.pendingOf("s-1")).toBeUndefined();
  });

  it("a send that fails keeps the switch and resolves false", async () => {
    const { result } = renderSwitch({ forkSession: vi.fn(() => Promise.resolve(false)) });
    act(() => result.current.pick("s-1", "claude-acp"));
    let isSent: boolean | undefined;

    await act(async () => {
      isSent = await result.current.send("s-1", { text: "Fix it" });
    });

    expect(isSent).toBe(false);
    expect(result.current.pendingOf("s-1")?.agentId).toBe("claude-acp");
  });
});
