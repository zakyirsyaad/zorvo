import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOpenedSessions, type OpenRequest } from "../hooks/useOpenedSessions";
import { NO_CHOICES } from "../lib/acp-draft";
import type { SessionSpec, StartSessionOptions } from "../lib/session-start";
import type { FirstMessage } from "../hooks/session-engine/useAcpEngine";
import type { Session } from "../types";
import { makeProfile } from "./fixtures/agents";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const PI = makeProfile({ id: "pi-acp", name: "pi ACP", detected: true });
const CODEX = makeProfile({ id: "codex-acp", name: "Codex", detected: true });
const FOLDER = "/Users/test/developer/zorvo";

const OPENER: Session = {
  id: "s-a",
  name: "Parser work",
  profileId: "pi-acp",
  cwd: FOLDER,
  status: "running",
  createdAt: 1,
  transport: "acp",
  worktree: null,
};

interface Start {
  spec: SessionSpec;
  first?: FirstMessage;
  options?: StartSessionOptions;
}

const WORKTREE = { path: "/data/worktrees/port", cwd: "/data/worktrees/port", branch: "agent/port", startCommit: "abc123" };

function setup(input: { sessions?: Session[]; busy?: string[]; worktreeFails?: boolean } = {}) {
  const starts: Start[] = [];
  const busy = new Set(input.busy ?? []);
  const real = internals().invoke.bind(internals());
  const spy = vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd !== "create_session_worktree") return real(cmd, args);
    return input.worktreeFails
      ? Promise.reject(new Error("fatal: not a git repository: /Users/test/secret"))
      : Promise.resolve(WORKTREE);
  });
  const hook = renderHook(
    (props: { sessions: Session[] }) =>
      useOpenedSessions({
        sessions: props.sessions,
        agents: [PI, CODEX],
        isBusy: (sessionId) => busy.has(sessionId),
        startSession: (spec, first, options) => {
          starts.push({ spec, first, options });
        },
      }),
    { initialProps: { sessions: input.sessions ?? [OPENER] } },
  );
  return { ...hook, starts, busy, spy };
}

const REQUEST: OpenRequest = { agentId: "codex-acp", brief: "Port the parser.\nKeep the tests.", hasOwnWorktree: false };

afterEach(() => vi.restoreAllMocks());

