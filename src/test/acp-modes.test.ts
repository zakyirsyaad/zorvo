import { describe, it, expect } from "vitest";
import { safeModeToApply } from "../lib/acp-modes";
import { changesToApply, NO_CHOICES } from "../lib/acp-draft";
import type { AcpConfigOption, AcpModes } from "../hooks/useAcpSessions";
import { CODEX } from "./fixtures/agent-shapes";

const mode = (id: string) => ({ id, name: id });
const withModes = (modes: AcpModes | null) => ({ modes, configOptions: [] });

function modeConfig(currentValue: string, values: string[]): AcpConfigOption {
  return {
    id: "mode",
    name: "Approval",
    category: "mode",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

describe("safeModeToApply", () => {
  it("switches a risky starting mode to the agent's safe mode", () => {
    expect(
      safeModeToApply(withModes({ currentModeId: "yolo", availableModes: [mode("plan"), mode("default"), mode("yolo")] }))
    ).toEqual({ kind: "mode", modeId: "default" });
    expect(
      safeModeToApply(withModes({ currentModeId: "bypassPermissions", availableModes: [mode("manual"), mode("bypassPermissions")] }))
    ).toEqual({ kind: "mode", modeId: "manual" });
  });

  it("switches an agent whose mode is a config option", () => {
    expect(
      safeModeToApply({ modes: null, configOptions: [modeConfig("full-access", ["read-only", "full-access"])] })
    ).toEqual({ kind: "config", configId: "mode", value: "read-only" });
  });

  it("leaves a safe starting mode alone", () => {
    expect(safeModeToApply(withModes({ currentModeId: "plan", availableModes: [mode("plan"), mode("default")] }))).toBeUndefined();
    expect(safeModeToApply({ modes: null, configOptions: [modeConfig("read-only", ["read-only", "full-access"])] })).toBeUndefined();
  });

  it("leaves the mode alone when the agent offers no safe alternative or no modes", () => {
    expect(safeModeToApply(withModes({ currentModeId: "yolo", availableModes: [mode("yolo")] }))).toBeUndefined();
    expect(safeModeToApply(withModes(null))).toBeUndefined();
  });
});

describe("safeModeToApply with Codex's modes", () => {
  const codex = (current: string): AcpModes => ({
    currentModeId: current,
    availableModes: [
      { id: "read-only", name: "Read-only" },
      { id: "workspace-write", name: "Workspace access" },
      { id: "agent", name: "Auto review" },
      { id: "agent-full-access", name: "Full access" },
    ],
  });

  it("moves Full access to workspace-write, not to read-only", () => {
    expect(safeModeToApply(withModes(codex("agent-full-access")))).toEqual({ kind: "mode", modeId: "workspace-write" });
  });

  it("falls back to read-only when workspace-write is not offered", () => {
    const modes = { currentModeId: "agent-full-access", availableModes: [mode("read-only"), mode("agent-full-access")] };
    expect(safeModeToApply(withModes(modes))).toEqual({ kind: "mode", modeId: "read-only" });
  });

  it("recognises a risky mode by its name", () => {
    const modes = {
      currentModeId: "m2",
      availableModes: [{ id: "default", name: "Default" }, { id: "m2", name: "Full access" }],
    };
    expect(safeModeToApply(withModes(modes))).toEqual({ kind: "mode", modeId: "default" });
  });

  it("does not switch Auto review: the user's own Codex choice stays", () => {
    // Pinned on purpose: `agent` ("Auto review") is Codex's default and a reviewer
    // approves its actions. Treating it as risky needs the maintainer's say-so.
    expect(safeModeToApply(withModes(codex("agent")))).toBeUndefined();
    expect(changesToApply(CODEX, NO_CHOICES, true)).toEqual([]);
  });
});
