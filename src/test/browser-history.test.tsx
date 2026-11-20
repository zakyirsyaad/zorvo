import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBrowserHistory } from "../hooks/useBrowserHistory";

type Listener = () => void;
const listeners = new Map<string, Listener>();
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, callback: Listener) => { listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name)); } }));
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
const visit = { url: "https://example.com/", title: "Example", visitedAt: 123 };
afterEach(() => { cleanup(); vi.restoreAllMocks(); listeners.clear(); });

it("clears saved visits and refuses a stale read that resolves afterwards", async () => {
  let finish!: (value: unknown) => void;
  let reads = 0;
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async command => {
    if (command === "browser_history_clear") return [];
    reads++;
    if (reads === 1) return [visit];
    if (reads === 2) return new Promise(resolve => { finish = resolve; });
    return [];
  });
  const onError = vi.fn();
  const { result } = renderHook(() => useBrowserHistory(onError));
  await waitFor(() => expect(result.current.visits).toEqual([visit]));
  await act(async () => { listeners.get("browser-history-changed")?.(); });
  await act(async () => { await result.current.clear(); });
  expect(invoke).toHaveBeenCalledWith("browser_history_clear", {}, undefined);
  expect(result.current.visits).toEqual([]);
  await act(async () => { finish([visit]); });
  expect(result.current.visits).toEqual([]);
  expect(onError).not.toHaveBeenCalled();
});

it("receives visits added by another browser window and rejects unsafe destinations", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue([]);
  const onError = vi.fn();
  const { result } = renderHook(() => useBrowserHistory(onError));
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  invoke.mockResolvedValueOnce([visit]);
  await act(async () => { listeners.get("browser-history-changed")?.(); });
  expect(result.current.visits).toEqual([visit]);
  invoke.mockResolvedValueOnce([{ ...visit, url: "https://user:password@example.com/" }]);
  await act(async () => { listeners.get("browser-history-changed")?.(); });
  expect(result.current.visits).toEqual([visit]);
  expect(onError).toHaveBeenCalledWith("Error: Browser history is unavailable.");
});

it("allows clearing corrupt saved history and recovers after a successful clear", async () => {
  let cleared = false;
  vi.spyOn(internals(), "invoke").mockImplementation(async command => {
    if (command === "browser_history_clear") { cleared = true; return []; }
    if (!cleared) throw new Error("Browser history could not be read. Clear it to start again.");
    return [];
  });
  const { result } = renderHook(() => useBrowserHistory(vi.fn()));
  await waitFor(() => expect(result.current.failed).toBe(true));
  await act(async () => { await result.current.clear(); });
  expect(result.current.failed).toBe(false);
  expect(result.current.visits).toEqual([]);
  expect(result.current.busy).toBe(false);
});
