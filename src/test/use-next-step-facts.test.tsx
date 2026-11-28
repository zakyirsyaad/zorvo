import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useNextStepFacts } from "../hooks/useNextStepFacts";
import { fakeTauriInvoke } from "./setup";
import type { BackgroundTask } from "../lib/background-tasks";
import type { PullRequestStatus } from "../hooks/usePullRequest";
import type { Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const SESSION: Session = { id: "s-1", name: "Status words", profileId: "claude-acp", cwd: "/Users/test/developer/zorvo", status: "running", createdAt: 1, transport: "acp" };
const STATS = [
  { path: "a.ts", oldPath: null, kind: "modified", added: 40, removed: 10, isBinary: false, version: "1" },
  { path: "b.ts", oldPath: null, kind: "modified", added: 2, removed: 1, isBinary: false, version: "1" },
];
const BRANCH = { branch: "feat/status-words", upstream: "origin/feat/status-words", ahead: 1, isDefaultBranch: false };
const PR: PullRequestStatus = { branch: "feat/status-words", number: 325, title: "t", url: "https://github.com/o/r/pull/325", state: "open", isDraft: false, checks: { passing: 9, failing: 0, pending: 0 }, mergeState: "CLEAN" };
const shell = (ports: number[], sessionId = "s-1"): BackgroundTask => ({ id: `process:${ports[0]}`, kind: "shell", name: "pnpm dev", status: "Running", startedAt: 1, sessionId, pid: 9, ports });

let spy: { mock: { calls: unknown[][] }; mockClear: () => void; mockImplementation: (fn: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) => void };
function answer(branch: () => Promise<unknown> = () => Promise.resolve(BRANCH)) {
  spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "session_diff_stats") return Promise.resolve(STATS);
    if (cmd === "session_branch_state") return branch();
    return fakeTauriInvoke(cmd, args);
  });
}
const calls = (cmd: string) => spy.mock.calls.filter((call: unknown[]) => call[0] === cmd);

beforeEach(() => answer());

describe("useNextStepFacts", () => {
  it("puts together the changes, the branch, the pull request and a dev server", async () => {
    const { result } = renderHook(() => useNextStepFacts({ session: SESSION, isActive: true, pullRequest: PR, tasks: [shell([5173, 3000]), shell([4000], "s-2")] }));
    await waitFor(() => expect(result.current.branch).toBe("feat/status-words"));
    expect(result.current).toEqual({
      changes: { files: 2, added: 42, removed: 11 },
      branch: "feat/status-words",
      ahead: 1,
      hasUpstream: true,
      isDefaultBranch: false,
      pr: { number: 325, url: "https://github.com/o/r/pull/325", state: "open", checks: { passing: 9, failing: 0, pending: 0 }, mergeState: "CLEAN" },
      preview: { port: 3000, command: "pnpm dev" },
    });
    expect(calls("session_diff_stats")[0][1]).toEqual({ path: SESSION.cwd, target: "head" });
    expect(calls("session_branch_state")[0][1]).toEqual({ cwd: SESSION.cwd });
  });

  it("leaves out what could not be read and keeps the rest", async () => {
    answer(() => Promise.reject("not a git repository"));
    const { result } = renderHook(() => useNextStepFacts({ session: SESSION, isActive: true, pullRequest: null, tasks: [] }));
    await waitFor(() => expect(result.current.changes).toEqual({ files: 2, added: 42, removed: 11 }));
    expect(result.current.branch).toBeUndefined();
    expect(result.current.ahead).toBeUndefined();
    expect(result.current.pr).toBeUndefined();
  });

  it("reads nothing while the box is not active", async () => {
    const { result } = renderHook(() => useNextStepFacts({ session: SESSION, isActive: false, pullRequest: PR, tasks: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls("session_diff_stats")).toHaveLength(0);
    expect(calls("session_branch_state")).toHaveLength(0);
    expect(result.current).toEqual({});
  });

  it("reads again when the window comes back into focus", async () => {
    renderHook(() => useNextStepFacts({ session: SESSION, isActive: true, pullRequest: null, tasks: [] }));
    await waitFor(() => expect(calls("session_branch_state")).toHaveLength(1));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(calls("session_branch_state")).toHaveLength(2));
  });
});
