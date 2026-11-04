import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInspector } from "../hooks/useInspector";
import type { InspectorTab } from "../lib/inspector";

const originalWidth = window.innerWidth;
const ALL = ["changes", "activity", "files", "terminal"] as const;

function setWindowWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
}

type Props = { folder: string; offered: readonly InspectorTab[] };

function renderInspector(isRepository: boolean, onCrowded = vi.fn(), isSidebarShown = true, onShow = vi.fn()) {
  const view = renderHook(
    ({ folder, offered }: Props) => useInspector(folder, isRepository, 0, vi.fn(), { isSidebarShown, offered, onCrowded, onShow }),
    { initialProps: { folder: "/Users/test/zorvo", offered: ALL } as Props },
  );
  return { ...view, onCrowded, onShow };
}

afterEach(() => {
  setWindowWidth(originalWidth);
  localStorage.clear();
});

describe("useInspector", () => {
  it("opens the last tab, or Changes first in a repository", () => {
    setWindowWidth(1440);
    const repo = renderInspector(true);
    expect(repo.result.current.tab).toBeNull();
    act(() => repo.result.current.toggle(ALL));
    expect(repo.result.current.tab).toBe("changes");
    act(() => repo.result.current.show("activity"));
    act(() => repo.result.current.close());
    expect(repo.result.current.tab).toBeNull();
    act(() => repo.result.current.toggle(ALL));
    expect(repo.result.current.tab).toBe("activity");
    act(() => repo.result.current.toggle(ALL));
    expect(repo.result.current.tab).toBeNull();

    const plain = renderInspector(false);
    act(() => plain.result.current.toggle(["activity", "files", "terminal"]));
    expect(plain.result.current.tab).toBe("files");
  });

  it("asks the sidebar to give way in a narrow window", () => {
    setWindowWidth(1100);
    const narrow = renderInspector(true);
    act(() => narrow.result.current.toggle(ALL));
    expect(narrow.onCrowded).toHaveBeenCalledTimes(1);

    setWindowWidth(1440);
    const wide = renderInspector(true);
    act(() => wide.result.current.toggle(ALL));
    expect(wide.onCrowded).not.toHaveBeenCalled();

    setWindowWidth(1100);
    const hidden = renderInspector(true, vi.fn(), false);
    act(() => hidden.result.current.show("files"));
    expect(hidden.onCrowded).not.toHaveBeenCalled();
  });

  it("opens on a tab that still applies, and says which tab shows", () => {
    setWindowWidth(1440);
    const { result, onShow } = renderInspector(true);
    act(() => result.current.show("activity"));
    act(() => result.current.close());
    // No session any more: Activity is not offered, so it opens on Changes.
    act(() => result.current.toggle(["changes", "files", "terminal"]));
    expect(result.current.tab).toBe("changes");
    // The tab set is no longer offered: the button opens rather than closes it.
    act(() => result.current.show("terminal"));
    act(() => result.current.toggle(["changes", "files"]));
    expect(result.current.tab).toBe("changes");
    expect(onShow.mock.calls.map(([tab]) => tab)).toEqual(["activity", "changes", "terminal", "changes"]);
    act(() => result.current.close());
    act(() => result.current.toggle([]));
    expect(result.current.tab).toBeNull();
  });

  it("asks the sidebar to give way when a wider tab shows in a narrow window", () => {
    setWindowWidth(1280);
    const { result, onCrowded } = renderInspector(true);
    act(() => result.current.show("files"));
    expect(onCrowded).not.toHaveBeenCalled();
    // Terminal shows 560px wide: 1280 - 256 - 560 leaves the chat 464px.
    act(() => result.current.show("terminal"));
    expect(onCrowded).toHaveBeenCalledTimes(1);
  });

  it("checks the room when the button opens the inspector over a tab that no longer shows", () => {
    setWindowWidth(1440);
    const { result, rerender, onCrowded } = renderInspector(true);
    act(() => result.current.show("changes"));
    // Another folder, not a repository: Changes no longer shows, though it is still the tab.
    rerender({ folder: "/Users/test/notes", offered: ["files", "terminal"] });
    setWindowWidth(1100);
    act(() => result.current.toggle(["files", "terminal"]));
    expect(result.current.tab).toBe("files");
    expect(onCrowded).toHaveBeenCalledTimes(1);
  });

  it("shows the diff in the inspector's place, one or the other", () => {
    setWindowWidth(1440);
    const { result } = renderInspector(true);
    act(() => result.current.show("files"));
    act(() => result.current.openDiff());
    expect(result.current.isDiffOpen).toBe(true);
    expect(result.current.tab).toBeNull();
    act(() => result.current.toggle(ALL));
    expect(result.current.tab).toBe("files");
    expect(result.current.isDiffOpen).toBe(false);
  });

  it("opens the diff in the chat's place, and Shrink brings it beside the chat", () => {
    setWindowWidth(1440);
    const { result } = renderInspector(true);
    act(() => result.current.openDiff());
    expect(result.current.isDiffExpanded).toBe(true);
    act(() => result.current.toggleDiffExpanded());
    expect(result.current.isDiffExpanded).toBe(false);
  });

  it("expands the diff for the folder it was expanded in only", () => {
    setWindowWidth(1440);
    const { result, rerender } = renderInspector(true);
    act(() => result.current.openDiff());
    expect(result.current.isDiffExpanded).toBe(true);
    rerender({ folder: "/Users/test/other", offered: ALL });
    expect(result.current.isDiffOpen).toBe(true);
    expect(result.current.isDiffExpanded).toBe(false);
    rerender({ folder: "/Users/test/zorvo", offered: ALL });
    expect(result.current.isDiffExpanded).toBe(true);
  });

  it("remembers the width it is given, within bounds", () => {
    const { result } = renderInspector(true);
    expect(result.current.width).toBe(380);
    act(() => result.current.setWidth(1000));
    expect(result.current.width).toBe(720);
  });
});
