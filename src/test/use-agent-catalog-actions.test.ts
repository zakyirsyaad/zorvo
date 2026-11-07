import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { fakeTauriInvoke } from "./setup";

const { startUpdate, startInstall, cancelInstall, installEntryOf } = vi.hoisted(() => ({
  startUpdate: vi.fn(),
  startInstall: vi.fn(),
  cancelInstall: vi.fn(),
  installEntryOf: vi.fn(() => ({ status: "idle" })),
}));

vi.mock("../lib/agent-installs", () => ({ startInstall, startUpdate, cancelInstall, installEntryOf }));

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
  startInstall.mockReset();
  cancelInstall.mockReset();
  installEntryOf.mockReset().mockImplementation(() => ({ status: "idle" }));
});

describe("the welcome screen's tick and untick", () => {
  const notInstalled = { id: "gemini", name: "Gemini CLI", version: "0.9.0", status: "not_installed" };
  const catalogOf = () => ({ catalog: { agents: [notInstalled] }, reload: () => Promise.resolve() }) as unknown as AgentCatalogActionsArgs["catalog"];
  const settingsAfter = (updateState: ReturnType<typeof vi.fn>, before: Record<string, unknown>) =>
    updateState.mock.calls.reduce((state, [change]) => change(state), { settings: before }).settings;

  it("markAgent puts the agent in use at the catalog's version and installs nothing", () => {
    const updateState = vi.fn();
    const actions = renderActions({ updateState, catalog: catalogOf() });
    actions.markAgent("gemini");
    expect(settingsAfter(updateState, { enabledAgents: [] })).toMatchObject({ enabledAgents: ["gemini"], agentVersions: { gemini: "0.9.0" } });
    expect(startInstall).not.toHaveBeenCalled();
  });

  it("unmarkAgent stops a running install and takes the agent out of use", () => {
    installEntryOf.mockImplementation(() => ({ status: "installing" }));
    const updateState = vi.fn();
    const actions = renderActions({ updateState, catalog: catalogOf() });
    actions.unmarkAgent("gemini");
    expect(cancelInstall).toHaveBeenCalledWith("gemini");
    expect(settingsAfter(updateState, { enabledAgents: ["gemini"] }).enabledAgents).toEqual([]);
  });

  it("addAgent still installs an agent that is not installed", () => {
    const actions = renderActions({ catalog: catalogOf() });
    actions.addAgent("gemini");
    expect(startInstall).toHaveBeenCalledWith("gemini");
  });
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
