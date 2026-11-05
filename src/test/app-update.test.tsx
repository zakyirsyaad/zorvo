import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { fakeTauriInvoke } from "./setup";
import { AppUpdateNotice } from "../components/AppUpdateNotice";
import { useAppUpdate } from "../hooks/useAppUpdate";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  RETRY_AFTER_FAILURE_MS,
  downloadPercent,
  restartWarning,
} from "../lib/app-update";

type Handler = (event: { payload: unknown }) => void;
const listeners = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: Handler) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  },
  emit: () => Promise.resolve(),
}));

const info = (version: string) => ({ version });

type TauriInternals = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };

function mockBackend(handlers: Record<string, () => unknown>) {
  return vi.spyOn((window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__, "invoke").mockImplementation((cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    return handler ? Promise.resolve().then(handler) : fakeTauriInvoke(cmd, args);
  }) as unknown as ReturnType<typeof vi.fn>;
}

const callsOf = (invoke: ReturnType<typeof vi.fn>, command: string) =>
  invoke.mock.calls.filter(([cmd]) => cmd === command).length;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the promises a step started settle, so a check can schedule the next one. */
const flush = () => act(async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); });
/** Moves the fake clock and lets what each timer started settle before the next one fires. */
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const wroteEverything = async () => {};

function renderUpdate(beforeRestart: () => Promise<void> = wroteEverything) {
  const onError = vi.fn();
  const hook = renderHook(() => useAppUpdate(onError, beforeRestart));
  return { ...hook, onError };
}

