import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAgentTasks, type AgentTasksInput } from "../hooks/useAgentTasks";
import type { ChatMessage, ToolExecution } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const agentTool = (id: string): ToolExecution => ({ id, name: "Agent", status: "completed", providerToolName: "agent" }) as ToolExecution;
const transcript = (...ids: string[]): ChatMessage[] => [
  { id: "m", role: "agent", content: "", timestamp: 1, isComplete: true, tools: ids.map(agentTool) } as ChatMessage,
];

const task = (status: string, id = "a1") => ({ id, label: id, description: "", status, isBackground: true, activities: [] });
const answer = (...tasks: ReturnType<typeof task>[]) => ({ tasks, more: 0 });

const input = (over: Partial<AgentTasksInput> = {}): AgentTasksInput => ({
  sessionId: "s-1",
  agentId: "qwen-code",
  isRunning: true,
  messages: transcript("c1"),
  turnKey: 0,
  ...over,
});

const asks = () => invokeMock.mock.calls.filter(([command]) => command === "acp_agent_tasks");
const flush = () => act(async () => {});
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useAgentTasks", () => {
  it("asks once when a session that launched an agent comes on screen, and gives the answer", async () => {
    invokeMock.mockResolvedValue(answer(task("done")));
    const { result } = renderHook(() => useAgentTasks(input()));
    await flush();

    expect(asks()).toEqual([["acp_agent_tasks", { sessionId: "s-1" }]]);
    expect(result.current?.tasks[0].id).toBe("a1");
    await tick(60_000);
    expect(asks()).toHaveLength(1);
  });

  it("never asks a session that launched no agent, another agent's, or one that ended", async () => {
    invokeMock.mockResolvedValue(answer());
    renderHook(() => useAgentTasks(input({ messages: [] })));
    renderHook(() => useAgentTasks(input({ agentId: "claude-acp" })));
    renderHook(() => useAgentTasks(input({ isRunning: false })));
    renderHook(() => useAgentTasks(input({ sessionId: null })));
    await flush();
    await tick(60_000);
    expect(asks()).toHaveLength(0);
  });

  it("asks again when the number of launched agents changes and at each turn end", async () => {
    invokeMock.mockResolvedValue(answer(task("done")));
    const { rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    rerender(input({ messages: transcript("c1", "c2") }));
    await flush();
    expect(asks()).toHaveLength(2);
    rerender(input({ messages: transcript("c1", "c2"), turnKey: 1 }));
    await flush();
    expect(asks()).toHaveLength(3);
  });

  it("polls every 10 seconds while a task works and stops when none does", async () => {
    invokeMock
      .mockResolvedValueOnce(answer(task("working")))
      .mockResolvedValueOnce(answer(task("working")))
      .mockResolvedValue(answer(task("done")));
    renderHook(() => useAgentTasks(input()));
    await flush();
    expect(asks()).toHaveLength(1);
    await tick(9_999);
    expect(asks()).toHaveLength(1);
    await tick(1);
    expect(asks()).toHaveLength(2);
    await tick(10_000);
    expect(asks()).toHaveLength(3);
    await tick(60_000);
    expect(asks()).toHaveLength(3);
  });

  it("starts no interval for a list that holds only stopped and finished tasks", async () => {
    invokeMock.mockResolvedValue(answer(task("stopped", "p"), task("done", "d")));
    renderHook(() => useAgentTasks(input()));
    await flush();
    await tick(60_000);
    expect(asks()).toHaveLength(1);
  });

  it("stops polling when the session stops running in the middle of a poll", async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    invokeMock.mockResolvedValueOnce(answer(task("working")));
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const { rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    await tick(10_000);
    expect(asks()).toHaveLength(2);
    rerender(input({ isRunning: false }));
    await act(async () => resolveSecond(answer(task("working"))));
    await tick(60_000);
    expect(asks()).toHaveLength(2);
  });

  it("counts an answer it cannot read as a failure: three stop the asking", async () => {
    invokeMock.mockResolvedValue({ nope: true });
    renderHook(() => useAgentTasks(input()));
    await flush();
    await tick(10_000);
    await tick(10_000);
    await tick(60_000);
    expect(asks()).toHaveLength(3);
  });

  it("gives nothing once a rewind took the agent call away", async () => {
    invokeMock.mockResolvedValue(answer(task("done")));
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    expect(result.current).not.toBeNull();
    rerender(input({ messages: [] }));
    expect(result.current).toBeNull();
  });

  it("drops the last run's answer when the agent process is a new one", async () => {
    invokeMock.mockResolvedValueOnce(answer(task("working", "old")));
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input({ acpSessionId: "acp-1" }) });
    await flush();
    expect(result.current?.tasks[0].id).toBe("old");
    rerender(input({ acpSessionId: "acp-1", isRunning: false }));
    rerender(input({ acpSessionId: "acp-1" }));
    expect(result.current).toBeNull();
  });

  it("drops the answer when the session's acpSessionId changes", async () => {
    invokeMock.mockResolvedValueOnce(answer(task("done", "old")));
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input({ acpSessionId: "acp-1" }) });
    await flush();
    expect(result.current).not.toBeNull();
    rerender(input({ acpSessionId: "acp-2" }));
    expect(result.current).toBeNull();
  });

  it("keeps the last answer through a failed read and stops after three in a row", async () => {
    invokeMock.mockResolvedValueOnce(answer(task("working"))).mockRejectedValue("no");
    const { result } = renderHook(() => useAgentTasks(input()));
    await flush();
    await tick(10_000);
    await tick(10_000);
    await tick(10_000);
    expect(asks()).toHaveLength(4);
    expect(result.current?.tasks[0].status).toBe("working");
    await tick(60_000);
    expect(asks()).toHaveLength(4);
  });

  it("asks again after the failures when a turn ends", async () => {
    invokeMock.mockRejectedValue("no");
    const { rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    await tick(10_000);
    await tick(10_000);
    await tick(60_000);
    expect(asks()).toHaveLength(3);
    rerender(input({ turnKey: 1 }));
    await flush();
    expect(asks()).toHaveLength(4);
  });

  it("treats an answer it cannot read as a failed read", async () => {
    invokeMock.mockResolvedValueOnce(answer(task("done"))).mockResolvedValue({ nope: true });
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    rerender(input({ turnKey: 1 }));
    await flush();
    expect(result.current?.tasks[0].status).toBe("done");
  });

  it("drops an answer that arrives after the session left the screen", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    invokeMock.mockResolvedValue(answer(task("done", "from-s-2")));
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    rerender(input({ sessionId: "s-2" }));
    await flush();
    await act(async () => resolveFirst(answer(task("working", "from-s-1"))));
    expect(result.current?.tasks.map((t) => t.id)).toEqual(["from-s-2"]);
  });

  it("gives nothing once the session has ended", async () => {
    invokeMock.mockResolvedValue(answer(task("working")));
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    expect(result.current).not.toBeNull();
    rerender(input({ isRunning: false }));
    expect(result.current).toBeNull();
  });

  it("gives nothing for a session whose answer has not come yet", async () => {
    invokeMock.mockResolvedValueOnce(answer(task("done"))).mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook((props: AgentTasksInput) => useAgentTasks(props), { initialProps: input() });
    await flush();
    rerender(input({ sessionId: "s-2" }));
    expect(result.current).toBeNull();
  });

  it("starts one poll under StrictMode and none after unmount", async () => {
    invokeMock.mockResolvedValue(answer(task("working")));
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { unmount } = renderHook(() => useAgentTasks(input()), { wrapper });
    await flush();
    const first = asks().length;
    await tick(10_000);
    // One chain: one more ask per interval, not two.
    expect(asks().length - first).toBe(1);
    unmount();
    await tick(60_000);
    expect(asks().length - first).toBe(1);
  });
});
