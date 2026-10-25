import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { fakeTauriInvoke } from "./setup";
import { AppUpdateNotice } from "../components/AppUpdateNotice";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, downloadPercent } from "../lib/app-update";

type Handler = (event: { payload: unknown }) => void;
const listeners = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: Handler) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  },
  emit: () => Promise.resolve(),
}));

const info = (version: string) => ({ version, notes: null, date: null });

type TauriInternals = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };

function mockBackend(handlers: Record<string, () => unknown>) {
  return vi.spyOn((window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__, "invoke").mockImplementation((cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    return handler ? Promise.resolve().then(handler) : fakeTauriInvoke(cmd, args);
  }) as unknown as ReturnType<typeof vi.fn>;
}

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => { vi.useFakeTimers(); listeners.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AppUpdateNotice", () => {
  const base = { isInstalling: false, progress: null, onInstall: () => {}, onLater: () => {} };

  it("names the version and offers Update & restart and Later", () => {
    const onInstall = vi.fn();
    const onLater = vi.fn();
    render(<AppUpdateNotice {...base} update={info("0.6.0")} onInstall={onInstall} onLater={onLater} />);
    expect(screen.getByRole("status")).toHaveTextContent("Zorvo 0.6.0 is available.");
    fireEvent.click(screen.getByRole("button", { name: "Update & restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without an update", () => {
    const { container } = render(<AppUpdateNotice {...base} update={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the percent while installing and disables the button", () => {
    render(
      <AppUpdateNotice {...base} update={info("0.6.0")} isInstalling progress={{ phase: "downloading", downloaded: 50, total: 200 }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Updating… 25%");
    expect(screen.getByRole("button", { name: "Update & restart" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
  });

  it("says only Updating… when the size is unknown", () => {
    render(<AppUpdateNotice {...base} update={info("0.6.0")} isInstalling progress={{ phase: "installing" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Updating…/);
    expect(screen.getByRole("status")).not.toHaveTextContent("%");
  });
});

describe("downloadPercent", () => {
  it("is null without a total and capped at 100", () => {
    expect(downloadPercent(null)).toBeNull();
    expect(downloadPercent({ phase: "downloading", downloaded: 5, total: null })).toBeNull();
    expect(downloadPercent({ phase: "downloading", downloaded: 300, total: 200 })).toBe(100);
  });
});

describe("useAppUpdate", () => {
  it("checks once after the startup delay, not before", async () => {
    const invoke = mockBackend({ app_update_check: () => info("0.6.0") });
    const { result } = renderHook(() => useAppUpdate(() => {}));
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS - 1); });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "app_update_check")).toHaveLength(0);
    expect(result.current.update).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(result.current.update?.version).toBe("0.6.0");
  });

  it("checks again about a day later", async () => {
    const invoke = mockBackend({ app_update_check: () => null });
    renderHook(() => useAppUpdate(() => {}));
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS); });
    await act(async () => { vi.advanceTimersByTime(CHECK_INTERVAL_MS); });
    const checks = invoke.mock.calls.filter(([cmd]) => cmd === "app_update_check");
    expect(checks).toHaveLength(2);
  });

  it("stays silent when a check fails", async () => {
    mockBackend({ app_update_check: () => { throw new Error("offline"); } });
    const onError = vi.fn();
    const { result } = renderHook(() => useAppUpdate(onError));
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS); });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.update).toBeNull();
  });

  it("hides a dismissed version but shows a newer one", async () => {
    let version = "0.6.0";
    mockBackend({ app_update_check: () => info(version) });
    const { result } = renderHook(() => useAppUpdate(() => {}));
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS); });
    await flush();
    act(() => result.current.dismiss());
    expect(result.current.update).toBeNull();
    await act(async () => { vi.advanceTimersByTime(CHECK_INTERVAL_MS); });
    await flush();
    expect(result.current.update).toBeNull();
    version = "0.7.0";
    await act(async () => { vi.advanceTimersByTime(CHECK_INTERVAL_MS); });
    await flush();
    expect(result.current.update?.version).toBe("0.7.0");
  });

  it("reports an install failure and lets the user try again", async () => {
    mockBackend({
      app_update_check: () => info("0.6.0"),
      app_update_install: () => { throw new Error("Could not install the update: bad signature"); },
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useAppUpdate(onError));
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS); });
    await flush();
    await act(async () => { await result.current.install(); });
    expect(onError).toHaveBeenCalledWith("Could not install the update: bad signature");
    expect(result.current.isInstalling).toBe(false);
    expect(result.current.update?.version).toBe("0.6.0");
  });

  it("follows progress events while installing and ignores a second click", async () => {
    let finish: () => void = () => {};
    const invoke = mockBackend({
      app_update_check: () => info("0.6.0"),
      app_update_install: () => new Promise<void>((resolve) => { finish = resolve; }),
    });
    const { result } = renderHook(() => useAppUpdate(() => {}));
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS); });
    await flush();
    act(() => { void result.current.install(); });
    act(() => { void result.current.install(); });
    expect(result.current.isInstalling).toBe(true);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "app_update_install")).toHaveLength(1);
    act(() => listeners.get("app-update-progress")?.({ payload: { phase: "downloading", downloaded: 1, total: 4 } }));
    expect(result.current.progress).toEqual({ phase: "downloading", downloaded: 1, total: 4 });
    await act(async () => { finish(); });
  });
});