describe("useOpenedSessions", () => {
  it("opens a session in the opener's folder with the brief as its first message, without selecting it", async () => {
    const t = setup();
    let result: unknown;
    await act(async () => {
      result = await t.result.current.open("s-a", REQUEST);
    });

    expect(t.starts).toHaveLength(1);
    const [{ spec, first, options }] = t.starts;
    expect(spec).toMatchObject({ cwd: FOLDER, worktree: null, name: "Codex: Port the parser." });
    expect(spec.agent.id).toBe("codex-acp");
    expect(first).toEqual({ text: "Port the parser.\nKeep the tests." });
    expect(options).toEqual({ choices: NO_CHOICES, focus: false });
    expect(result).toEqual({
      ok: true,
      sessionId: spec.id,
      sessionName: "Codex: Port the parser.",
      folder: FOLDER,
      handle: "session-1",
    });
  });

  it("records who opened it, and the session is no delegate", async () => {
    const t = setup();
    await act(async () => {
      await t.result.current.open("s-a", { ...REQUEST, title: "Parser port" });
    });
    const [{ spec, first }] = t.starts;
    expect(spec.openedBy).toEqual({ sessionId: "s-a", at: expect.any(Number), handle: "session-1" });
    expect(spec.delegatedFrom).toBeUndefined();
    expect(first?.context).toBeUndefined();
    expect(spec.name).toBe("Parser port");
  });

  it("keeps the opener's worktree when it works in one", async () => {
    const worktree = { repoPath: FOLDER, path: "/data/worktrees/a", branch: "agent/a", startCommit: "111" };
    const t = setup({ sessions: [{ ...OPENER, cwd: "/data/worktrees/a", worktree }] });
    await act(async () => {
      await t.result.current.open("s-a", REQUEST);
    });
    expect(t.starts[0].spec).toMatchObject({ cwd: "/data/worktrees/a", worktree });
  });

  it("opens it in a worktree of its own when asked, from the opener's repository", async () => {
    const own = { repoPath: FOLDER, path: "/data/worktrees/a", branch: "agent/a", startCommit: "111" };
    const t = setup({ sessions: [{ ...OPENER, cwd: "/data/worktrees/a", worktree: own }] });
    await act(async () => {
      await t.result.current.open("s-a", { ...REQUEST, hasOwnWorktree: true });
    });

    const made = t.spy.mock.calls.filter(([cmd]) => cmd === "create_session_worktree");
    // The base is the repository the opener's own worktree came from, never a path the agent gave.
    expect(made.map(([, args]) => args)).toEqual([{ repoPath: FOLDER, title: "Codex: Port the parser." }]);
    expect(t.starts[0].spec).toMatchObject({
      cwd: WORKTREE.cwd,
      worktree: { repoPath: FOLDER, path: WORKTREE.path, branch: WORKTREE.branch, startCommit: WORKTREE.startCommit },
    });
  });

  it("opens it in another folder, with no worktree unless asked", async () => {
    const t = setup();
    let result: unknown;
    await act(async () => {
      result = await t.result.current.open("s-a", { ...REQUEST, folderPath: "/Users/test/developer/titan" });
    });
    expect(t.starts[0].spec).toMatchObject({ cwd: "/Users/test/developer/titan", worktree: null });
    expect(result).toMatchObject({ ok: true, folder: "/Users/test/developer/titan" });

    await act(async () => {
      await t.result.current.open("s-a", { ...REQUEST, folderPath: "/Users/test/developer/titan", hasOwnWorktree: true });
    });
    const made = t.spy.mock.calls.filter(([cmd]) => cmd === "create_session_worktree");
    expect(made[0][1]).toMatchObject({ repoPath: "/Users/test/developer/titan" });
  });

  it("opens no session when the worktree cannot be made, and keeps the cause from the caller", async () => {
    const t = setup({ worktreeFails: true });
    let result: unknown;
    await act(async () => {
      result = await t.result.current.open("s-a", { ...REQUEST, hasOwnWorktree: true });
    });

    expect(t.starts).toHaveLength(0);
    expect(result).toEqual({
      ok: false,
      reason: "A worktree could not be made there. Open the session without one, or in a repository.",
      isInternal: true,
      detail: "Error: fatal: not a git repository: /Users/test/secret",
    });
  });

  it("refuses an opener or an agent it does not know", async () => {
    const t = setup();
    let gone: unknown;
    let unknown: unknown;
    await act(async () => {
      gone = await t.result.current.open("s-gone", REQUEST);
      unknown = await t.result.current.open("s-a", { ...REQUEST, agentId: "nobody" });
    });
    expect(gone).toEqual({ ok: false, reason: "This session no longer exists." });
    expect(unknown).toEqual({ ok: false, reason: "The agent is not available." });
    expect(t.starts).toHaveLength(0);
  });

  it("opens three of four requests made in the same tick", async () => {
    const t = setup();
    let results: Array<{ ok: boolean; reason?: string }> = [];
    await act(async () => {
      results = (await Promise.all([1, 2, 3, 4].map(() => t.result.current.open("s-a", REQUEST)))) as typeof results;
    });
    expect(t.starts).toHaveLength(3);
    expect(results.map((result) => result.ok)).toEqual([true, true, true, false]);
    expect(results[3].reason).toBe("Three sessions this session opened are still working. Wait for one to finish.");
  });

  it("counts only the opener's sessions that are in a turn", async () => {
    const opened = (id: string): Session => ({ ...OPENER, id, profileId: "codex-acp", openedBy: { sessionId: "s-a", at: 2 } });
    const others: Session = { ...OPENER, id: "s-z", openedBy: { sessionId: "s-other", at: 2 } };
    const t = setup({ sessions: [OPENER, opened("o-1"), opened("o-2"), opened("o-3"), others], busy: ["o-1", "o-2", "s-z"] });
    let result: { ok: boolean } = { ok: false };
    await act(async () => {
      result = (await t.result.current.open("s-a", REQUEST)) as typeof result;
    });
    // Two of its three sessions still work: there is room for one more.
    expect(result.ok).toBe(true);

    t.busy.add("o-3");
    let refused: { ok: boolean } = { ok: true };
    await act(async () => {
      refused = (await t.result.current.open("s-a", REQUEST)) as typeof refused;
    });
    expect(refused.ok).toBe(false);
  });

  it("frees its place when an open failed", async () => {
    const t = setup({ worktreeFails: true });
    await act(async () => {
      await Promise.all([1, 2, 3].map(() => t.result.current.open("s-a", { ...REQUEST, hasOwnWorktree: true })));
    });
    let after: { ok: boolean } = { ok: false };
    await act(async () => {
      after = (await t.result.current.open("s-a", REQUEST)) as typeof after;
    });
    expect(after.ok).toBe(true);
  });

  it("frees its place and says it failed when the session cannot be started", async () => {
    const starts: number[] = [];
    let shouldThrow = true;
    const hook = renderHook(() =>
      useOpenedSessions({
        sessions: [OPENER],
        agents: [PI, CODEX],
        isBusy: () => false,
        startSession: () => {
          if (shouldThrow) throw new Error("state could not be written to /Users/test/secret");
          starts.push(1);
        },
      }),
    );

    let failed: unknown[] = [];
    await act(async () => {
      failed = await Promise.all([1, 2, 3].map(() => hook.result.current.open("s-a", REQUEST)));
    });
    expect(failed[0]).toEqual({
      ok: false,
      reason: "The session could not be started.",
      isInternal: true,
      detail: "Error: state could not be written to /Users/test/secret",
    });

    // Three failures must not use up the opener's three places.
    shouldThrow = false;
    let after: { ok: boolean } = { ok: false };
    await act(async () => {
      after = (await hook.result.current.open("s-a", REQUEST)) as typeof after;
    });
    expect(after.ok).toBe(true);
    expect(starts).toHaveLength(1);
  });

  it("frees a place once the opened session is listed and idle", async () => {
    const t = setup();
    await act(async () => {
      await Promise.all([1, 2, 3].map(() => t.result.current.open("s-a", REQUEST)));
    });
    // The three sessions are now listed, and none is in a turn.
    const listed = t.starts.map(({ spec }) => ({
      ...OPENER,
      id: spec.id ?? "",
      profileId: "codex-acp",
      openedBy: spec.openedBy,
    }));
    t.rerender({ sessions: [OPENER, ...listed] });
    let next: { ok: boolean } = { ok: false };
    await act(async () => {
      next = (await t.result.current.open("s-a", REQUEST)) as typeof next;
    });
    expect(next.ok).toBe(true);
  });

  it("gives each session it opens a handle of its own, also in the same tick", async () => {
    const existing: Session = { ...OPENER, id: "o-0", profileId: "codex-acp", openedBy: { sessionId: "s-a", at: 2, handle: "session-4" } };
    const t = setup({ sessions: [OPENER, existing] });
    let results: Array<{ ok: boolean; handle?: string }> = [];
    await act(async () => {
      results = (await Promise.all([1, 2].map(() => t.result.current.open("s-a", REQUEST)))) as typeof results;
    });

    expect(results.map((result) => result.handle)).toEqual(["session-5", "session-6"]);
    expect(t.starts.map(({ spec }) => spec.openedBy?.handle)).toEqual(["session-5", "session-6"]);
    expect(t.result.current.openedOf("s-a")[0]).toMatchObject({ handle: "session-4" });
  });

  it("lists the opener's sessions with their state and folder", () => {
    const opened: Session = {
      ...OPENER,
      id: "o-1",
      name: "Parser port",
      profileId: "codex-acp",
      cwd: "/Users/test/developer/titan",
      createdAt: 5,
      openedBy: { sessionId: "s-a", at: 5 },
    };
    const t = setup({ sessions: [OPENER, opened], busy: ["o-1"] });
    expect(t.result.current.openedOf("s-a")).toEqual([
      { agent: "Codex", title: "Parser port", state: "working", folder: "/Users/test/developer/titan" },
    ]);
    expect(t.result.current.openedOf("s-z")).toEqual([]);
  });
});
