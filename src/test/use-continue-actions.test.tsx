import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useContinueActions, type ContinueActionsDeps } from "../hooks/useContinueActions";
import type { AgentProfile, Session } from "../types";

const agent = (id: string, name: string) => ({ id, name }) as AgentProfile;
const qwen = agent("qwen-code", "Qwen Code");
const claude = agent("claude-acp", "Claude Code");
const session = (over: Partial<Session> = {}) =>
  ({ id: "s-1", name: "Fix", profileId: "qwen-code", cwd: "/w", status: "running", createdAt: 1, ...over }) as Session;

function renderActions(over: Partial<ContinueActionsDeps> = {}) {
  const deps: ContinueActionsDeps = {
    activeSession: session(),
    agents: [qwen, claude],
    agentOptions: undefined,
    forkSession: vi.fn(() => Promise.resolve(true)),
    pick: vi.fn(),
    confirmOutsideTee: vi.fn((_agent, onConfirm: () => void) => onConfirm()),
    onNotice: vi.fn(),
    ...over,
  };
  const { result } = renderHook(() => useContinueActions(deps));
  return { result, deps };
}

describe("useContinueActions", () => {
  it("forks with the session's own agent when no agent is named", () => {
    const { result, deps } = renderActions();

    act(() => result.current.forkFromMessage("m-1"));

    expect(deps.forkSession).toHaveBeenCalledWith("m-1");
  });

  it("forks with the named agent and its remembered picks", () => {
    const { result, deps } = renderActions();

    act(() => result.current.forkFromMessage("m-1", "claude-acp"));

    expect(deps.forkSession).toHaveBeenCalledWith("m-1", expect.objectContaining({ agent: claude }));
    expect(deps.confirmOutsideTee).not.toHaveBeenCalled();
  });

  it("a named agent that is gone forks nothing and says so", () => {
    const { result, deps } = renderActions();

    act(() => result.current.forkFromMessage("m-1", "codex-acp"));

    expect(deps.forkSession).not.toHaveBeenCalled();
    expect(deps.onNotice).toHaveBeenCalled();
  });

  it("a private session asks before forking to another agent", () => {
    const confirmOutsideTee = vi.fn();
    const { result, deps } = renderActions({ activeSession: session({ privateMode: { modelId: "m" } }), confirmOutsideTee });

    act(() => result.current.forkFromMessage("m-1", "claude-acp"));

    expect(confirmOutsideTee).toHaveBeenCalledWith({ id: "claude-acp", name: "Claude Code" }, expect.any(Function));
    expect(deps.forkSession).not.toHaveBeenCalled();
  });

  it("a private session asks before picking another agent in the composer, but not for its own", () => {
    const confirmOutsideTee = vi.fn();
    const { result, deps } = renderActions({ activeSession: session({ privateMode: { modelId: "m" } }), confirmOutsideTee });

    act(() => result.current.pickSwitchAgent("claude-acp"));
    expect(confirmOutsideTee).toHaveBeenCalledTimes(1);
    expect(deps.pick).not.toHaveBeenCalled();

    act(() => result.current.pickSwitchAgent("qwen-code"));
    expect(deps.pick).toHaveBeenCalledWith("s-1", "qwen-code");
  });

  it("an ordinary session picks at once", () => {
    const { result, deps } = renderActions();

    act(() => result.current.pickSwitchAgent("claude-acp"));

    expect(deps.pick).toHaveBeenCalledWith("s-1", "claude-acp");
  });
});
