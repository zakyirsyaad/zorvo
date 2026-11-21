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

  it("clears its timers on unmount", () => {
    const { stop, unmount } = render({ sessions: [worker()] });
    unmount();
    vi.advanceTimersByTime(600_000);
    expect(stop).not.toHaveBeenCalled();
  });
});
