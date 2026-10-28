import { describe, it, expect, vi } from "vitest";
import { acpControls } from "../lib/composer-controls";
import { changesToApply, rememberedChoice, NO_CHOICES, type AgentOptions } from "../lib/acp-draft";
import { CLAUDE, CODEX, GEMINI, QWEN } from "./fixtures/agent-shapes";

const actions = () => ({ setMode: vi.fn(), setModel: vi.fn(), setConfigOption: vi.fn() });
const labels = (options: { label: string }[] | undefined) => options?.map((o) => o.label);

describe("acpControls for each agent's real shape", () => {
  it("Claude: modes with descriptions, a risk mark, the default model resolved, effort and two extras", () => {
    const a = actions();
    const controls = acpControls(CLAUDE, a);

    expect(labels(controls.permission?.options)).toEqual(["Manual", "Accept edits", "Plan", "Auto", "Bypass permissions"]);
    expect(controls.permission?.options[0].description).toBe("Asks before each action");
    expect(controls.permission?.options.filter((o) => o.risky).map((o) => o.value)).toEqual(["bypassPermissions"]);

    // "Default (recommended)" is shown as what it is, and the description is not repeated.
    expect(controls.model?.options[0]).toEqual({ value: "default", label: "Default (Opus)" });
    expect(controls.model?.options[1].description).toBe("Most capable, $15 / $75 per million tokens");
    expect(labels(controls.effort?.options)).toEqual(["default", "low", "medium", "high", "xhigh", "max"]);

    expect(controls.extras?.map((e) => [e.id, e.label])).toEqual([
      ["fast", "Fast mode"],
      ["agent", "Agent"],
    ]);
    expect(controls.extras?.[0].description).toBe("Faster responses on supported models");
    controls.extras?.[0].onChange("on");
    controls.extras?.[1].onChange("reviewer");
    expect(a.setConfigOption).toHaveBeenNthCalledWith(1, "fast", "on");
    expect(a.setConfigOption).toHaveBeenNthCalledWith(2, "agent", "reviewer");
  });

  it("Codex: Full access is risky, collaboration mode is the only way to Plan, and models is ignored", () => {
    const a = actions();
    const controls = acpControls(CODEX, a);

    expect(controls.permission?.options.filter((o) => o.risky).map((o) => o.value)).toEqual(["agent-full-access"]);
    expect(labels(controls.model?.options)).toEqual(["gpt-6-luna", "gpt-6-terra"]);
    expect(labels(controls.effort?.options)).toEqual(["low", "medium", "high", "max", "ultra"]);

    expect(controls.extras).toHaveLength(1);
    const [collaboration] = controls.extras ?? [];
    expect(collaboration).toMatchObject({ id: "collaboration_mode", label: "Collaboration mode", selected: "default" });
    expect(collaboration.options.map((o) => [o.value, o.description])).toEqual([
      ["default", "Works on your request"],
      ["plan", "Plans before acting"],
    ]);
    collaboration.onChange("plan");
    expect(a.setConfigOption).toHaveBeenCalledWith("collaboration_mode", "plan");
    expect(a.setModel).not.toHaveBeenCalled();
  });

  it("Gemini: modes plus models only, YOLO marked, no effort and no extras", () => {
    const a = actions();
    const controls = acpControls(GEMINI, a);

    expect(controls.permission?.options.find((o) => o.value === "yolo")).toMatchObject({
      risky: true,
      description: "Auto-approves all tools",
    });
    expect(controls.permission?.options.filter((o) => o.risky)).toHaveLength(1);
    expect(controls.model?.options[0]).toMatchObject({ value: "auto", description: "Routes between the two Gemini 3 models by task" });
    controls.model?.onChange("gemini-2.5-pro");
    expect(a.setModel).toHaveBeenCalledWith("gemini-2.5-pro");
    expect(controls.effort).toBeUndefined();
    expect(controls.extras).toBeUndefined();
  });

  it("Qwen: modes plus model and reasoning effort, nothing extra", () => {
    const controls = acpControls(QWEN, actions());

    expect(controls.permission?.options.find((o) => o.value === "auto")?.description).toBe(
      "LLM classifier auto-approves safe actions",
    );
    expect(controls.permission?.options.filter((o) => o.risky).map((o) => o.value)).toEqual(["yolo"]);
    expect(labels(controls.model?.options)).toEqual(["[ModelStudio] qwen3.7-plus"]);
    expect(labels(controls.effort?.options)).toEqual(["none", "low", "high", "max"]);
    expect(controls.extras).toBeUndefined();
  });

  it("marks a risky mode by its name when the id says nothing", () => {
    const controls = acpControls(
      { modes: { currentModeId: "a", availableModes: [{ id: "a", name: "Ask" }, { id: "x1", name: "Full access" }] }, configOptions: [] },
      actions(),
    );
    expect(controls.permission?.options.map((o) => o.risky)).toEqual([undefined, true]);
  });

  it("folds only a model-name description into a Default label", () => {
    const models = (description: string | undefined) =>
      acpControls(
        { modes: null, configOptions: [], models: { currentModelId: "d", availableModels: [{ modelId: "d", name: "Default", description }] } },
        actions(),
      ).model?.options[0];

    expect(models("Sonnet 5.5")).toEqual({ value: "d", label: "Default (Sonnet 5.5)" });
    expect(models("")).toEqual({ value: "d", label: "Default" });
    expect(models("   ")).toEqual({ value: "d", label: "Default" });
    expect(models("Routes between the two Gemini 3 models")).toMatchObject({
      label: "Default",
      description: "Routes between the two Gemini 3 models",
    });
  });

  it("offers no extra for an option with nothing to choose", () => {
    const single: typeof CODEX = {
      ...CODEX,
      configOptions: [{ id: "x", name: "X", currentValue: "a", options: [{ value: "a", name: "A" }] }],
    };
    expect(acpControls(single, actions()).extras).toBeUndefined();
  });
});

describe("extra options in the picks sent to the agent", () => {
  it("sends a pick of Codex's collaboration mode and Claude's extras as config changes", () => {
    expect(changesToApply(CODEX, { config: { collaboration_mode: "plan" } }, false)).toEqual([
      { kind: "config", configId: "collaboration_mode", value: "plan" },
    ]);
    expect(changesToApply(CLAUDE, { config: { fast: "on", agent: "reviewer", model: "opus" } }, false)).toEqual([
      { kind: "config", configId: "model", value: "opus" },
      { kind: "config", configId: "fast", value: "on" },
      { kind: "config", configId: "agent", value: "reviewer" },
    ]);
  });

  it("remembers fast mode with the model and effort, but not the collaboration mode or persona", () => {
    const claude: AgentOptions = { modes: CLAUDE.modes, configOptions: CLAUDE.configOptions };
    const codex: AgentOptions = { modes: CODEX.modes, configOptions: CODEX.configOptions };

    expect(rememberedChoice(claude, "fast", "on")).toEqual({ fast: "on" });
    expect(rememberedChoice(claude, "agent", "reviewer")).toBeNull();
    expect(rememberedChoice(codex, "collaboration_mode", "plan")).toBeNull();
  });

  it("starts with no picks", () => {
    expect(changesToApply(CODEX, NO_CHOICES, false)).toEqual([]);
  });
});
