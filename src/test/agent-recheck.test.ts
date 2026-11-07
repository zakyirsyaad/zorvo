import { describe, it, expect, vi, afterEach } from "vitest";
import { recheckAgents } from "../lib/agent-recheck";
import { fakeTauriInvoke } from "./setup";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recheckAgents", () => {
  it("reads the agents again, then the catalog and the logos", async () => {
    const invoke = vi.spyOn(internals(), "invoke").mockImplementation(fakeTauriInvoke);
    const order: string[] = [];
    const refreshAgents = vi.fn(async () => void order.push("agents"));
    const reloadCatalog = vi.fn(async () => void order.push("catalog"));

    await recheckAgents(refreshAgents, reloadCatalog);

    expect(order).toEqual(["agents", "catalog"]);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "get_agent_icons")).toBe(true);
  });

  it("still reads the catalog when the agents could not be read, and says it failed", async () => {
    const failure = new Error("registry down");
    const reloadCatalog = vi.fn(() => Promise.resolve());

    await expect(recheckAgents(() => Promise.reject(failure), reloadCatalog)).rejects.toBe(failure);
    expect(reloadCatalog).toHaveBeenCalled();
  });
});
