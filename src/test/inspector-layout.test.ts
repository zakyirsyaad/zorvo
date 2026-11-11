import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clampInspectorWidth, isCrowded, maxInspectorWidth, minInspectorWidth, offeredTabs, shownInspectorWidth } from "../lib/inspector";
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

  it("widens the Files tab while a file is open in it, and no other tab", () => {
    expect(shownInspectorWidth("files", 380, true)).toBe(560);
    expect(shownInspectorWidth("files", 640, true)).toBe(640);
    expect(shownInspectorWidth("changes", 380, true)).toBe(380);
    expect(minInspectorWidth("files", true)).toBe(560);
    expect(minInspectorWidth("files")).toBe(320);
  });

  it("offers only the tabs that apply", () => {
    expect(offeredTabs({ hasFolder: true, isRepository: true, hasSession: true })).toEqual(["changes", "activity", "files", "terminal"]);
    expect(offeredTabs({ hasFolder: true, isRepository: false, hasSession: true })).toEqual(["activity", "files", "terminal"]);
    expect(offeredTabs({ hasFolder: true, isRepository: true, hasSession: false })).toEqual(["changes", "files", "terminal"]);
    expect(offeredTabs({ hasFolder: false, isRepository: false, hasSession: true })).toEqual(["activity"]);
    expect(offeredTabs({ hasFolder: false, isRepository: false, hasSession: false })).toEqual([]);
  });

  it("gives way to the chat only when the window is narrow", () => {
    expect(isCrowded(1100, 380, true)).toBe(true);
    expect(isCrowded(1440, 380, true)).toBe(false);
    expect(isCrowded(1100, 380, false)).toBe(false);
  });

  it("counts the sidebar and the insets around the sheets", () => {
    expect(isCrowded(1280, 380, true)).toBe(false); // 1280 - 264 - 380 - 16 = 620
    expect(isCrowded(1200, 380, true)).toBe(false); // the default window size keeps the sidebar: 540
    expect(isCrowded(1196, 380, true)).toBe(false); // exactly 536
    expect(isCrowded(1195, 380, true)).toBe(true);
    expect(isCrowded(1280, 560, true)).toBe(true); // 440
    expect(isCrowded(640, 560, false)).toBe(false); // no sidebar, never crowded
  });

  it("caps the inspector so the main sheet keeps 240px", () => {
    // Sidebar hidden: 8px at the left, 8px between the sheets, 8px at the right.
    expect(maxInspectorWidth(640, false)).toBe(376); // 640 - 8 - 16 - 240
    // Sidebar shown: it takes 264px, and the stage has no inset at its left.
    expect(maxInspectorWidth(1200, true)).toBe(680); // 1200 - 264 - 16 - 240
    expect(maxInspectorWidth(1440, true)).toBe(920); // above the inspector's own 720 maximum: no cap
  });

  it("shows the Terminal tab at the cap in a small window, over its 560 minimum and the stored width", () => {
    expect(shownInspectorWidth("terminal", 380, false, maxInspectorWidth(640, false))).toBe(376);
    expect(shownInspectorWidth("changes", 500, false, 376)).toBe(376);
    // Room to spare: nothing changes, and the stored width is not touched.
    expect(shownInspectorWidth("terminal", 380, false, maxInspectorWidth(1440, false))).toBe(560);
    expect(shownInspectorWidth("changes", 380, false, 1176)).toBe(380);
    expect(shownInspectorWidth(null, 380, false, 376)).toBe(0);
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
