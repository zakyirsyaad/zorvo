import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDiffStats, useDiffStatsSince, useDiffTargets, useTargetStats } from "../hooks/useDiffStats";
import type { FileStat } from "../lib/diff-stats";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const STAT: FileStat = { path: "a.ts", oldPath: null, kind: "modified", added: 1, removed: 0, isBinary: false, fingerprint: "f1" };

function statCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((call) => call[0] === "session_diff_stats");
}

describe("useDiffStats", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the stats against the target", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd) => Promise.resolve(cmd === "session_diff_stats" ? [STAT] : undefined));
    const { result } = renderHook(() => useDiffStats("/w", true, "head", 1, () => {}));

    await waitFor(() => expect(result.current.stats).toEqual([STAT]));
    expect(spy).toHaveBeenCalledWith("session_diff_stats", { path: "/w", target: "head" }, undefined);
  });

  it("reads again when the version or the target changes", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd) => Promise.resolve(cmd === "session_diff_stats" ? [STAT] : undefined));
    const { result, rerender } = renderHook(
      ({ target, version }) => useDiffStats("/w", true, target, version, () => {}),
      { initialProps: { target: "head" as "head" | "base", version: 1 } },
    );
    await waitFor(() => expect(result.current.stats).not.toBeNull());
    expect(statCalls(spy)).toHaveLength(1);

    rerender({ target: "head", version: 2 });
    await waitFor(() => expect(statCalls(spy)).toHaveLength(2));
    rerender({ target: "base", version: 2 });
    await waitFor(() => expect(statCalls(spy)).toHaveLength(3));
    expect(statCalls(spy)[2][1]).toEqual({ path: "/w", target: "base" });
  });

  it("reports a failed read once per folder, naming it", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockRejectedValue("boom");
    const onError = vi.fn();
    const { rerender } = renderHook(({ version }) => useDiffStats("/w", true, "head", version, onError), {
      initialProps: { version: 1 },
    });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toContain("/w");

    rerender({ version: 2 });
    await act(async () => {});
    expect(onError).toHaveBeenCalledOnce();
  });

  it("says a read failed until one works", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockRejectedValueOnce("boom");
    const { result } = renderHook(() => useDiffStats("/w", true, "head", 1, () => {}));
    await waitFor(() => expect(result.current.hasFailed).toBe(true));
    expect(result.current.stats).toBeNull();

    spy.mockResolvedValue([STAT]);
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.stats).toEqual([STAT]));
    expect(result.current.hasFailed).toBe(false);
  });

  it("reads as loading, not failed, back on a target once another read worked", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockRejectedValueOnce("boom");
    const { result, rerender } = renderHook(({ target }) => useDiffStats("/w", true, target, 1, () => {}), {
      initialProps: { target: "head" as "head" | "base" },
    });
    await waitFor(() => expect(result.current.hasFailed).toBe(true));
    spy.mockResolvedValue([STAT]);
    rerender({ target: "base" });
    await waitFor(() => expect(result.current.stats).toEqual([STAT]));

    spy.mockImplementation(() => new Promise(() => {}));
    rerender({ target: "head" });

    expect(result.current.stats).toBeNull();
    expect(result.current.hasFailed).toBe(false);
  });

  it("does not call another target's failure this one's", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockRejectedValueOnce("boom");
    const { result, rerender } = renderHook(({ target }) => useDiffStats("/w", true, target, 1, () => {}), {
      initialProps: { target: "head" as "head" | "base" },
    });
    await waitFor(() => expect(result.current.hasFailed).toBe(true));

    spy.mockImplementation(() => new Promise(() => {}));
    rerender({ target: "base" });

    expect(result.current.hasFailed).toBe(false);
  });

  it("reads nothing outside a repository", () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = renderHook(() => useDiffStats("/w", false, "head", 1, () => {}));

    expect(result.current.stats).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("useDiffStatsSince", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads session_diff_stats_since with the commit", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd) => Promise.resolve(cmd === "session_diff_stats_since" ? [STAT] : undefined));
    const { result } = renderHook(() => useDiffStatsSince("/w", COMMIT, 1, () => {}));

    await waitFor(() => expect(result.current.stats).toEqual([STAT]));
    expect(spy).toHaveBeenCalledWith("session_diff_stats_since", { path: "/w", commit: COMMIT }, undefined);
  });

  it("reads nothing without a commit", () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = renderHook(() => useDiffStatsSince("/w", undefined, 1, () => {}));

    expect(result.current.stats).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a failure once per folder", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockRejectedValue("boom");
    const onError = vi.fn();
    const { rerender } = renderHook(({ version }) => useDiffStatsSince("/w", COMMIT, version, onError), {
      initialProps: { version: 1 },
    });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toContain("/w");

    rerender({ version: 2 });
    await act(async () => {});
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("useDiffTargets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("has no base and is not loaded until read", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockResolvedValue({ base: { name: "main" } });
    const { result } = renderHook(() => useDiffTargets("/w", true, 1, () => {}));

    expect(result.current).toMatchObject({ targets: { base: null, root: "", prefix: "" }, isLoaded: false, hasFailed: false });
    await waitFor(() => expect(result.current).toMatchObject({ targets: { base: { name: "main" } }, isLoaded: true, hasFailed: false }));
  });

  it("settles without a base and reports once when the read fails", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockRejectedValue("boom");
    const onError = vi.fn();
    const { result, rerender } = renderHook(({ version }) => useDiffTargets("/w", true, version, onError), {
      initialProps: { version: 1 },
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.targets).toEqual({ base: null, root: "", prefix: "" });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain("/w");

    rerender({ version: 2 });
    await act(async () => {});
    expect(onError).toHaveBeenCalledOnce();
  });

  it("says a read failed, and reload reads again without a new version", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockRejectedValueOnce("boom");
    const { result } = renderHook(() => useDiffTargets("/w", true, 1, () => {}));
    await waitFor(() => expect(result.current.hasFailed).toBe(true));

    spy.mockResolvedValue({ base: null, root: "/w", prefix: "" });
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.targets.root).toBe("/w"));
    expect(result.current.hasFailed).toBe(false);
  });
});

