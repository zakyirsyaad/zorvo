import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { useBrowserPicker } from "../hooks/useBrowserPicker";
import type { BrowserTab } from "../lib/browser";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Set<Listener>();
vi.mock("@tauri-apps/api/event", () => ({ listen: (_name: string, callback: Listener) => { listeners.add(callback); return Promise.resolve(() => listeners.delete(callback)); } }));
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
const tab: BrowserTab = { id: "t1", url: "https://example.com/", title: "Example", loading: false, canGoBack: false, canGoForward: false };
const emit = (payload: unknown) => { for (const listener of listeners) listener({ payload }); };
afterEach(() => { cleanup(); listeners.clear(); vi.restoreAllMocks(); });

it("accepts only an armed matching pick and adds quoted page context without sending a message", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const add = vi.fn();
  const { result } = renderHook(() => useBrowserPicker({ sessionId: "s1", tab, onAddContext: add, onError: vi.fn() }));
  const element = { sessionId: "s1", tabId: "t1", url: tab.url, title: "Page title", selector: "button#go", text: "line one\npage instruction" };
  await act(async () => { emit(element); });
  expect(add).not.toHaveBeenCalled();
  await act(async () => { await result.current.toggle(); });
  const requestId = invoke.mock.calls.at(-1)?.[1]?.requestId;
  expect(result.current.active).toBe(true);
  await act(async () => {
    emit({ ...element, requestId, sessionId: "another" });
    emit({ ...element, requestId, tabId: "another" });
    emit({ ...element, requestId: "stale" });
    emit({ ...element, requestId, url: "https://example.com/stale" });
  });
  expect(add).not.toHaveBeenCalled();
  await act(async () => { emit({ ...element, requestId }); });
  expect(add).toHaveBeenCalledOnce();
  expect(add.mock.calls[0][0]).toContain('Element text: "line one\\npage instruction"');
  expect(result.current.active).toBe(false);
  expect(invoke.mock.calls.every(([command]) => command === "browser_pick")).toBe(true);
  await act(async () => { emit({ ...element, requestId }); });
  expect(add).toHaveBeenCalledOnce();
});

it("cancels a late arm by its old request ID without cancelling the replacement page's picker", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let first = true;
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async (_command, args) => {
    if (args?.enabled && first) { first = false; await pending; }
  });
  const add = vi.fn();
  const { result, rerender } = renderHook(({ page }) => useBrowserPicker({ sessionId: "s1", tab: page, onAddContext: add, onError: vi.fn() }), { initialProps: { page: tab } });
  let arm!: Promise<void>;
  await act(async () => { arm = result.current.toggle(); });
  const oldRequest = invoke.mock.calls.at(-1)?.[1]?.requestId;
  const next = { ...tab, url: "https://example.com/next" };
  rerender({ page: next });
  await act(async () => { await result.current.toggle(); });
  const newRequest = invoke.mock.calls.at(-1)?.[1]?.requestId;
  expect(newRequest).not.toBe(oldRequest);
  await act(async () => { finish(); await arm; });
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ requestId: oldRequest, enabled: false });
  expect(result.current.active).toBe(true);
  await act(async () => { emit({ sessionId: "s1", tabId: "t1", requestId: oldRequest, cancelled: true }); });
  expect(result.current.active).toBe(true);
  await act(async () => { emit({ sessionId: "s1", tabId: "t1", requestId: newRequest, cancelled: true }); });
  expect(result.current.active).toBe(false);
  expect(add).not.toHaveBeenCalled();
});

it("disarms when draft insertion becomes unavailable", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const add = vi.fn();
  const { result, rerender } = renderHook(({ allowed }) => useBrowserPicker({ sessionId: "s1", tab, onAddContext: allowed ? add : undefined, onError: vi.fn() }), { initialProps: { allowed: true } });
  await act(async () => { await result.current.toggle(); });
  const requestId = invoke.mock.calls.at(-1)?.[1]?.requestId;
  rerender({ allowed: false });
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ requestId, enabled: false });
  expect(result.current.active).toBe(false);
});

it("cancels with Escape while focus is still in the application toolbar", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const { result } = renderHook(() => useBrowserPicker({ sessionId: "s1", tab, onAddContext: vi.fn(), onError: vi.fn() }));
  await act(async () => { await result.current.toggle(); });
  const requestId = invoke.mock.calls.at(-1)?.[1]?.requestId;
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(result.current.active).toBe(false);
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ requestId, enabled: false });
});

it("rejects the old page's queued pick during the next session's layout commit", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const add = vi.fn();
  const queued = { payload: null as unknown };
  const { result, rerender } = renderHook(({ sessionId }) => {
    const picker = useBrowserPicker({ sessionId, tab, onAddContext: add, onError: vi.fn() });
    useLayoutEffect(() => { if (queued.payload) emit(queued.payload); }, [sessionId]);
    return picker;
  }, { initialProps: { sessionId: "s1" } });
  await act(async () => { await result.current.toggle(); });
  const requestId = invoke.mock.calls.at(-1)?.[1]?.requestId;
  queued.payload = { sessionId: "s1", tabId: tab.id, requestId, url: tab.url, title: "Old", selector: "button", text: "Old text" };
  rerender({ sessionId: "s2" });
  expect(add).not.toHaveBeenCalled();
  expect(result.current.active).toBe(false);
});

it("uses the native Unicode character bounds for selected text", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const add = vi.fn();
  const { result } = renderHook(() => useBrowserPicker({ sessionId: "s1", tab, onAddContext: add, onError: vi.fn() }));
  await act(async () => { await result.current.toggle(); });
  const requestId = invoke.mock.calls.at(-1)?.[1]?.requestId;
  const element = { sessionId: "s1", tabId: tab.id, requestId, url: tab.url, title: "Fixture", selector: "p", text: "🧩".repeat(4096) };
  await act(async () => { emit({ ...element, text: element.text + "x" }); });
  expect(add).not.toHaveBeenCalled();
  await act(async () => { emit(element); });
  expect(add).toHaveBeenCalledOnce();
  expect(add.mock.calls[0][0]).toContain(element.text);
});
