import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrivateUsage } from "../hooks/usePrivateUsage";
import type { Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function session(usage?: Session["privateUsage"], privateMode = true): Session {
  return {
    id: "s-1",
    name: "Private review",
    profileId: "qwen-code",
    cwd: "/w",
    status: "running",
    createdAt: 1,
    transport: "acp",
    ...(privateMode ? { privateMode: { modelId: "Qwen/Qwen3.8-27B" } } : {}),
    ...(usage ? { privateUsage: usage } : {}),
  };
}

describe("usePrivateUsage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the backend's running total to the total saved before the restart", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockResolvedValueOnce({ credits: 6.2, estimated: true, calls: 1 })
      .mockResolvedValueOnce({ credits: 8, estimated: false, calls: 0 });
    const updateSession = vi.fn();
    const sessions = [session({ credits: 10, estimated: false })];
    const { result } = renderHook(() => usePrivateUsage({ sessions, updateSession }));

    await act(async () => result.current.refresh("s-1"));
    await waitFor(() =>
      expect(updateSession).toHaveBeenLastCalledWith("s-1", { credits: 16.2, estimated: true }),
    );

    await act(async () => result.current.refresh("s-1"));
    await waitFor(() =>
      expect(updateSession).toHaveBeenLastCalledWith("s-1", { credits: 18, estimated: false }),
    );
    expect(spy).toHaveBeenCalledWith("private_session_usage", { sessionId: "s-1" }, undefined);
  });

  it("does nothing for a plain session or a malformed answer", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockResolvedValue(null);
    const updateSession = vi.fn();
    const { result } = renderHook(() => usePrivateUsage({ sessions: [session(undefined, false)], updateSession }));

    await act(async () => result.current.refresh("s-1"));
    expect(spy).not.toHaveBeenCalled();

    const privateSessions = [session()];
    const privateHook = renderHook(() => usePrivateUsage({ sessions: privateSessions, updateSession }));
    await act(async () => {
      privateHook.result.current.refresh("s-1");
      await Promise.resolve();
    });
    expect(updateSession).not.toHaveBeenCalled();
  });
});