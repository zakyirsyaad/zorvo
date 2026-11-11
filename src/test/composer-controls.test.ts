import { describe, it, expect, vi } from "vitest";
import { acpControls, isRiskyMode } from "../lib/composer-controls";
import type { AcpSessionInfo } from "../hooks/useAcpSessions";

const info: AcpSessionInfo = {
  acpSessionId: "acp-1",
  isBusy: false,
  canFork: false,
  canReopen: false,
  commands: [],
  models: null,
  modes: {
    currentModeId: "default",
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
      currentValue: "qwen-max",
      options: [
        { value: "qwen-max", name: "Qwen Max" },
        { value: "qwen-flash", name: "Qwen Flash" },
      ],
    },
  ],
};

describe("composer controls", () => {
  it("treats bypass-style modes as risky and asking modes as safe", () => {
    for (const id of ["yolo", "bypass", "bypassPermissions", "dontAsk", "full-access"]) {
      expect(isRiskyMode(id), id).toBe(true);
    }
    for (const id of ["ask", "default", "plan", "manual", "auto-edit"]) {
      expect(isRiskyMode(id), id).toBe(false);
    }
  });

  it("builds ACP controls from what the agent reported, changeable live", () => {
    const setMode = vi.fn();
    const setConfig = vi.fn();
    const controls = acpControls(info, { setMode, setConfigOption: setConfig, setModel: vi.fn() });

    expect(controls.permission?.options.map((o) => o.label)).toEqual(["Default", "YOLO"]);
    expect(controls.permission?.selected).toBe("default");
    expect(controls.model?.options.map((o) => o.label)).toEqual(["Qwen Max", "Qwen Flash"]);
    expect(controls.model?.selected).toBe("qwen-max");
    expect(controls.effort).toBeUndefined();

    controls.permission?.onChange("yolo");
    controls.model?.onChange("qwen-flash");
    expect(setMode).toHaveBeenCalledWith("yolo");
    expect(setConfig).toHaveBeenCalledWith("model", "qwen-flash");
  });

  it("builds the model control from the models an agent reports, changeable live", () => {
    const setModel = vi.fn();
    const gemini: AcpSessionInfo = {
      ...info,
      configOptions: [],
      models: {
        currentModelId: "auto",
        availableModels: [
          { modelId: "auto", name: "Auto" },
          { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        ],
      },
    };

    const controls = acpControls(gemini, { setMode: vi.fn(), setConfigOption: vi.fn(), setModel });

    expect(controls.model?.options).toEqual([
      { value: "auto", label: "Auto" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ]);
    expect(controls.model?.selected).toBe("auto");
    controls.model?.onChange("gemini-2.5-flash");
    expect(setModel).toHaveBeenCalledWith("gemini-2.5-flash");
  });

  it("prefers a model config option over models when an agent reports both", () => {
    const both: AcpSessionInfo = { ...info, models: { currentModelId: "m", availableModels: [{ modelId: "m", name: "M" }] } };
    const setModel = vi.fn();
    const setConfig = vi.fn();

    const controls = acpControls(both, { setMode: vi.fn(), setConfigOption: setConfig, setModel });

    expect(controls.model?.options.map((o) => o.label)).toEqual(["Qwen Max", "Qwen Flash"]);
    controls.model?.onChange("qwen-flash");
    expect(setConfig).toHaveBeenCalledWith("model", "qwen-flash");
    expect(setModel).not.toHaveBeenCalled();
  });

  it("offers no model control when the agent reports no models", () => {
    const none: AcpSessionInfo = { ...info, configOptions: [], models: { currentModelId: "m", availableModels: [] } };

    expect(acpControls(none, { setMode: vi.fn(), setConfigOption: vi.fn(), setModel: vi.fn() }).model).toBeUndefined();
  });

  it("falls back to a mode config option when the agent reports no modes", () => {
    const withModeOption: AcpSessionInfo = {
      ...info,
      modes: null,
      configOptions: [
        { id: "mode", name: "Mode", category: "mode", currentValue: "ask", options: [{ value: "ask", name: "Ask" }] },
      ],
    };
    const setConfig = vi.fn();

    const controls = acpControls(withModeOption, { setMode: vi.fn(), setConfigOption: setConfig, setModel: vi.fn() });
    controls.permission?.onChange("ask");

    expect(controls.permission?.selected).toBe("ask");
    expect(setConfig).toHaveBeenCalledWith("mode", "ask");
  });
  describe("an agent that reports its thinking levels as modes too (pi ACP)", () => {
    const levels = (ids: string[]) => ids.map((id) => ({ id, name: `Thinking: ${id}` }));
    const thinking = (ids: string[], current: string) => ({
      id: "thought_level",
      name: "Thinking",
      category: "thought_level",
      currentValue: current,
      options: ids.map((id) => ({ value: id, name: `Thinking: ${id}` })),
    });
    const actions = () => ({ setMode: vi.fn(), setConfigOption: vi.fn(), setModel: vi.fn() });

    it("shows one Thinking chip, the effort one", () => {
      const ids = ["off", "low", "medium", "high"];
      const pi: AcpSessionInfo = {
        ...info,
        modes: { currentModeId: "medium", availableModes: levels(ids) },
        configOptions: [thinking(ids, "medium")],
      };

      const controls = acpControls(pi, actions());

      expect(controls.permission).toBeUndefined();
      expect(controls.effort?.options.map((o) => o.value)).toEqual(ids);
    });

    it("still shows one chip when the remembered effort list is another model's", () => {
      const pi: AcpSessionInfo = {
        ...info,
        modes: { currentModeId: "medium", availableModes: levels(["off", "low", "medium", "high"]) },
        configOptions: [thinking(["off", "low", "medium", "high", "max"], "max")],
      };

      expect(acpControls(pi, actions()).permission).toBeUndefined();
    });

    it("keeps the mode chip of an agent whose modes are not its effort levels", () => {
      const qwen: AcpSessionInfo = { ...info, configOptions: [thinking(["low", "high"], "low")] };

      expect(acpControls(qwen, actions()).permission?.options.map((o) => o.value)).toEqual(["default", "yolo"]);
    });
  });
});
