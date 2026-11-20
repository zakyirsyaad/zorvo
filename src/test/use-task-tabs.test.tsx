import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTaskTabs, type TaskTab } from "../hooks/useTaskTabs";
import { minInspectorWidth, offeredTabs, shownInspectorWidth, INSPECTOR_WIDTH } from "../lib/inspector";

const sub = (toolId: string): TaskTab => ({ kind: "subagent", toolId });
const shell = (taskId: string): TaskTab => ({ kind: "shell", taskId });

function setup(initial: { sessionId: string | null; gone?: string[] } = { sessionId: "s1" }) {
  return renderHook(
    ({ sessionId, gone = [] }: { sessionId: string | null; gone?: string[] }) =>
      useTaskTabs({ sessionId, exists: (tab) => !gone.includes(tab.kind === "subagent" ? tab.toolId : tab.taskId) }),
    { initialProps: initial },
  );
}

describe("useTaskTabs", () => {
  it("opens a task as the selected tab", () => {
    const { result } = setup();

    act(() => result.current.open("s1", sub("a")));

    expect(result.current.tabs).toEqual([sub("a")]);
    expect(result.current.selected).toEqual(sub("a"));
  });

  it("keeps one tab when the same task is opened twice, and selects it", () => {
    const { result } = setup();

    act(() => result.current.open("s1", sub("a")));
    act(() => result.current.open("s1", shell("process:7")));
    act(() => result.current.open("s1", sub("a")));

    expect(result.current.tabs).toEqual([sub("a"), shell("process:7")]);
    expect(result.current.selected).toEqual(sub("a"));
  });

  it("selects the neighbour when the selected tab closes", () => {
    const { result } = setup();
    act(() => result.current.open("s1", sub("a")));
    act(() => result.current.open("s1", sub("b")));
    act(() => result.current.open("s1", sub("c")));

    act(() => result.current.close(sub("c")));
    expect(result.current.selected).toEqual(sub("b"));
    act(() => result.current.select(sub("a")));
    act(() => result.current.close(sub("a")));
    expect(result.current.selected).toEqual(sub("b"));
  });

  it("leaves no tabs after the last one closes", () => {
    const { result } = setup();
    act(() => result.current.open("s1", sub("a")));

    act(() => result.current.close(sub("a")));

    expect(result.current.tabs).toEqual([]);
    expect(result.current.selected).toBeNull();
  });

  it("keeps tabs per session", () => {
    const { result, rerender } = setup();
    act(() => result.current.open("s1", sub("a")));

    rerender({ sessionId: "s2" });
    expect(result.current.tabs).toEqual([]);
    act(() => result.current.open("s2", sub("z")));
    rerender({ sessionId: "s1" });

    expect(result.current.tabs).toEqual([sub("a")]);
  });

  it("closes a tab whose task is gone, and the last one leaves none", () => {
    const { result, rerender } = setup();
    act(() => result.current.open("s1", sub("a")));
    act(() => result.current.open("s1", sub("b")));

    rerender({ sessionId: "s1", gone: ["b"] });
    expect(result.current.tabs).toEqual([sub("a")]);
    expect(result.current.selected).toEqual(sub("a"));
    rerender({ sessionId: "s1", gone: ["a", "b"] });

    expect(result.current.tabs).toEqual([]);
    expect(result.current.selected).toBeNull();
  });

  it("has no tabs without a session", () => {
    expect(setup({ sessionId: null }).result.current.tabs).toEqual([]);
  });
});

describe("the Tasks inspector tab", () => {
  const on = { hasFolder: true, isRepository: true, hasSession: true };

  it("is offered before Terminal only while a task tab is open", () => {
    expect(offeredTabs(on)).not.toContain("tasks");
    expect(offeredTabs({ ...on, hasTaskTabs: true })).toEqual(["changes", "activity", "files", "artifacts", "browser", "tasks", "terminal"]);
    expect(offeredTabs({ hasFolder: false, isRepository: false, hasSession: true, hasTaskTabs: true })).toEqual(["activity", "artifacts", "browser", "tasks"]);
    expect(offeredTabs({ ...on, hasSession: false, hasTaskTabs: true })).not.toContain("tasks");
  });

  it("is wide, like Terminal", () => {
    expect(minInspectorWidth("tasks")).toBe(INSPECTOR_WIDTH.wide);
    expect(shownInspectorWidth("tasks", INSPECTOR_WIDTH.initial)).toBe(INSPECTOR_WIDTH.wide);
  });
});
