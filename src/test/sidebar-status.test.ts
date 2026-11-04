import { describe, it, expect } from "vitest";
import { folderSummary, rowSubtitle, runSummary, sessionsIn, statusOf } from "../lib/sidebar-status";
import { groupSessionsByWorkspace } from "../lib/session-helpers";
import { compareRuns } from "../lib/compare-run";
import type { Session } from "../types";

const NOW = 1_000_000_000;
const FOLDER = "/Users/test/zorvo";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    profileId: "claude-acp",
    cwd: FOLDER,
    status: "terminated",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  };
}

const among = (ids: string[]) => (id: string) => ids.includes(id);
const none = () => false;

describe("statusOf", () => {
  it("names a status in words, waiting before working before unread", () => {
    expect(statusOf(true, true, true)?.label).toBe("Waiting for you");
    expect(statusOf(false, true, true)).toEqual({ tone: "running", label: "Working", pulse: true });
    expect(statusOf(false, false, true)?.label).toBe("Finished, unread");
    expect(statusOf(false, false, false)).toBeNull();
  });
});

describe("rowSubtitle", () => {
  it("puts the agent and the status on the second line", () => {
    expect(rowSubtitle("Claude Code", statusOf(false, true, false), 0)).toBe("Claude Code · Working");
    expect(rowSubtitle("Codex", null, NOW - 2 * 3_600_000, NOW)).toBe("Codex · 2 hours ago");
    expect(rowSubtitle(undefined, null, NOW, NOW)).toBe("Just now");
  });
});

describe("folderSummary", () => {
  const sessions = [session("a"), session("b"), session("c")];

  it("summarises a folded folder, waiting first", () => {
    expect(folderSummary(sessions, among(["a"]), among(["b", "c"]))).toEqual({ text: "1 waiting", tone: "attention" });
    expect(folderSummary(sessions, none, among(["b", "c"]))).toEqual({ text: "2 working", tone: "muted" });
    expect(folderSummary([session("a")], none, none)).toEqual({ text: "1 session", tone: "muted" });
    expect(folderSummary(sessions, none, none)).toEqual({ text: "3 sessions", tone: "muted" });
  });

  it("counts forks and a run's members in a folded folder", () => {
    const all = [
      session("root", { createdAt: 1 }),
      session("fork", { createdAt: 2, forkedFrom: "root" }),
      session("r1", { createdAt: 3, compareRunId: "run" }),
      session("r2", { createdAt: 4, compareRunId: "run" }),
    ];
    const [group] = groupSessionsByWorkspace([{ name: "zorvo", path: FOLDER }], all, compareRuns(all));
    expect(folderSummary(sessionsIn(group.sessions), none, none).text).toBe("4 sessions");
  });
});

describe("runSummary", () => {
  it("summarises a compare run", () => {
    const run = [session("a"), session("b"), session("c")];
    expect(runSummary(run, none, among(["a", "b"]))).toBe("2 working, 1 finished");
    expect(runSummary(run.slice(0, 2), among(["a"]), among(["b"]))).toBe("1 waiting, 1 working");
  });
});
