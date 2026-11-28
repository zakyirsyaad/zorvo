import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwitchTargets, type SwitchTargetsInput } from "../hooks/useSwitchTargets";
import type { SignInState } from "../lib/agent-sign-in";
import type { AgentProfile, Session } from "../types";

const agent = (id: string, name: string): AgentProfile =>
  ({ id, name, command: id, detected: true, acp_args: [], source: "registry", version: "1", distribution: "npx", availability: "ready", install_plan: null, description: null, installed_on_system: true, listed: true }) as AgentProfile;

const session = { id: "s-1", name: "Fix", profileId: "qwen-code", cwd: "/w", status: "running", createdAt: 1 } as Session;
const ready = (): SignInState => "ready";

describe("useSwitchTargets", () => {
  it("keeps the same list while equal inputs arrive as new arrays", () => {
    const input: SwitchTargetsInput = { session, messageCount: 2, agentsInUse: [agent("qwen-code", "Qwen Code"), agent("claude-acp", "Claude Code")], signInOf: ready };
    const { result, rerender } = renderHook((props: SwitchTargetsInput) => useSwitchTargets(props), { initialProps: input });
    const first = result.current;

    rerender({ ...input, agentsInUse: [...input.agentsInUse], signInOf: () => "ready" });

    expect(first).toHaveLength(2);
    expect(result.current).toBe(first);
  });

  it("returns one shared empty list while no other agent is offered", () => {
    const input: SwitchTargetsInput = { session, messageCount: 0, agentsInUse: [agent("qwen-code", "Qwen Code")], signInOf: ready };
    const { result, rerender } = renderHook((props: SwitchTargetsInput) => useSwitchTargets(props), { initialProps: input });
    const first = result.current;

    rerender({ ...input, agentsInUse: [...input.agentsInUse] });

    expect(first).toEqual([]);
    expect(result.current).toBe(first);
  });

  it("changes when a status word changes", () => {
    const input: SwitchTargetsInput = { session, messageCount: 2, agentsInUse: [agent("qwen-code", "Qwen Code"), agent("claude-acp", "Claude Code")], signInOf: ready };
    const { result, rerender } = renderHook((props: SwitchTargetsInput) => useSwitchTargets(props), { initialProps: input });
    const first = result.current;

    rerender({ ...input, signInOf: () => "needed" });

    expect(result.current).not.toBe(first);
    expect(result.current[1].word).toBe("Needs sign-in");
  });
});
