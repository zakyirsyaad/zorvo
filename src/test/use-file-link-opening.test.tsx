import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFileLinkOpening } from "../hooks/useFileLinkOpening";
import { requestFileLinkOpen } from "../lib/file-links";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

describe("useFileLinkOpening", () => {
  it("opens a file inside the folder in the viewer and asks the backend nothing", () => {
    const spy = vi.spyOn(internals(), "invoke");
    const viewFile = vi.fn();
    renderHook(() => useFileLinkOpening({ folder: "/w/project", viewFile, onError: vi.fn() }));

    requestFileLinkOpen("src/App.tsx");

    expect(viewFile).toHaveBeenCalledWith("src/App.tsx");
    expect(spy.mock.calls.some(([cmd]) => cmd === "reveal_file_in_finder")).toBe(false);
  });

  it("shows a file outside the folder in the file manager", () => {
    const spy = vi.spyOn(internals(), "invoke");
    const viewFile = vi.fn();
    renderHook(() => useFileLinkOpening({ folder: "/w/project", viewFile, onError: vi.fn() }));

    requestFileLinkOpen("/Users/me/.codex/hooks.json");

    expect(viewFile).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("reveal_file_in_finder", { path: "/Users/me/.codex/hooks.json" }, undefined);
  });

  it("says so when the backend cannot show the file, and when a relative path has no folder", async () => {
    const original = internals().invoke;
    vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "reveal_file_in_finder" ? Promise.reject("That file could not be found.") : original(cmd, args),
    );
    const onError = vi.fn();
    const { rerender } = renderHook(({ folder }: { folder?: string }) => useFileLinkOpening({ folder, viewFile: vi.fn(), onError }), {
      initialProps: { folder: "/w/project" as string | undefined },
    });

    requestFileLinkOpen("/gone/a.md");
    await waitFor(() => expect(onError).toHaveBeenCalledWith("That file could not be found."));

    rerender({ folder: undefined });
    requestFileLinkOpen("src/App.tsx");
    expect(onError).toHaveBeenLastCalledWith("Open a session to open that file.");
  });

  it("stops listening when it unmounts", () => {
    const viewFile = vi.fn();
    const { unmount } = renderHook(() => useFileLinkOpening({ folder: "/w/project", viewFile, onError: vi.fn() }));
    unmount();
    requestFileLinkOpen("src/App.tsx");
    expect(viewFile).not.toHaveBeenCalled();
  });
});
