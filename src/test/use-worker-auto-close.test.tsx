import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWorkerAutoClose } from "../hooks/useWorkerAutoClose";
import type { Session } from "../types";

function worker(overrides: Partial<Session> = {}, lastTurn: { endedAt: number; how: "finished" | "failed" | "cancelled" | "exited" } = { endedAt: 1_000, how: "finished" }): Session {
  return {
    id: "w1",
    name: "Codex: task",
    profileId: "codex-acp",
    cwd: "/w",
    status: "running",
    createdAt: 1,
    transport: "acp",
    worktree: null,
    delegatedFrom: { sessionId: "s-a", task: "Fix", startedAt: 5, endedAt: null, handle: "worker-1", lastTurn },
    ...overrides,
  };
}

interface Props {
  sessions: readonly Session[];
  busy?: boolean;
  waiting?: boolean;
  canReopen?: boolean;
  now?: number;
  turnUnderWay?: boolean;
  sending?: boolean;
  liveTasks?: boolean;
  failedTurn?: boolean;
  stop?: (id: string) => Promise<boolean>;
}

function render(initial: Props) {
  const stop = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true);
  const hook = renderHook(
    (props: Props) =>
      useWorkerAutoClose({
        sessions: props.sessions,
        isBusy: () => props.busy === true,
        isWaiting: () => props.waiting === true,
        canReopen: () => props.canReopen !== false,
        isTurnUnderWay: () => props.turnUnderWay === true,
        isSendingTo: () => props.sending === true,
        hasLiveTasks: () => props.liveTasks === true,
        hasFailedTurn: () => props.failedTurn === true,
        stop: props.stop ?? stop,
        now: () => props.now ?? 1_000,
      }),
    { initialProps: initial, wrapper: StrictMode },
  );
  return { ...hook, stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useWorkerAutoClose", () => {
  it("a worker's agent is stopped two minutes after its turn ended", () => {
    const { stop } = render({ sessions: [worker()] });
    vi.advanceTimersByTime(119_999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledWith("w1");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("a new turn before the two minutes cancels the stop", () => {
    const { stop, rerender } = render({ sessions: [worker()] });
    vi.advanceTimersByTime(60_000);
    rerender({ sessions: [worker()], busy: true });
    vi.advanceTimersByTime(120_000);
    expect(stop).not.toHaveBeenCalled();
  });

  it("a turn that ended long ago closes at once", () => {
    const { stop } = render({ sessions: [worker()], now: 500_000 });
    vi.advanceTimersByTime(0);
    expect(stop).toHaveBeenCalledWith("w1");
  });

  it("each turn end gets its own timer and a stop is not repeated", () => {
    const { stop, rerender } = render({ sessions: [worker()] });
    vi.advanceTimersByTime(120_000);
    rerender({ sessions: [worker()] });
    vi.advanceTimersByTime(240_000);
    expect(stop).toHaveBeenCalledTimes(1);
    rerender({ sessions: [worker({}, { endedAt: 400_000, how: "finished" })], now: 400_000 });
    vi.advanceTimersByTime(120_000);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Partial<Props>]>([
    ["an agent that cannot be reopened", { canReopen: false }],
    ["a worker that waits on the user", { waiting: true }],
    ["a worker whose link has ended", { sessions: [worker({ delegatedFrom: { sessionId: "s-a", task: "x", startedAt: 5, endedAt: 9, lastTurn: { endedAt: 1_000, how: "finished" } } })] }],
    ["a session that already ended", { sessions: [worker({ status: "terminated" })] }],
    ["an archived worker", { sessions: [worker({ archivedAt: 5 })] }],
    ["a worker that has not finished a turn", { sessions: [worker({ delegatedFrom: { sessionId: "s-a", task: "x", startedAt: 5, endedAt: null } })] }],
  ])("%s is left alone", (_name, overrides) => {
    const { stop } = render({ sessions: [worker()], ...overrides });
    vi.advanceTimersByTime(600_000);
    expect(stop).not.toHaveBeenCalled();
  });

  it("a stop that fails raises nothing and is not retried", async () => {
    const stop = vi.fn<(id: string) => Promise<boolean>>().mockRejectedValue(new Error("boom"));
    const { rerender } = render({ sessions: [worker()], stop });
    await vi.advanceTimersByTimeAsync(120_000);
    rerender({ sessions: [worker()], stop });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the timer fires under a turn the engine already knows of", () => {
    const { stop, rerender } = render({ sessions: [worker()] });
    vi.advanceTimersByTime(60_000);
    // The prompt is out, but React has not rendered busy: the engine's ref knows.
    rerender({ sessions: [worker()], turnUnderWay: true });
    vi.advanceTimersByTime(120_000);
    expect(stop).not.toHaveBeenCalled();
  });

  it("does nothing when the timer fires while a task is being sent to the worker", () => {
    const { stop, rerender } = render({ sessions: [worker()] });
    rerender({ sessions: [worker()], sending: true });
    vi.advanceTimersByTime(120_000);
    expect(stop).not.toHaveBeenCalled();
  });

  it("leaves a worker with a live background task alone and closes it when the task ends", () => {
    const { stop, rerender } = render({ sessions: [worker()], liveTasks: true });
    vi.advanceTimersByTime(600_000);
    expect(stop).not.toHaveBeenCalled();
    // More than two minutes have passed: it closes at once.
    rerender({ sessions: [worker()], liveTasks: false, now: 700_000 });
    vi.advanceTimersByTime(0);
    expect(stop).toHaveBeenCalledWith("w1");
  });

  it("checks again after another two minutes when a fire was skipped, and stops once", () => {
    const { stop, rerender } = render({ sessions: [worker()], sending: true });
    vi.advanceTimersByTime(120_000);
    expect(stop).not.toHaveBeenCalled();
    // The prompt was refused: nothing is sending, and no new turn end will come.
    rerender({ sessions: [worker()], sending: false });
    vi.advanceTimersByTime(119_999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps checking while the fire keeps being skipped", () => {
    const { stop, rerender } = render({ sessions: [worker()], turnUnderWay: true });
    vi.advanceTimersByTime(360_000);
    expect(stop).not.toHaveBeenCalled();
    rerender({ sessions: [worker()], turnUnderWay: false });
    vi.advanceTimersByTime(120_000);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("leaves a worker alone whose background task started after the timer was set", () => {
    const { stop, rerender } = render({ sessions: [worker()] });
    vi.advanceTimersByTime(60_000);
    rerender({ sessions: [worker()], liveTasks: true });
    vi.advanceTimersByTime(600_000);
    expect(stop).not.toHaveBeenCalled();
  });

  it("leaves a worker with a failed turn's banner alone until it clears", () => {
    const { stop, rerender } = render({ sessions: [worker()], failedTurn: true });
    vi.advanceTimersByTime(600_000);
    expect(stop).not.toHaveBeenCalled();
    rerender({ sessions: [worker()], failedTurn: false, now: 700_000 });
    vi.advanceTimersByTime(0);
    expect(stop).toHaveBeenCalledWith("w1");
  });

  it("counts the two minutes from the delivered report", () => {
    const reported = worker({
      delegatedFrom: { sessionId: "s-a", task: "Fix", startedAt: 5, endedAt: null, handle: "worker-1", lastTurn: { endedAt: 1_000, how: "finished" }, reportedAt: 61_000 },
    });
    const { stop } = render({ sessions: [reported], now: 61_000 });
    vi.advanceTimersByTime(119_999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("counts from the turn end while the report is still owed", () => {
    const { stop } = render({ sessions: [worker()], now: 61_000 });
    vi.advanceTimersByTime(59_999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("re-arms when the report is delivered after the turn end", () => {
    const { stop, rerender } = render({ sessions: [worker()], now: 1_000 });
    vi.advanceTimersByTime(60_000);
    const reported = worker({
      delegatedFrom: { sessionId: "s-a", task: "Fix", startedAt: 5, endedAt: null, handle: "worker-1", lastTurn: { endedAt: 1_000, how: "finished" }, reportedAt: 61_000 },
    });
    rerender({ sessions: [reported], now: 61_000 });
    vi.advanceTimersByTime(60_000);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("clears its timers on unmount", () => {
    const { stop, unmount } = render({ sessions: [worker()] });
    unmount();
    vi.advanceTimersByTime(600_000);
    expect(stop).not.toHaveBeenCalled();
  });
});
