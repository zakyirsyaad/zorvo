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

describe("createSessionWorktree queue", () => {
  afterEach(() => vi.restoreAllMocks());

  const made = (title: string) => ({ path: `/w/${title}`, cwd: `/w/${title}`, branch: `agent/${title}`, startCommit: "abc" });
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

  it("makes two worktrees of one repository one after another", async () => {
    const order: string[] = [];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation(async (_cmd, args) => {
      const title = String(args?.title);
      order.push(`start ${title}`);
      await pause();
      order.push(`end ${title}`);
      return made(title);
    });

    await Promise.all([createSessionWorktree("/repo-order", "a"), createSessionWorktree("/repo-order", "b")]);

    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("does not let a failed worktree hold up the next, and gives the caller its own error", async () => {
    const failure = new Error("locked");
    vi.spyOn(tauriInternals(), "invoke").mockImplementation(async (_cmd, args) => {
      if (args?.title === "a") throw failure;
      return made("b");
    });

    const [first, second] = await Promise.allSettled([
      createSessionWorktree("/repo-fail", "a"),
      createSessionWorktree("/repo-fail", "b"),
    ]);

    expect(first).toEqual({ status: "rejected", reason: failure });
    expect(second.status).toBe("fulfilled");
  });

  it("does not make two repositories wait for each other", async () => {
    const order: string[] = [];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation(async (_cmd, args) => {
      const title = String(args?.title);
      order.push(`start ${title}`);
      await pause();
      order.push(`end ${title}`);
      return made(title);
    });

    await Promise.all([createSessionWorktree("/repo-one", "a"), createSessionWorktree("/repo-two", "b")]);

    expect(order.slice(0, 2)).toEqual(["start a", "start b"]);
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
