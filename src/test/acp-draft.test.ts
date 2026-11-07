import { describe, it, expect } from "vitest";
import type { AcpConfigOption } from "../hooks/useAcpSessions";
import {
  changesToApply,
  draftInfo,
  hasModelConfig,
  hasReportedOptions,
  NO_CHOICES,
  rememberedChoice,
  withPreferred,
  withEffortList,
  withReported,
  withProbed,
  type AgentOptions,
} from "../lib/acp-draft";

const gemini: AgentOptions = {
  modes: null,
  configOptions: [],
  models: {
    currentModelId: "auto",
    availableModels: [
      { modelId: "auto", name: "Auto" },
      { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
};

const qwen: AgentOptions = {
  modes: {
    currentModeId: "yolo",
    availableModes: [
      { id: "default", name: "Default" },
      { id: "yolo", name: "YOLO" },
    ],
  },
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "qwen3-coder",
      options: [
        { value: "qwen3-coder", name: "Qwen3 Coder" },
        { value: "qwen3-max", name: "Qwen3 Max" },
      ],
    },
  ],
};

describe("draftInfo", () => {
  it("shows the agent's last options, starting in the safe mode", () => {
    const info = draftInfo(qwen, NO_CHOICES);

    expect(info.modes?.currentModeId).toBe("default");
    expect(info.configOptions[0].currentValue).toBe("qwen3-coder");
  });

  it("shows what the user picked", () => {
    const info = draftInfo(qwen, { modeId: "yolo", config: { model: "qwen3-max" } });

    expect(info.modes?.currentModeId).toBe("yolo");
    expect(info.configOptions[0].currentValue).toBe("qwen3-max");
  });
});

describe("models an agent reports", () => {
  it("shows the model the user picked in the draft", () => {
    expect(draftInfo(gemini, NO_CHOICES).models?.currentModelId).toBe("auto");
    expect(draftInfo(gemini, { config: {}, modelId: "gemini-2.5-flash" }).models?.currentModelId).toBe("gemini-2.5-flash");
    expect(draftInfo(qwen, NO_CHOICES).models).toBeNull();
  });

  it("sets the picked model once the agent is up, before the other settings", () => {
    const withEffort: AgentOptions = {
      ...gemini,
      configOptions: [
        {
          id: "effort",
          name: "Effort",
          category: "thought_level",
          currentValue: "low",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
    };
    const choices = { config: { effort: "high" }, modelId: "gemini-2.5-flash" };

    expect(changesToApply(withEffort, choices, false)).toEqual([
      { kind: "model", modelId: "gemini-2.5-flash" },
      { kind: "config", configId: "effort", value: "high" },
    ]);
  });

  it("leaves the model to its config option when an agent reports both, as Codex and Qwen Code do", () => {
    const both: AgentOptions = { ...gemini, configOptions: qwen.configOptions };

    expect(hasModelConfig(both.configOptions)).toBe(true);
    expect(changesToApply(both, { config: {}, modelId: "gemini-2.5-flash" }, false)).toEqual([]);
    expect(changesToApply(both, { config: { model: "qwen3-max" }, modelId: "gemini-2.5-flash" }, false)).toEqual([
      { kind: "config", configId: "model", value: "qwen3-max" },
    ]);
  });

  it("takes only a model config option that offers something as the agent's model", () => {
    expect(hasModelConfig(gemini.configOptions)).toBe(false);
    expect(hasModelConfig([{ ...qwen.configOptions[0], options: [] }])).toBe(false);
  });

  it("sends a pick as it is when a reopened session's answer reports no models", () => {
    const choices = { config: {}, modelId: "gemini-2.5-flash" };

    expect(changesToApply({ modes: null, configOptions: [], reopenedWith: "resume" }, choices, false)).toEqual([
      { kind: "model", modelId: "gemini-2.5-flash" },
    ]);
    // A new session that reports none has none to offer, so nothing is sent.
    expect(changesToApply({ modes: null, configOptions: [] }, choices, false)).toEqual([]);
  });

  it("skips a model that holds already or that the agent no longer offers", () => {
    expect(changesToApply(gemini, { config: {}, modelId: "auto" }, false)).toEqual([]);
    expect(changesToApply(gemini, { config: {}, modelId: "gone" }, false)).toEqual([]);
    expect(changesToApply(qwen, { config: {}, modelId: "gemini-2.5-flash" }, false)).toEqual([]);
  });

  it("starts the next session with the model picked last while it is still offered", () => {
    const remembered = { ...gemini, preferredModelId: "gemini-2.5-flash" };

    expect(withPreferred(NO_CHOICES, remembered).modelId).toBe("gemini-2.5-flash");
    expect(withPreferred({ config: {}, modelId: "auto" }, remembered).modelId).toBe("auto");
    expect(withPreferred(NO_CHOICES, { ...gemini, preferredModelId: "gone" })).toBe(NO_CHOICES);
    expect(withPreferred(NO_CHOICES, gemini)).toBe(NO_CHOICES);
  });

  it("counts models as reported options and fills them in from a probe", () => {
    expect(hasReportedOptions(gemini)).toBe(true);
    const probed = { modes: null, configOptions: [], commands: [], models: gemini.models };

    expect(withProbed(undefined, probed).models).toBe(gemini.models);
    expect(withProbed({ modes: null, configOptions: [] }, probed).models).toBe(gemini.models);
    const known = { ...gemini, models: { currentModelId: "x", availableModels: [] } };
    expect(withProbed(known, probed).models).toBe(known.models);
  });
});

describe("changesToApply", () => {
  it("applies the safe mode when the user picked nothing", () => {
    expect(changesToApply(qwen, NO_CHOICES, true)).toEqual([{ kind: "mode", modeId: "default" }]);
  });

  it("applies the user's picks instead of the safe mode, skipping what already holds", () => {
    expect(changesToApply(qwen, { modeId: "yolo", config: { model: "qwen3-max" } }, true)).toEqual([
      { kind: "config", configId: "model", value: "qwen3-max" },
    ]);
    expect(changesToApply(qwen, { modeId: "default", config: { model: "qwen3-coder" } }, true)).toEqual([
      { kind: "mode", modeId: "default" },
    ]);
  });

  it("ignores picks the agent no longer offers", () => {
    expect(changesToApply(qwen, { modeId: "plan", config: { model: "gpt-9", effort: "high" } }, false)).toEqual([]);
  });

  it("leaves the mode alone when asked to keep it, as for a fork", () => {
    expect(changesToApply(qwen, NO_CHOICES, false)).toEqual([]);
  });
});

describe("the model picked last", () => {
  it("starts the next session with it, while the agent still offers it", () => {
    const remembered = { ...qwen, preferredConfig: { model: "qwen3-max" } };

    expect(withPreferred(NO_CHOICES, remembered).config).toEqual({ model: "qwen3-max" });
    expect(changesToApply(qwen, withPreferred(NO_CHOICES, remembered), false)).toEqual([
      { kind: "config", configId: "model", value: "qwen3-max" },
    ]);
  });

  it("gives way to a pick made for this session, and to a model the agent no longer offers", () => {
    const remembered = { ...qwen, preferredConfig: { model: "qwen3-max" } };
    const gone = { ...qwen, preferredConfig: { model: "retired-model" } };

    expect(withPreferred({ config: { model: "qwen3-coder" } }, remembered).config).toEqual({ model: "qwen3-coder" });
    expect(withPreferred(NO_CHOICES, gone).config).toEqual({});
  });

  const withEffort: AgentOptions = {
    ...qwen,
    configOptions: [
      ...qwen.configOptions,
      {
        id: "reasoning_effort",
        name: "Effort",
        category: "thought_level",
        currentValue: "low",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
      { id: "mode", name: "Mode", category: "mode", currentValue: "default", options: [{ value: "yolo", name: "YOLO" }] },
    ],
  };

  it("remembers model and effort picks, not other settings", () => {
    const afterModel = rememberedChoice(withEffort, "model", "qwen3-max");
    expect(afterModel).toEqual({ model: "qwen3-max" });
    expect(rememberedChoice({ ...withEffort, preferredConfig: afterModel ?? {} }, "reasoning_effort", "high")).toEqual({
      model: "qwen3-max",
      reasoning_effort: "high",
    });
    expect(rememberedChoice(withEffort, "mode", "yolo")).toBeNull();
  });

  it("keeps what the agent settled on after a change, such as an effort a model change reset", () => {
    const remembered = { ...withEffort, preferredConfig: { reasoning_effort: "high" } };
    const reported = withEffort.configOptions.map((o) =>
      o.id === "model" ? { ...o, currentValue: "qwen3-max" } : o.id === "reasoning_effort" ? { ...o, currentValue: "low" } : o,
    );

    expect(rememberedChoice(remembered, "model", "qwen3-max", reported)).toEqual({
      model: "qwen3-max",
      reasoning_effort: "low",
    });
  });

  it("applies the model before the effort, whose choices depend on it", () => {
    const choices = { config: { reasoning_effort: "high", model: "qwen3-max" } };

    expect(changesToApply(withEffort, choices, false)).toEqual([
      { kind: "config", configId: "model", value: "qwen3-max" },
      { kind: "config", configId: "reasoning_effort", value: "high" },
    ]);
  });
});

describe("withProbed", () => {
  const probed = {
    modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
    configOptions: [
      { id: "model", name: "Model", category: "model", type: "select", currentValue: "fast", options: [{ value: "fast", name: "Fast" }] },
    ],
    commands: [{ name: "review", description: "Review the changes" }],
  } as unknown as Required<Pick<AgentOptions, "modes" | "configOptions" | "commands">>;

  it("fills in what an agent that never ran offers", () => {
    expect(withProbed(undefined, probed)).toEqual(probed);
  });

  it("keeps what a session reported: it is newer than a probe that started before it", () => {
    const known: AgentOptions = {
      modes: null,
      configOptions: [{ ...probed.configOptions[0], currentValue: "smart" }],
      commands: [{ name: "init", description: "Set up the project" }],
      preferredConfig: { model: "smart" },
    };

    expect(withProbed(known, probed)).toEqual({ ...known, modes: probed.modes });
  });

  it("does not empty remembered commands when the probe heard none", () => {
    const commands = [{ name: "init", description: "Set up the project" }];
    const known: AgentOptions = { modes: null, configOptions: [], commands };

    expect(withProbed(known, { ...probed, commands: [] }).commands).toEqual(commands);
  });
});

describe("hasReportedOptions", () => {
  it("is true once the agent reported modes, options or commands, and false for a bare model pick", () => {
    expect(hasReportedOptions(undefined)).toBe(false);
    expect(hasReportedOptions({ modes: null, configOptions: [], preferredConfig: { model: "fast" } })).toBe(false);
    expect(hasReportedOptions({ modes: null, configOptions: [], commands: [{ name: "init", description: "Set up" }] })).toBe(true);
    expect(hasReportedOptions({ modes: { currentModeId: "default", availableModes: [] }, configOptions: [] })).toBe(true);
  });
});

describe("an effort list follows its model", () => {
  const toggle = { value: "default", name: "Thinking on" };
  const kimiEffort = {
    id: "reasoning_effort",
    name: "Reasoning effort",
    category: "thought_level",
    currentValue: "default",
    options: [toggle],
  };
  const deepseekEffort = {
    ...kimiEffort,
    currentValue: "high",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
      { value: "max", name: "Max" },
    ],
  };
  const modelOption = (currentValue: string) => ({
    id: "model",
    name: "Model",
    category: "model",
    currentValue,
    options: [
      { value: "kimi", name: "Kimi" },
      { value: "deepseek", name: "DeepSeek" },
      { value: "glm", name: "GLM" },
    ],
  });
  const onKimi: AgentOptions = { modes: null, configOptions: [modelOption("kimi"), kimiEffort] };
  const effortOf = (options: { configOptions: AcpConfigOption[] }) =>
    options.configOptions.find((o) => o.category === "thought_level");

  it("remembers the effort list under the model it was reported for", () => {
    const remembered = withEffortList(withEffortList(onKimi), { configOptions: [modelOption("deepseek"), deepseekEffort] });

    expect(remembered.effortsByModel).toEqual({ kimi: kimiEffort, deepseek: deepseekEffort });
  });

  it("shows the picked model's own effort list in a draft", () => {
    const known = withEffortList(withEffortList(onKimi), { configOptions: [modelOption("deepseek"), deepseekEffort] });
    const draft = { ...known, configOptions: [modelOption("kimi"), kimiEffort] };

    const info = draftInfo(draft, { config: { model: "deepseek", reasoning_effort: "max" } });

    expect(effortOf(info)?.options.map((o) => o.value)).toEqual(["low", "high", "max"]);
    expect(effortOf(info)?.currentValue).toBe("max");
  });

  it("shows the picked model's own effort when the effort picked earlier is not on its list", () => {
    const known = withEffortList(withEffortList(onKimi), { configOptions: [modelOption("deepseek"), deepseekEffort] });
    const draft = { ...known, configOptions: [modelOption("kimi"), kimiEffort] };

    const info = draftInfo(draft, { config: { reasoning_effort: "default", model: "deepseek" } });

    expect(effortOf(info)?.currentValue).toBe("high");
  });

  it("shows no effort for a picked model whose list is not known yet, rather than another model's", () => {
    const info = draftInfo(withEffortList(onKimi), { config: { model: "glm" } });

    expect(effortOf(info)).toBeUndefined();
  });

  it("keeps the reported list while the draft stays on the model it came from", () => {
    expect(effortOf(draftInfo(withEffortList(onKimi), NO_CHOICES))).toEqual(kimiEffort);
  });

  it("remembers what a session or probe reports, keeping the lists of the other models", () => {
    const afterKimi = withReported(undefined, { configOptions: [modelOption("kimi"), kimiEffort] });
    const afterDeepseek = withReported(afterKimi, { configOptions: [modelOption("deepseek"), deepseekEffort] });

    expect(afterDeepseek.configOptions).toEqual([modelOption("deepseek"), deepseekEffort]);
    expect(afterDeepseek.effortsByModel).toEqual({ kimi: kimiEffort, deepseek: deepseekEffort });
  });

  it("starts with the effort picked last when the model picked last offers it", () => {
    const known = withEffortList(withEffortList(onKimi), { configOptions: [modelOption("deepseek"), deepseekEffort] });
    const draft = {
      ...known,
      configOptions: [modelOption("kimi"), kimiEffort],
      preferredConfig: { model: "deepseek", reasoning_effort: "max" },
    };

    expect(withPreferred(NO_CHOICES, draft).config).toEqual({ model: "deepseek", reasoning_effort: "max" });
  });
});
