import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePrivateDraft, type PrivateDraftDeps } from "../hooks/usePrivateDraft";
import type { ModelPrice, PrivateStatus } from "../lib/private-credits";

const MODELS: ModelPrice[] = [
  { id: "Qwen/Qwen3.8-27B", inputPerM: 0.04, outputPerM: 1.35 },
  { id: "zai-org/GLM-5.3-Flash", inputPerM: 0.08, outputPerM: 0.5 },
];

const READY: PrivateStatus = {
  device: "ready",
  keyReady: true,
  keyError: null,
  balance: { credits: 1240, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
  balanceError: null,
  lastBalance: null,
  recoverySaved: true,
  recoveryPrompted: true,
  pendingTopup: null,
};

function credits(patch: Partial<PrivateDraftDeps["credits"]> = {}): PrivateDraftDeps["credits"] {
  return {
    status: READY,
    models: MODELS,
    loadCatalog: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    ...patch,
  };
}

function renderDraft(initial: PrivateDraftDeps) {
  return renderHook((deps: PrivateDraftDeps) => usePrivateDraft(deps), { initialProps: initial });
}

describe("usePrivateDraft", () => {
  it("starts off: no private mode, nothing blocked and no catalog load", () => {
    const deps = { credits: credits(), agentIds: ["qwen-code"] };
    const { result } = renderDraft(deps);

    expect(result.current.isOn).toBe(false);
    expect(result.current.chip).toEqual({ kind: "off", reason: undefined, onToggle: expect.any(Function) });
    expect(result.current.privateMode).toBeUndefined();
    expect(result.current.blocksSend).toBe(false);
    expect(result.current.note).toBeUndefined();
    expect(result.current.modelMenu).toBeUndefined();
    expect(result.current.creditsLine).toBeUndefined();
    expect(deps.credits.loadCatalog).not.toHaveBeenCalled();
    expect(deps.credits.refresh).not.toHaveBeenCalled();
  });

  it("turning on loads the catalog and reads the balance afresh, once", async () => {
    const deps = { credits: credits(), agentIds: ["qwen-code"] };
    const { result } = renderDraft(deps);

    await act(async () => result.current.chip?.onToggle());

    expect(deps.credits.loadCatalog).toHaveBeenCalledTimes(1);
    expect(deps.credits.refresh).toHaveBeenCalledWith(true);
    expect(result.current.isOn).toBe(true);
  });

  it("runs the first model by default, and the one picked after", async () => {
    const { result } = renderDraft({ credits: credits(), agentIds: ["qwen-code"] });
    await act(async () => result.current.chip?.onToggle());

    expect(result.current.privateMode).toEqual({ modelId: "Qwen/Qwen3.8-27B" });
    expect(result.current.modelMenu?.selected).toBe("Qwen/Qwen3.8-27B");
    act(() => result.current.modelMenu?.onSelect("zai-org/GLM-5.3-Flash"));
    expect(result.current.privateMode).toEqual({ modelId: "zai-org/GLM-5.3-Flash" });
    expect(result.current.creditsLine).toBe("1,240 credits left");
  });

  it("blocks Send with the reason while the credits are missing", async () => {
    const status = { ...READY, balance: null };
    const { result } = renderDraft({ credits: credits({ status }), agentIds: ["qwen-code"] });
    await act(async () => result.current.chip?.onToggle());

    expect(result.current.blocksSend).toBe(true);
    expect(result.current.note).toBe("Add credits to start a private session");
    expect(result.current.creditsLine).toBeUndefined();
  });

  it("says the models are loading while the catalog loads", async () => {
    let finish: () => void = () => {};
    const loadCatalog = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderDraft({ credits: credits({ models: null, loadCatalog }), agentIds: ["qwen-code"] });

    await act(async () => result.current.chip?.onToggle());
    expect(result.current.note).toBe("Loading the private models…");

    await act(async () => finish());
    expect(result.current.note).toBe("Couldn't load the private models. Try again.");
  });

  it("is disabled with the reason for another agent and for a compare run, and then nothing is private", async () => {
    const deps = { credits: credits(), agentIds: ["qwen-code"] };
    const { result, rerender } = renderDraft(deps);
    await act(async () => result.current.chip?.onToggle());

    rerender({ ...deps, agentIds: ["qwen-code", "codex-acp"] });
    expect(result.current.chip?.kind).toBe("disabled");
    expect(result.current.chip?.reason).toBe("Private sessions run one agent.");
    expect(result.current.isOn).toBe(false);
    expect(result.current.privateMode).toBeUndefined();

    rerender({ ...deps, agentIds: ["claude-acp"] });
    expect(result.current.chip?.reason).toBe("Private sessions run Qwen Code only for now.");
    // A disabled chip does nothing when pressed.
    act(() => result.current.chip?.onToggle());
    expect(deps.credits.loadCatalog).toHaveBeenCalledTimes(1);
  });

  it("forgets that it was on once the chip turns disabled, so going back to Qwen Code starts off", async () => {
    const deps = { credits: credits(), agentIds: ["qwen-code"] };
    const { result, rerender } = renderDraft(deps);
    await act(async () => result.current.chip?.onToggle());

    rerender({ ...deps, agentIds: ["claude-acp"] });
    rerender(deps);
    expect(result.current.chip?.kind).toBe("off");
    expect(result.current.isOn).toBe(false);

    await act(async () => result.current.chip?.onToggle());
    rerender({ ...deps, agentIds: ["qwen-code", "codex-acp"] });
    rerender(deps);
    expect(result.current.chip?.kind).toBe("off");
  });

  it("says the credits could not be checked when the status read failed", async () => {
    const { result } = renderDraft({ credits: credits({ status: null, statusFailed: true }), agentIds: ["qwen-code"] });
    await act(async () => result.current.chip?.onToggle());

    expect(result.current.note).toBe("Couldn't check your credits. Try again.");
    expect(result.current.blocksSend).toBe(true);
  });

  it("has no chip without a draft, and the next draft starts off", async () => {
    const deps = { credits: credits(), agentIds: ["qwen-code"] };
    const { result, rerender } = renderDraft(deps);
    await act(async () => result.current.chip?.onToggle());

    rerender({ ...deps, agentIds: [] });
    expect(result.current.chip).toBeUndefined();
    rerender(deps);
    expect(result.current.isOn).toBe(false);
  });

  it("turning off makes the draft ordinary again", async () => {
    const { result } = renderDraft({ credits: credits(), agentIds: ["qwen-code"] });
    await act(async () => result.current.chip?.onToggle());
    await act(async () => result.current.chip?.onToggle());

    expect(result.current.isOn).toBe(false);
    expect(result.current.privateMode).toBeUndefined();
    expect(result.current.blocksSend).toBe(false);
  });
});
