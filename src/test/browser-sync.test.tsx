import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useBrowser } from "../hooks/useBrowser";
import type { BrowserEngine, BrowserSessionState } from "../lib/browser";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
const state = (sessionId: string, url = "https://example.com/"): BrowserSessionState => ({
  sessionId, activeTabId: "t1", tabs: [{ id: "t1", url, title: "Example", loading: false, canGoBack: false, canGoForward: false }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("discards a pending metadata reply after changing session", async () => {
  vi.useFakeTimers();
  const pending = deferred<BrowserSessionState>();
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async (_command, input) => {
    const args = input as { sessionId: string; args: { engine: BrowserEngine } };
    if (args.sessionId === "s1") return pending.promise;
    return state(args.sessionId);
  });
  const { result, rerender } = renderHook(({ sessionId, engine }) => useBrowser(sessionId, engine), {
    initialProps: { sessionId: "s1", engine: "webkit" as BrowserEngine },
  });
  await act(async () => {});
  await advance(2_000);
  await advance(10_000);
  expect(invoke).toHaveBeenCalledTimes(1);
  rerender({ sessionId: "s2", engine: "webkit" });
  await act(async () => {});
  await act(async () => { pending.resolve(state("s1", "https://example.com/stale")); });
  expect(result.current.state.sessionId).toBe("s2");
  const reads = invoke.mock.calls.length;
  await advance(10_000);
  expect(invoke).toHaveBeenCalledTimes(reads);
});

it("refreshes after a manual operation without polling native scroll", async () => {
  vi.useFakeTimers();
  const pending = deferred<unknown>();
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async (_command, input) => {
    const args = (input as { args: { operation: string } }).args;
    return args.operation === "tabs.list" ? state("s1") : pending.promise;
  });
  const { result } = renderHook(() => useBrowser("s1", "webkit"));
  await act(async () => {});
  let operation!: Promise<unknown>;
  await act(async () => { operation = result.current.execute({ operation: "evaluate", expression: "true" }); });
  await advance(10_000);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(result.current.busy).toBe(true);
  await act(async () => { pending.resolve(true); await operation; });
  expect(result.current.busy).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(3);
  await advance(10_000);
  expect(invoke).toHaveBeenCalledTimes(3);
});
