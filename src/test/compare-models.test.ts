import { describe, it, expect, vi } from "vitest";
import { compareModelControls } from "../lib/compare-models";
import type { AgentOptions } from "../lib/acp-draft";

/** One model control per agent of a compare run, from what Zorvo remembers about each. */
const modelsOf = (id: string, preferredModelId?: string): AgentOptions => ({
  modes: null,
  configOptions: [],
  models: {
    currentModelId: `${id}-default`,
    availableModels: [
      { modelId: `${id}-default`, name: `${id} default` },
      { modelId: `${id}-fast`, name: `${id} fast` },
    ],
  },
  ...(preferredModelId ? { preferredModelId } : {}),
});

const agents = [
  { id: "claude-acp", name: "Claude Code" },
  { id: "qwen-code", name: "Qwen Code" },
];
const noAsk = () => undefined;
const actions = () => ({ pickModel: vi.fn(), pickConfig: vi.fn() });

describe("compareModelControls", () => {
  it("gives one entry per agent, in order", () => {
    const result = compareModelControls(agents, { "claude-acp": modelsOf("claude"), "qwen-code": modelsOf("qwen") }, noAsk, actions());
    expect(result.map((entry) => [entry.profileId, entry.name, entry.state])).toEqual([
      ["claude-acp", "Claude Code", "known"],
      ["qwen-code", "Qwen Code", "known"],
    ]);
  });

  it("gives a control from a models field, with the remembered pick selected", () => {
    const acts = actions();
    const [, qwen] = compareModelControls(agents, { "claude-acp": modelsOf("claude"), "qwen-code": modelsOf("qwen", "qwen-fast") }, noAsk, acts);
    expect(qwen.control?.selected).toBe("qwen-fast");
    qwen.control?.onChange("qwen-default");
    expect(acts.pickModel).toHaveBeenCalledWith("qwen-code", "qwen-default");
  });

  it("gives a control from a model config option", () => {
    const acts = actions();
    const codex: AgentOptions = {
      modes: null,
      configOptions: [
        { id: "model", name: "Model", category: "model", currentValue: "a", options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] },
      ],
      preferredConfig: { model: "b" },
    };
    const [entry] = compareModelControls([{ id: "codex", name: "Codex" }], { codex }, noAsk, acts);
    expect(entry.state).toBe("known");
    expect(entry.control?.selected).toBe("b");
    entry.control?.onChange("a");
    expect(acts.pickConfig).toHaveBeenCalledWith("codex", "model", "a");
  });

  it("falls back to the default for a remembered pick the agent no longer offers", () => {
    const [claude] = compareModelControls(agents, { "claude-acp": modelsOf("claude", "gone") }, noAsk, actions());
    expect(claude.control?.selected).toBe("claude-default");
  });

  it("marks an unknown list unknown, with no control", () => {
    const [claude, qwen] = compareModelControls(agents, { "claude-acp": modelsOf("claude") }, noAsk, actions());
    expect(claude.state).toBe("known");
    expect(qwen.state).toBe("unknown");
    expect(qwen.control).toBeUndefined();
  });

  it("carries an unknown agent's ask state through", () => {
    const options = { "claude-acp": modelsOf("claude") };
    const asking = compareModelControls(agents, options, (id) => (id === "qwen-code" ? "asking" : undefined), actions());
    expect(asking[1].state).toBe("asking");
    const failed = compareModelControls(agents, options, (id) => (id === "qwen-code" ? "failed" : undefined), actions());
    expect(failed[1].state).toBe("failed");
  });
});
