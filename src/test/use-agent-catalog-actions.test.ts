import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { fakeTauriInvoke } from "./setup";

const { startUpdate } = vi.hoisted(() => ({ startUpdate: vi.fn() }));

vi.mock("../lib/agent-installs", () => ({ startInstall: vi.fn(), startUpdate }));

import { useAgentCatalogActions, type AgentCatalogActionsArgs } from "../hooks/useAgentCatalogActions";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

function renderActions(overrides: Partial<AgentCatalogActionsArgs> = {}) {
  const args: AgentCatalogActionsArgs = {
    updateState: vi.fn(),
    saveNow: () => Promise.resolve(),
    agents: [],
    sessions: [],
    stopSession: () => Promise.resolve(true),
    reloadAgents: () => Promise.resolve(),
    catalog: { catalog: null, reload: () => Promise.resolve() },
    ...overrides,
  };
  return renderHook(() => useAgentCatalogActions(args)).result.current;
}

/** The error `promise` rejects with. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => new Error("it resolved"),
    (error: unknown) => error,
  );
  if (!(outcome instanceof Error)) throw new Error("it rejected with something other than an Error");
  return outcome;
}

afterEach(() => {
  vi.restoreAllMocks();
  startUpdate.mockReset();
});

describe("useAgentCatalogActions keeps the error it wraps", () => {
  const original = new Error("disk full");

  it("as the cause of a version that could not be saved", async () => {
    const actions = renderActions({ saveNow: () => Promise.reject(original) });
    actions.updateAgent("codex-acp");
    const record = startUpdate.mock.calls[0]?.[1] as (version: string) => Promise<void>;

    const error = await rejectionOf(record("1.1.0"));

    expect(error.message).toBe("Could not save version 1.1.0: Error: disk full");
    expect(error.cause).toBe(original);
  });

  it("as the cause of a removal that could not be saved", async () => {
    const actions = renderActions({ saveNow: () => Promise.reject(original) });

    const error = await rejectionOf(actions.removeAgent("codex-acp"));

    expect(error.message).toBe("Could not save the removal: Error: disk full");
    expect(error.cause).toBe(original);
  });

  it("as the cause of a copy that could not be deleted", async () => {
    vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "remove_agent_install" ? Promise.reject(original) : fakeTauriInvoke(cmd, args),
    );
    const actions = renderActions();

    const error = await rejectionOf(actions.removeAgent("codex-acp"));

    expect(error.message).toBe("Could not delete Zorvo's copy: Error: disk full");
    expect(error.cause).toBe(original);
  });
});
