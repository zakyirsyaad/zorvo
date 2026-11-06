import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNow } from "../hooks/useNow";

afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("moves on once a minute while mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current).toBe(1_000_000);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(1_060_000);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
