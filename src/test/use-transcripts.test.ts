import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { transcriptSaveInterval, useTranscripts } from "../hooks/useTranscripts";
import type { FakeTauriStore } from "./setup";
import type { ChatMessage } from "../types";

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

const saved: ChatMessage = { id: "m-old", role: "user", content: "from disk", timestamp: 1 };
const live: ChatMessage = { id: "m-new", role: "user", content: "typed now", timestamp: 2 };

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

describe("transcriptSaveInterval", () => {
  it("is a second for a small or unknown size, grows with the size, and stops at 30 seconds", () => {
    expect(transcriptSaveInterval(undefined)).toBe(1000);
    expect(transcriptSaveInterval(0)).toBe(1000);
    expect(transcriptSaveInterval(100 * 1024)).toBe(1000);
    expect(transcriptSaveInterval(1024 * 1024)).toBe(8000);
    expect(transcriptSaveInterval(7_749_636)).toBe(30_000);
    expect(transcriptSaveInterval(Number.NaN)).toBe(1000);
  });
});

describe("useTranscripts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never saves over a transcript it could not read", async () => {
    const real = tauriInternals().invoke;
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd, args) => (cmd === "load_transcript" ? Promise.reject("bad JSON") : real(cmd, args)));
    const onError = vi.fn();
    const { result } = renderHook(() => useTranscripts(onError));

    await act(async () => {
      result.current.ensureLoaded("s-1");
    });
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("will not be saved over it"));
    expect(spy.mock.calls.some(([cmd]) => cmd === "save_transcript")).toBe(false);
  });

  it("keeps the saved history when a message arrives before the transcript has loaded", async () => {
    // The save is throttled to once a second; fake time makes the test wait for it
    // exactly, not race a real second against waitFor's own one-second limit.
    vi.useFakeTimers();
    try {
      fakeStore().transcripts["s-1"] = [saved];
      const { result } = renderHook(() => useTranscripts(() => {}));

      act(() => {
        result.current.ensureLoaded("s-1");
        result.current.updateMessages("s-1", (prev) => [...prev, live]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.transcripts["s-1"]?.map((m) => m.id)).toEqual(["m-old", "m-new"]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect((fakeStore().transcripts["s-1"] as ChatMessage[]).map((m) => m.id)).toEqual(["m-old", "m-new"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a streaming transcript at most once a second, without waiting for the stream to stop", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(tauriInternals(), "invoke");
      const { result } = renderHook(() => useTranscripts(() => {}));
      const saves = () => spy.mock.calls.filter(([cmd]) => cmd === "save_transcript").length;

      // A chunk every 100ms for 2.5s, as an agent streams.
      for (let i = 0; i < 25; i++) {
        act(() => result.current.updateMessages("s-1", (prev) => [...prev, { ...live, id: `m-${i}` }]));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      }

      expect(saves()).toBeGreaterThanOrEqual(2);
      expect(saves()).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Answers every save_transcript with `bytes`, the size the backend reports it wrote. */
  function reportWrittenSize(bytes: number) {
    const real = tauriInternals().invoke;
    return vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd, args) => (cmd === "save_transcript" ? Promise.resolve(bytes) : real(cmd, args)));
  }

  /** Sends a chunk every `everyMs` for `forMs`, as an agent streams, and counts the saves. */
  async function streamAndCountSaves(
    result: { current: ReturnType<typeof useTranscripts> },
    spy: ReturnType<typeof reportWrittenSize>,
    forMs: number,
    everyMs: number,
  ): Promise<number> {
    for (let at = 0; at < forMs; at += everyMs) {
      act(() => result.current.updateMessages("s-1", (prev) => [...prev, { ...live, id: `m-${at}` }]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(everyMs);
      });
    }
    return spy.mock.calls.filter(([cmd]) => cmd === "save_transcript").length;
  }

  it("saves a large transcript less often, in step with its size", async () => {
    vi.useFakeTimers();
    try {
      // 1 MiB was written, so the next save waits 8 s instead of 1 s.
      const spy = reportWrittenSize(1024 * 1024);
      const { result } = renderHook(() => useTranscripts(() => {}));

      expect(await streamAndCountSaves(result, spy, 10_000, 100)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits at most 30 seconds between saves, however large the transcript", async () => {
    vi.useFakeTimers();
    try {
      const spy = reportWrittenSize(500 * 1024 * 1024);
      const { result } = renderHook(() => useTranscripts(() => {}));

      // Saves at 1 s (the size is not known yet), then 31 s and 61 s.
      expect(await streamAndCountSaves(result, spy, 62_000, 1000)).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes a pending transcript right away when the window goes away", () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = renderHook(() => useTranscripts(() => {}));

    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    window.dispatchEvent(new Event("pagehide"));

    expect(spy.mock.calls.some(([cmd]) => cmd === "save_transcript")).toBe(true);
  });
});


describe("useTranscripts flush", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Makes every save_transcript wait until the test settles it. */
  function controlSaves() {
    const real = tauriInternals().invoke;
    const saves: Array<{
      sessionId: unknown;
      messages: ChatMessage[];
      resolve: () => void;
      reject: (reason: unknown) => void;
    }> = [];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd !== "save_transcript") return real(cmd, args);
      return new Promise<void>((resolve, reject) =>
        saves.push({ sessionId: args?.sessionId, messages: args?.messages as ChatMessage[], resolve, reject }),
      );
    });
    return saves;
  }

  /** "pending" until the promise settles, looked at after the microtasks have run. */
  async function stateOf(promise: Promise<unknown>): Promise<"pending" | "resolved" | "rejected"> {
    let state: "pending" | "resolved" | "rejected" = "pending";
    promise.then(
      () => { state = "resolved"; },
      () => { state = "rejected"; },
    );
    await act(async () => {
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    });
    return state;
  }

  it("resolves only once every pending write is done", async () => {
    const saves = controlSaves();
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    act(() => result.current.updateMessages("s-2", (prev) => [...prev, live]));

    const flushing = result.current.flush();
    expect(saves.map((save) => save.sessionId)).toEqual(["s-1", "s-2"]);
    expect(await stateOf(flushing)).toBe("pending");
    saves[0].resolve();
    expect(await stateOf(flushing)).toBe("pending");
    saves[1].resolve();
    expect(await stateOf(flushing)).toBe("resolved");
  });

  it("rejects when a write fails, so a restart can be called off", async () => {
    const saves = controlSaves();
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));

    const flushing = result.current.flush();
    saves[0].reject("No space left on device");

    await expect(flushing).rejects.toThrow("No space left on device");
  });

  it("writes a transcript again at the next flush when its write failed", async () => {
    const saves = controlSaves();
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));

    const first = result.current.flush();
    saves[0].reject("No space left on device");
    await expect(first).rejects.toThrow("No space left on device");

    // Nothing was forgotten: the second flush writes it again, and only then does it succeed.
    const second = result.current.flush();
    expect(saves).toHaveLength(2);
    saves[1].resolve();
    await expect(second).resolves.toBeUndefined();

    await result.current.flush();
    expect(saves).toHaveLength(2);
  });

  it("also writes again what a timer could not write", async () => {
    vi.useFakeTimers();
    const saves = controlSaves();
    const onError = vi.fn();
    const { result } = renderHook(() => useTranscripts(onError));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    saves[0].reject("disk full");
    await stateOf(Promise.resolve());
    expect(onError).toHaveBeenCalledTimes(1);

    const flushing = result.current.flush();
    expect(saves).toHaveLength(2);
    saves[1].resolve();
    await expect(flushing).resolves.toBeUndefined();
  });

  it("keeps a failed write marked when an older write of the same transcript ends later", async () => {
    vi.useFakeTimers();
    const saves = controlSaves();
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saves).toHaveLength(1);
    // A newer message, written by a flush while the first write is still on its way.
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, { ...live, id: "m-later" }]));
    const flushing = result.current.flush();
    expect(saves).toHaveLength(2);

    // The newer write fails first and the older one ends afterwards (the pause lets the failure be noted).
    saves[1].reject("No space left on device");
    await stateOf(Promise.resolve());
    saves[0].resolve();
    await expect(flushing).rejects.toThrow("No space left on device");

    // The older write succeeded, but it does not hold the newer message: it is still to be written.
    const again = result.current.flush();
    expect(saves).toHaveLength(3);
    saves[2].resolve();
    await expect(again).resolves.toBeUndefined();
  });

  it("waits for a write its timer started a moment ago", async () => {
    vi.useFakeTimers();
    const saves = controlSaves();
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saves).toHaveLength(1);

    const flushing = result.current.flush();
    expect(saves).toHaveLength(1);
    expect(await stateOf(flushing)).toBe("pending");
    saves[0].resolve();
    expect(await stateOf(flushing)).toBe("resolved");
  });

  it("does not write over a transcript that is still loading, and says so", async () => {
    vi.useFakeTimers();
    const real = tauriInternals().invoke;
    let finishLoad: (messages: ChatMessage[]) => void = () => {};
    const saves: Array<{ sessionId: unknown; messages: ChatMessage[] }> = [];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "load_transcript") {
        return new Promise((resolve) => {
          finishLoad = resolve as (messages: ChatMessage[]) => void;
        });
      }
      if (cmd === "save_transcript") {
        saves.push({ sessionId: args?.sessionId, messages: args?.messages as ChatMessage[] });
        return Promise.resolve();
      }
      return real(cmd, args);
    });
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => {
      result.current.ensureLoaded("s-1");
      result.current.updateMessages("s-1", (prev) => [...prev, live]);
    });

    await expect(result.current.flush()).rejects.toThrow(/still loading/);
    expect(saves).toEqual([]);

    // Its normal save stays due: once the history is in, history and message are written together.
    // (Two steps: React renders the loaded history when the first act ends.)
    await act(async () => {
      finishLoad([saved]);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saves.map((save) => save.messages.map((m) => m.id))).toEqual([["m-old", "m-new"]]);
  });

  it("still saves a message that arrives after a flush", async () => {
    vi.useFakeTimers();
    const saves = controlSaves();
    const { result } = renderHook(() => useTranscripts(() => {}));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    const flushing = result.current.flush();
    saves[0].resolve();
    await flushing;

    act(() => result.current.updateMessages("s-1", (prev) => [...prev, { ...live, id: "m-later" }]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(saves).toHaveLength(2);
    expect(saves[1].messages.map((m) => m.id)).toEqual(["m-new", "m-later"]);
  });

  it("reports a failed write when the window goes away", async () => {
    const saves = controlSaves();
    const onError = vi.fn();
    const { result } = renderHook(() => useTranscripts(onError));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));

    window.dispatchEvent(new Event("pagehide"));
    saves[0].reject("disk full");
    await stateOf(Promise.resolve());

    expect(onError).toHaveBeenCalledWith("Failed to save the conversation: disk full");
  });

  it("reports a failed write that a timer started", async () => {
    vi.useFakeTimers();
    const saves = controlSaves();
    const onError = vi.fn();
    const { result } = renderHook(() => useTranscripts(onError));
    act(() => result.current.updateMessages("s-1", (prev) => [...prev, live]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    saves[0].reject("disk full");
    await stateOf(Promise.resolve());

    expect(onError).toHaveBeenCalledWith("Failed to save the conversation: disk full");
  });
});
