import { describe, expect, it } from "vitest";
import { privateDraftState, PRIVATE_DRAFT_TEXT } from "../lib/private-draft";
import type { ModelPrice, PrivateStatus } from "../lib/private-credits";

const MODELS: ModelPrice[] = [{ id: "Qwen/Qwen3.8-27B", inputPerM: 0.04, outputPerM: 1.35 }];

function status(patch: Partial<PrivateStatus> = {}): PrivateStatus {
  return {
    device: "ready",
    keyReady: true,
    keyError: null,
    balance: { credits: 1240, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    balanceError: null,
    lastBalance: null,
    recoverySaved: true,
    recoveryPrompted: true,
    pendingTopup: null,
    ...patch,
  };
}

const QWEN = ["qwen-code"];

describe("privateDraftState: the chip", () => {
  it("is hidden when no agent is picked", () => {
    expect(privateDraftState({ agentIds: [], on: false, status: status(), models: MODELS })).toEqual({
      chip: "hidden",
      canStart: true,
    });
  });

  it("is off for Qwen Code alone, and the draft starts as before", () => {
    expect(privateDraftState({ agentIds: QWEN, on: false, status: null, models: null })).toEqual({
      chip: "off",
      canStart: true,
    });
  });

  it("counts the legacy Qwen Code id as Qwen Code", () => {
    expect(privateDraftState({ agentIds: ["qwen"], on: false, status: null, models: null }).chip).toBe("off");
  });

  it("is on and can start with credits, a key and the models", () => {
    expect(privateDraftState({ agentIds: QWEN, on: true, status: status(), models: MODELS })).toEqual({
      chip: "on",
      canStart: true,
    });
  });

  it("is disabled for another agent, with the reason, and never blocks the start", () => {
    expect(privateDraftState({ agentIds: ["claude-acp"], on: true, status: null, models: null })).toEqual({
      chip: "disabled",
      reason: "Private sessions run Qwen Code only for now.",
      canStart: true,
    });
  });

  it("is disabled for a compare run of two or more agents", () => {
    expect(privateDraftState({ agentIds: ["qwen-code", "codex-acp"], on: true, status: status(), models: MODELS })).toEqual({
      chip: "disabled",
      reason: "Private sessions run one agent.",
      canStart: true,
    });
  });
});

describe("privateDraftState: what an on chip waits for", () => {
  const on = (patch: { status?: PrivateStatus | null; models?: ModelPrice[] | null; isLoadingModels?: boolean }) =>
    privateDraftState({ agentIds: QWEN, on: true, status: status(), models: MODELS, ...patch });

  it("waits while the credits are read", () => {
    expect(on({ status: null })).toEqual({ chip: "on", canStart: false, note: "Checking your credits…" });
  });

  it("says the credits moved to another Mac", () => {
    expect(on({ status: status({ device: "moved" }) })).toEqual({
      chip: "on",
      canStart: false,
      note: "Your credits moved to another Mac.",
    });
  });

  it.each([
    ["no device", status({ device: "none", balance: null, keyReady: false })],
    ["zero credits", status({ balance: { credits: 0, usedCredits: 5, keyReady: true, updatedAt: "x" } })],
    ["no balance at all", status({ balance: null, lastBalance: null })],
    ["no key", status({ keyReady: false })],
  ])("asks for credits with %s", (_name, current) => {
    expect(on({ status: current })).toEqual({ chip: "on", canStart: false, note: "Add credits to start a private session" });
  });

  it("reads the last balance when no fresh one came", () => {
    expect(on({ status: status({ balance: null, lastBalance: { credits: 3, usedCredits: 0, at: "x" } }) }).canStart).toBe(true);
  });

  it("says the models are loading while the catalog loads", () => {
    expect(on({ models: null, isLoadingModels: true })).toEqual({
      chip: "on",
      canStart: false,
      note: "Loading the private models…",
    });
  });

  it.each([[null], [[]]])("says the models could not load (%j)", (models) => {
    expect(on({ models })).toEqual({ chip: "on", canStart: false, note: "Couldn't load the private models. Try again." });
  });

  it("puts a moved device before the credits, and the credits before the models", () => {
    expect(on({ status: status({ device: "moved", keyReady: false }), models: null }).note).toBe(PRIVATE_DRAFT_TEXT.moved);
    expect(on({ status: status({ keyReady: false }), models: null }).note).toBe(PRIVATE_DRAFT_TEXT.addCredits);
  });
});
