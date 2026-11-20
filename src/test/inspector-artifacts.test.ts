import { describe, expect, it } from "vitest";
import { INSPECTOR_WIDTH, minInspectorWidth, offeredTabs, shownInspectorWidth } from "../lib/inspector";

describe("the Output tab", () => {
  it("is offered for every session on screen, empty or not, between Files and Terminal", () => {
    const on = { hasFolder: true, isRepository: true, hasSession: true };
    expect(offeredTabs(on)).toEqual(["changes", "activity", "files", "artifacts", "browser", "terminal"]);
    // A draft has no session, so nothing to show there yet.
    expect(offeredTabs({ ...on, hasSession: false })).toEqual(["changes", "files", "terminal"]);
  });

  it("shows wide, for its list as for a page, so opening one does not move the edge", () => {
    expect(shownInspectorWidth("artifacts", 380)).toBe(INSPECTOR_WIDTH.wide);
    expect(shownInspectorWidth("artifacts", 640)).toBe(640);
    expect(minInspectorWidth("artifacts")).toBe(INSPECTOR_WIDTH.wide);
  });
});