describe("useTargetStats", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the stats since the start commit for the start target", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd) => Promise.resolve(cmd === "session_diff_stats_since" ? [STAT] : undefined));
    const { result } = renderHook(() => useTargetStats("/w", true, "start", "abc123", 1, () => {}));

    await waitFor(() => expect(result.current.stats).toEqual([STAT]));
    expect(spy).toHaveBeenCalledWith("session_diff_stats_since", { path: "/w", commit: "abc123" }, undefined);
    expect(statCalls(spy)).toHaveLength(0);
  });

  it("reads against the target as useDiffStats does for HEAD and the base", async () => {
    const spy = vi
      .spyOn(tauriInternals(), "invoke")
      .mockImplementation((cmd) => Promise.resolve(cmd === "session_diff_stats" ? [STAT] : undefined));
    const { result } = renderHook(() => useTargetStats("/w", true, "base", "abc123", 1, () => {}));

    await waitFor(() => expect(result.current.stats).toEqual([STAT]));
    expect(spy).toHaveBeenCalledWith("session_diff_stats", { path: "/w", target: "base" }, undefined);
  });

  it("reads nothing for the start without a commit, or while disabled", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockResolvedValue([STAT]);
    const { result } = renderHook(() => useTargetStats("/w", true, "start", undefined, 1, () => {}));
    renderHook(() => useTargetStats("/w", false, "head", undefined, 1, () => {}));
    await act(async () => {});

    expect(result.current.stats).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("tells onFailed about every failed read but onError only once per folder", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockRejectedValue("boom");
    const onError = vi.fn();
    const onFailed = vi.fn();
    const { rerender } = renderHook(
      ({ version }) => useTargetStats("/w", true, "start", "abc123", version, onError, onFailed),
      { initialProps: { version: 1 } },
    );
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());

    rerender({ version: 2 });
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(2));
    expect(onError).toHaveBeenCalledOnce();
  });
});
