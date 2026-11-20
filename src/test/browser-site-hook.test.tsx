import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBrowserSiteInfo } from "../hooks/useBrowserSiteInfo";

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
const info = { url: "https://example.com/", host: "example.com", security: "secure", cookieCount: 3, agentAccess: false };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("reads on open and binds Clear to the exact URL displayed to the user", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async command => ({ ...info, cookieCount: command === "browser_site_clear" ? 0 : 3 }));
  const { result, rerender } = renderHook(({ open }) => useBrowserSiteInfo("s1", "t1", info.url, open, vi.fn()), { initialProps: { open: false } });
  expect(invoke).not.toHaveBeenCalled();
  rerender({ open: true });
  await waitFor(() => expect(result.current.site?.cookieCount).toBe(3));
  await act(async () => { await result.current.clear(); });
  expect(invoke).toHaveBeenCalledWith("browser_site_clear", { sessionId: "s1", tabId: "t1", expectedUrl: info.url }, undefined);
  expect(result.current.site?.cookieCount).toBe(0);
  expect(result.current.site?.agentAccess).toBe(false);
});

it("discards a site reply after switching sessions instead of showing stale cookies or permission", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  vi.spyOn(internals(), "invoke").mockImplementation(async (_command, args) => args?.sessionId === "s1" ? pending : { ...info, cookieCount: 0 });
  const { result, rerender } = renderHook(({ sessionId }) => useBrowserSiteInfo(sessionId, "t1", info.url, true, vi.fn()), { initialProps: { sessionId: "s1" } });
  rerender({ sessionId: "s2" });
  await waitFor(() => expect(result.current.site?.cookieCount).toBe(0));
  await act(async () => { finish({ ...info, cookieCount: 12, agentAccess: true }); });
  expect(result.current.site?.cookieCount).toBe(0);
  expect(result.current.site?.agentAccess).toBe(false);
});
