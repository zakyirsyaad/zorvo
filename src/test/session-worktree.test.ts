import { describe, it, expect, vi, afterEach } from "vitest";
import { attachmentsFor, createSessionWorktree } from "../lib/session-worktree";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

describe("createSessionWorktree", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the commit the worktree started from", async () => {
    const startCommit = "0123456789abcdef0123456789abcdef01234567";
    vi.spyOn(tauriInternals(), "invoke").mockResolvedValue({
      path: "/data/worktrees/app/fix",
      cwd: "/data/worktrees/app/fix/web",
      branch: "agent/fix",
      startCommit,
    });

    const { worktree, cwd } = await createSessionWorktree("/w/app", "fix");

    expect(worktree).toEqual({ repoPath: "/w/app", path: "/data/worktrees/app/fix", branch: "agent/fix", startCommit });
    expect(cwd).toBe("/data/worktrees/app/fix/web");
  });
});

describe("attachmentsFor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks the backend only when there are attachments", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockResolvedValue(["/wt/app/a.txt"]);

    expect(await attachmentsFor("/w/app", "/wt/app", undefined)).toBeUndefined();
    expect(await attachmentsFor("/w/app", "/wt/app", [])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();

    expect(await attachmentsFor("/w/app", "/wt/app", ["/w/app/a.txt"])).toEqual(["/wt/app/a.txt"]);
    expect(spy).toHaveBeenCalledWith(
      "worktree_attachment_paths",
      { repoPath: "/w/app", cwd: "/wt/app", paths: ["/w/app/a.txt"] },
      undefined,
    );
  });
});
