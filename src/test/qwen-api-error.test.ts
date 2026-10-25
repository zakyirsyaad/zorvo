import { describe, it, expect, vi, afterEach } from "vitest";
import { qwenErrorDetail } from "../lib/qwen-api-error";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

describe("qwenErrorDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the turn's last error as status and message", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockResolvedValue({ statusCode: 429, message: "Quota exhausted." });

    await expect(qwenErrorDetail("s-1", 1_000)).resolves.toBe("429 Quota exhausted.");
  });

  it("does not look without the turn's start, so an older turn's error is never shown as this one's", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");

    await expect(qwenErrorDetail("s-1", undefined)).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("gives nothing when the log cannot be read", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockRejectedValue(new Error("no log"));

    await expect(qwenErrorDetail("s-1", 1_000)).resolves.toBeUndefined();
  });
});
