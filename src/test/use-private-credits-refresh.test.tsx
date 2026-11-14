import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_CREDITS_REFRESH_MS, usePrivateCreditsRefresh } from "../hooks/usePrivateCreditsRefresh";

describe("usePrivateCreditsRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes after a private turn only, at most once a minute across sessions", () => {
    const refresh = vi.fn(() => Promise.resolve());
    const isPrivate = vi.fn((sessionId: string) => sessionId.startsWith("private"));
    const view = renderHook(() => usePrivateCreditsRefresh(refresh, isPrivate));

    act(() => view.result.current("plain"));
    expect(refresh).not.toHaveBeenCalled();

    act(() => view.result.current("private-a"));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => view.result.current("private-b"));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(PRIVATE_CREDITS_REFRESH_MS - 1);
      view.result.current("private-b");
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
      view.result.current("private-b");
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejected refresh away from the turn", async () => {
    const refresh = vi.fn(() => Promise.reject(new Error("offline")));
    const view = renderHook(() => usePrivateCreditsRefresh(refresh, () => true));

    await act(async () => {
      view.result.current("private-a");
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});