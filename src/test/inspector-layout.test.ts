import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clampInspectorWidth, isCrowded, shownInspectorWidth } from "../lib/inspector";
import { useInspectorWidth } from "../hooks/useInspectorWidth";

const KEY = "zorvo.inspectorWidth";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("inspector layout", () => {
  it("keeps the width within 320 and 720", () => {
    expect(clampInspectorWidth(100)).toBe(320);
    expect(clampInspectorWidth(900)).toBe(720);
    expect(clampInspectorWidth(400.6)).toBe(401);
    expect(clampInspectorWidth(NaN)).toBe(380);
  });

  it("widens only the Terminal tab", () => {
    expect(shownInspectorWidth("terminal", 380)).toBe(560);
    expect(shownInspectorWidth("terminal", 640)).toBe(640);
    expect(shownInspectorWidth("files", 380)).toBe(380);
    expect(shownInspectorWidth(null, 380)).toBe(0);
  });

  it("gives way to the chat only when the window is narrow", () => {
    expect(isCrowded(1100, 380, true)).toBe(true);
    expect(isCrowded(1440, 380, true)).toBe(false);
    expect(isCrowded(1100, 380, false)).toBe(false);
  });
});

describe("useInspectorWidth", () => {
  it("remembers the width, and survives a bad or blocked store", () => {
    const first = renderHook(() => useInspectorWidth());
    act(() => first.result.current[1](500));
    expect(renderHook(() => useInspectorWidth()).result.current[0]).toBe(500);

    localStorage.setItem(KEY, "abc");
    expect(renderHook(() => useInspectorWidth()).result.current[0]).toBe(380);
    localStorage.setItem(KEY, "9999");
    expect(renderHook(() => useInspectorWidth()).result.current[0]).toBe(720);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const blocked = renderHook(() => useInspectorWidth());
    expect(blocked.result.current[0]).toBe(380);
    act(() => blocked.result.current[1](450));
    expect(blocked.result.current[0]).toBe(450);
  });
});
