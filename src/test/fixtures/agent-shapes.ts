import type { AcpConfigOption, AcpOptions } from "../../hooks/useAcpSessions";

/**
 * What each agent reports for a new session, reduced by hand to the fields the
 * composer reads (shapes from the 0.6.1 agent audit; ids, names and descriptions
 * as the agents word them, the long persona list cut to a few entries).
 */

const choice = (value: string, name: string, description?: string) => ({ value, name, description });

const effort = (values: string[], current: string): AcpConfigOption => ({
  id: "effort",
  name: "Effort",
  category: "thought_level",
  currentValue: current,
  options: values.map((v) => choice(v, v)),
});

export const CLAUDE: AcpOptions = {
  modes: {
    currentModeId: "default",
    availableModes: [
      { id: "default", name: "Manual", description: "Asks before each action" },
      { id: "acceptEdits", name: "Accept edits", description: "Edits files without asking" },
      { id: "plan", name: "Plan", description: "Plans without editing" },
      { id: "auto", name: "Auto", description: "Approves safe actions" },
      { id: "bypassPermissions", name: "Bypass permissions", description: "Accepts all permissions" },
    ],
  },
  models: null,
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "default",
      options: [
        choice("default", "Default (recommended)", "Opus"),
        choice("opus", "Opus 5.5", "Most capable, $15 / $75 per million tokens"),
        choice("haiku", "Haiku 5.5", "Fastest, $1 / $5 per million tokens"),
      ],
    },
    effort(["default", "low", "medium", "high", "xhigh", "max"], "default"),
    {
      id: "fast",
      name: "Fast mode",
      category: "model_config",
      description: "Faster responses on supported models",
      currentValue: "off",
      options: [choice("off", "Off"), choice("on", "On")],
    },
    {
      id: "agent",
      name: "Agent",
      description: "The main thread's agent persona",
      currentValue: "none",
      options: [choice("none", "Default"), choice("reviewer", "reviewer", "Reviews code"), choice("planner", "planner")],
    },
  ],
};

export const CODEX: AcpOptions = {
  modes: {
    currentModeId: "agent",
    availableModes: [
      { id: "read-only", name: "Read-only", description: "Reads files, asks to edit" },
      { id: "workspace-write", name: "Workspace access", description: "Edits the workspace" },
      { id: "agent", name: "Auto review", description: "A reviewer approves actions" },
      { id: "agent-full-access", name: "Full access", description: "No sandbox, no approvals" },
    ],
  },
  models: {
    currentModelId: "gpt-6-luna[low]",
    availableModels: [{ modelId: "gpt-6-luna[low]", name: "gpt-6-luna (low)" }],
  },
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "gpt-6-luna",
      options: [choice("gpt-6-luna", "gpt-6-luna"), choice("gpt-6-terra", "gpt-6-terra")],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      currentValue: "low",
      options: ["low", "medium", "high", "max", "ultra"].map((v) => choice(v, v)),
    },
    {
      id: "collaboration_mode",
      name: "Collaboration mode",
      category: "collaboration_mode",
      currentValue: "default",
      options: [choice("default", "Default", "Works on your request"), choice("plan", "Plan", "Plans before acting")],
    },
  ],
};

export const GEMINI: AcpOptions = {
  modes: {
    currentModeId: "default",
    availableModes: [
      { id: "default", name: "Default", description: "Prompts for approval" },
      { id: "autoEdit", name: "Auto Edit", description: "Approves file edits" },
      { id: "yolo", name: "YOLO", description: "Auto-approves all tools" },
      { id: "plan", name: "Plan", description: "Read-only mode" },
    ],
  },
  models: {
    currentModelId: "auto",
    availableModels: [
      { modelId: "auto", name: "Auto", description: "Routes between the two Gemini 3 models by task" },
      { modelId: "gemini-2.5-pro", name: "gemini-2.5-pro" },
    ],
  },
  configOptions: [],
};

export const QWEN: AcpOptions = {
  modes: {
    currentModeId: "yolo",
    availableModes: [
      { id: "plan", name: "Plan" },
      { id: "default", name: "Default" },
      { id: "auto-edit", name: "Auto-edit" },
      { id: "auto", name: "Auto", description: "LLM classifier auto-approves safe actions" },
      { id: "yolo", name: "YOLO" },
    ],
  },
  models: {
    currentModelId: "qwen3.7-plus",
    availableModels: [{ modelId: "qwen3.7-plus", name: "[ModelStudio] qwen3.7-plus" }],
  },
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "qwen3.7-plus",
      options: [choice("qwen3.7-plus", "[ModelStudio] qwen3.7-plus")],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      currentValue: "high",
      options: ["none", "low", "high", "max"].map((v) => choice(v, v)),
    },
  ],
};