beforeEach(() => { vi.useFakeTimers(); listeners.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AppUpdateNotice", () => {
  const base = { isInstalling: false, progress: null, onInstall: () => {}, onLater: () => {} };

  it("is a card that names the version and offers Later and Update & restart", () => {
    const onInstall = vi.fn();
    const onLater = vi.fn();
    render(<AppUpdateNotice {...base} update={info("0.9.0")} busyCount={1} onInstall={onInstall} onLater={onLater} />);

    const card = screen.getByRole("status");
    expect(card).toHaveClass("rounded-xl", "border", "border-border", "bg-surface-2", "shadow-popover");
    expect(card).toHaveTextContent("Zorvo 0.9.0 is ready");
    expect(card).toHaveTextContent("Agents that are working stop when Zorvo restarts.");
    expect(screen.getByRole("button", { name: "Later" }).className).toContain("border-transparent");
    expect(screen.getByRole("button", { name: "Update & restart" }).className).toContain("border-border-strong");
    fireEvent.click(screen.getByRole("button", { name: "Update & restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("reads Downloading… then Installing… during an install, with Later gone and the button off", () => {
    const { rerender } = render(
      <AppUpdateNotice {...base} update={info("0.9.0")} isInstalling progress={{ phase: "downloading", downloaded: 50, total: 200 }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Downloading… 25%");
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update & restart" })).toBeDisabled();

    rerender(<AppUpdateNotice {...base} update={info("0.9.0")} isInstalling progress={{ phase: "installing" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Installing…");
    expect(screen.getByRole("status")).not.toHaveTextContent("Downloading");
  });

  it("renders nothing without an update", () => {
    const { container } = render(<AppUpdateNotice {...base} update={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the percent while installing and disables the button", () => {
    render(
      <AppUpdateNotice {...base} update={info("0.6.0")} isInstalling progress={{ phase: "downloading", downloaded: 50, total: 200 }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Downloading… 25%");
    expect(screen.getByRole("button", { name: "Update & restart" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
  });

  it("does not announce every percent to a screen reader", () => {
    render(
      <AppUpdateNotice {...base} update={info("0.6.0")} isInstalling progress={{ phase: "downloading", downloaded: 50, total: 200 }} />,
    );
    expect(screen.getByText("25%")).toHaveAttribute("aria-hidden", "true");
  });

  it("says only the phase when the size is unknown", () => {
    render(<AppUpdateNotice {...base} update={info("0.6.0")} isInstalling progress={{ phase: "installing" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Installing…");
    expect(screen.getByRole("status")).not.toHaveTextContent("%");
  });

  it("warns about what a restart ends, and only then", () => {
    const { rerender } = render(<AppUpdateNotice {...base} update={info("0.6.0")} busyCount={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Agents that are working stop when Zorvo restarts.");
    rerender(<AppUpdateNotice {...base} update={info("0.6.0")} terminalCount={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Open terminals end when Zorvo restarts.");
    rerender(<AppUpdateNotice {...base} update={info("0.6.0")} busyCount={1} terminalCount={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("Agents that are working and open terminals end when Zorvo restarts.");
    rerender(<AppUpdateNotice {...base} update={info("0.6.0")} busyCount={0} terminalCount={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Zorvo 0.6.0 is ready");
    expect(screen.getByRole("status")).not.toHaveTextContent("when Zorvo restarts");
  });
});

describe("restartWarning", () => {
  it("is empty when nothing would be lost", () => {
    expect(restartWarning(0, 0)).toBe("");
  });

  it("names what a restart ends", () => {
    expect(restartWarning(1, 0)).toBe("Agents that are working stop when Zorvo restarts.");
    expect(restartWarning(0, 2)).toBe("Open terminals end when Zorvo restarts.");
    expect(restartWarning(3, 2)).toBe("Agents that are working and open terminals end when Zorvo restarts.");
  });
});

describe("downloadPercent", () => {
  it("is null without a total and capped at 100", () => {
    expect(downloadPercent(null)).toBeNull();
    expect(downloadPercent({ phase: "downloading", downloaded: 5, total: null })).toBeNull();
    expect(downloadPercent({ phase: "downloading", downloaded: 5, total: 0 })).toBeNull();
    expect(downloadPercent({ phase: "downloading", downloaded: 300, total: 200 })).toBe(100);
  });

  it("is exact, also where a float product would round down", () => {
    // (57 / 100) * 100 is 56.99999999999999.
    expect(downloadPercent({ phase: "downloading", downloaded: 57, total: 100 })).toBe(57);
    expect(downloadPercent({ phase: "downloading", downloaded: 29, total: 100 })).toBe(29);
    expect(downloadPercent({ phase: "downloading", downloaded: 0, total: 100 })).toBe(0);
  });
});

describe("useAppUpdate checks", () => {
  it("checks once after the startup delay, not before", async () => {
    const invoke = mockBackend({ app_update_check: () => info("0.6.0") });
    const { result } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS - 1);
    expect(callsOf(invoke, "app_update_check")).toBe(0);
    expect(result.current.update).toBeNull();
    await advance(1);
    expect(result.current.update?.version).toBe("0.6.0");
  });

  it("checks again about a day later", async () => {
    const invoke = mockBackend({ app_update_check: () => null });
    renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    expect(callsOf(invoke, "app_update_check")).toBe(1);
    await advance(CHECK_INTERVAL_MS - 1);
    expect(callsOf(invoke, "app_update_check")).toBe(1);
    await advance(1);
    expect(callsOf(invoke, "app_update_check")).toBe(2);
  });

  it("stays silent when a check fails and asks again soon, not a day later", async () => {
    let answer: () => unknown = () => { throw new Error("offline"); };
    const invoke = mockBackend({ app_update_check: () => answer() });
    const { result, onError } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.update).toBeNull();
    answer = () => info("0.6.0");
    await advance(RETRY_AFTER_FAILURE_MS - 1);
    expect(callsOf(invoke, "app_update_check")).toBe(1);
    await advance(1);
    expect(callsOf(invoke, "app_update_check")).toBe(2);
    expect(result.current.update?.version).toBe("0.6.0");
  });

  it("hides a dismissed version but shows a newer one", async () => {
    let version = "0.6.0";
    mockBackend({ app_update_check: () => info(version) });
    const { result } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    act(() => result.current.dismiss());
    expect(result.current.update).toBeNull();
    await advance(CHECK_INTERVAL_MS);
    expect(result.current.update).toBeNull();
    version = "0.7.0";
    await advance(CHECK_INTERVAL_MS);
    expect(result.current.update?.version).toBe("0.7.0");
  });

  it("stops its timers and its listener when unmounted", async () => {
    const invoke = mockBackend({ app_update_check: () => info("0.6.0") });
    const { unmount } = renderUpdate();
    expect(listeners.has("app-update-progress")).toBe(true);
    unmount();
    await flush();
    expect(listeners.has("app-update-progress")).toBe(false);
    await advance(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(callsOf(invoke, "app_update_check")).toBe(0);
  });

  it("does nothing more when a check answers after the hook is gone", async () => {
    const answer = deferred<ReturnType<typeof info>>();
    const invoke = mockBackend({ app_update_check: () => answer.promise });
    const { result, unmount } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    expect(callsOf(invoke, "app_update_check")).toBe(1);

    unmount();
    await act(async () => { answer.resolve(info("0.6.0")); });
    await flush();
    await advance(CHECK_INTERVAL_MS + RETRY_AFTER_FAILURE_MS);

    // No answer applied to a hook that is gone, and no next check scheduled by it.
    expect(result.current.update).toBeNull();
    expect(callsOf(invoke, "app_update_check")).toBe(1);
  });

  it("ignores a check that answers while an install runs", async () => {
    // The second check is still waiting when the user clicks; the release is withdrawn meanwhile.
    const secondCheck = deferred<null>();
    const install = deferred();
    let checks = 0;
    mockBackend({
      app_update_check: () => (checks++ === 0 ? info("0.6.0") : secondCheck.promise),
      app_update_install: () => install.promise,
    });
    const { result } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    await advance(CHECK_INTERVAL_MS);
    act(() => { void result.current.install(); });
    await flush();
    await act(async () => { secondCheck.resolve(null); });
    await flush();
    expect(result.current.update?.version).toBe("0.6.0");
    expect(result.current.isInstalling).toBe(true);
    // The install fails: the banner is still there to try again from.
    await act(async () => { install.reject("Could not install the update: bad signature"); });
    await flush();
    expect(result.current.isInstalling).toBe(false);
    expect(result.current.update?.version).toBe("0.6.0");
  });
});

describe("useAppUpdate install", () => {
  it("installs, writes what the page holds, then restarts", async () => {
    const order: string[] = [];
    mockBackend({
      app_update_check: () => info("0.6.0"),
      app_update_install: () => { order.push("install"); },
      app_update_restart: () => { order.push("restart"); },
    });
    const { result } = renderUpdate(async () => { order.push("write"); });
    await advance(FIRST_CHECK_DELAY_MS);
    await act(async () => { await result.current.install(); });
    expect(order).toEqual(["install", "write", "restart"]);
  });

  it("reports an install failure, keeps the update offered and installs again on the next click", async () => {
    let fails = true;
    const invoke = mockBackend({
      app_update_check: () => info("0.6.0"),
      // A rejected `invoke` carries a plain string, not an Error.
      app_update_install: () => (fails ? Promise.reject("Could not install the update: bad signature") : undefined),
      app_update_restart: () => undefined,
    });
    const { result, onError } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    await act(async () => { await result.current.install(); });
    expect(onError).toHaveBeenCalledWith("Could not install the update: bad signature");
    expect(result.current.isInstalling).toBe(false);
    expect(result.current.update?.version).toBe("0.6.0");
    expect(callsOf(invoke, "app_update_restart")).toBe(0);

    fails = false;
    await act(async () => { await result.current.install(); });
    expect(callsOf(invoke, "app_update_install")).toBe(2);
    expect(callsOf(invoke, "app_update_restart")).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stays open when the page cannot write what it holds, and restarts on the next click", async () => {
    let canWrite = false;
    const invoke = mockBackend({
      app_update_check: () => info("0.6.0"),
      app_update_install: () => undefined,
      app_update_restart: () => undefined,
    });
    const { result, onError } = renderUpdate(() => (canWrite ? Promise.resolve() : Promise.reject("disk full")));
    await advance(FIRST_CHECK_DELAY_MS);
    await act(async () => { await result.current.install(); });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("could not be saved");
    expect(onError.mock.calls[0][0]).toContain("disk full");
    expect(callsOf(invoke, "app_update_restart")).toBe(0);
    expect(result.current.isInstalling).toBe(false);

    canWrite = true;
    await act(async () => { await result.current.install(); });
    expect(callsOf(invoke, "app_update_restart")).toBe(1);
  });

  it("follows progress events while installing and ignores a second click", async () => {
    const install = deferred();
    const invoke = mockBackend({
      app_update_check: () => info("0.6.0"),
      app_update_install: () => install.promise,
      app_update_restart: () => undefined,
    });
    const { result } = renderUpdate();
    await advance(FIRST_CHECK_DELAY_MS);
    act(() => { void result.current.install(); });
    act(() => { void result.current.install(); });
    await flush();
    expect(result.current.isInstalling).toBe(true);
    expect(callsOf(invoke, "app_update_install")).toBe(1);
    act(() => listeners.get("app-update-progress")?.({ payload: { phase: "downloading", downloaded: 1, total: 4 } }));
    expect(result.current.progress).toEqual({ phase: "downloading", downloaded: 1, total: 4 });
    await act(async () => { install.resolve(); });
    await flush();
    expect(callsOf(invoke, "app_update_restart")).toBe(1);
    expect(result.current.isInstalling).toBe(false);
  });
});
