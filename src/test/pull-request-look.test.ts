import { describe, expect, it } from "vitest";
import type { PullRequestStatus } from "../hooks/usePullRequest";
import {
  LOOK_STYLE,
  newestSessionInFolder,
  pullRequestChecksSummary,
  pullRequestLabel,
  pullRequestLine,
  pullRequestLook,
  pullRequestOfWork,
  pullRequestsOfWork,
  pullRequestOnBranch,
  pullRequestStateWord,
  sessionBranchOf,
  sessionPullRequestOf,
  type FolderPullRequests,
} from "../lib/pull-request-look";
import type { Session } from "../types";

function pr(overrides: Partial<PullRequestStatus> = {}): PullRequestStatus {
  return {
    branch: "feat/row",
    number: 250,
    title: "Redesign the session row",
    url: "https://github.com/o/r/pull/250",
    state: "open",
    isDraft: false,
    checks: { passing: 0, failing: 0, pending: 0 },
    ...overrides,
  };
}

describe("pullRequestLook", () => {
  it("reads each state as the artboard draws it", () => {
    expect(pullRequestLook(pr())).toBe("open");
    expect(pullRequestLook(pr({ isDraft: true }))).toBe("draft");
    expect(pullRequestLook(pr({ checks: { passing: 3, failing: 2, pending: 0 } }))).toBe("failing");
    expect(pullRequestLook(pr({ state: "merged", checks: { passing: 0, failing: 1, pending: 0 } }))).toBe("merged");
    expect(pullRequestLook(pr({ state: "closed", isDraft: true }))).toBe("closed");
  });

  it("colours open green, failing red, merged with its token, draft and closed quietly", () => {
    expect(LOOK_STYLE).toEqual({
      open: "text-status-running",
      failing: "text-danger",
      merged: "text-status-merged",
      draft: "text-fg-subtle",
      closed: "text-fg-subtle",
    });
  });
});

describe("what the row says", () => {
  it("names the number and the state for a screen reader", () => {
    expect(pullRequestLabel(pr())).toBe("Pull request 250, open");
    expect(pullRequestLabel(pr({ number: 244, checks: { passing: 3, failing: 2, pending: 0 } }))).toBe(
      "Pull request 244, open, checks failing",
    );
    expect(pullRequestLabel(pr({ state: "merged" }))).toBe("Pull request 250, merged");
  });

  it("puts the state and the checks in one line", () => {
    expect(pullRequestLine(pr({ checks: { passing: 3, failing: 2, pending: 0 } }))).toBe("Open · 2 of 5 checks failing");
    expect(pullRequestLine(pr({ checks: { passing: 1, failing: 0, pending: 2 } }))).toBe("Open · 2 of 3 checks running");
    expect(pullRequestLine(pr({ checks: { passing: 4, failing: 0, pending: 0 } }))).toBe("Open · checks passing");
    expect(pullRequestLine(pr({ isDraft: true }))).toBe("Draft");
    expect(pullRequestLine(pr({ state: "merged", checks: { passing: 4, failing: 0, pending: 0 } }))).toBe("Merged");
  });

  it("summarizes open PR checks with a semantic tone and compact counts", () => {
    expect(pullRequestStateWord(pr({ isDraft: true }))).toBe("Draft");
    expect(pullRequestStateWord(pr())).toBe("Open");
    expect(pullRequestChecksSummary(pr({ checks: { passing: 8, failing: 1, pending: 0 } }))).toEqual({
      tone: "failing",
      label: "1/9 failed",
    });
    expect(pullRequestChecksSummary(pr({ checks: { passing: 6, failing: 0, pending: 2 } }))).toEqual({
      tone: "running",
      label: "2/8 running",
    });
    expect(pullRequestChecksSummary(pr({ checks: { passing: 9, failing: 0, pending: 0 } }))).toEqual({
      tone: "passing",
      label: "9/9 passed",
    });
    expect(pullRequestChecksSummary(pr({ state: "merged", checks: { passing: 9, failing: 0, pending: 0 } }))).toBeNull();
    expect(pullRequestChecksSummary(pr())).toBeNull();
  });
});

describe("which pull request a session shows", () => {
  const session = (id: string, overrides: Partial<Session> = {}): Session => ({
    id,
    name: id,
    profileId: "qwen",
    cwd: "/w/zorvo",
    status: "idle",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  });
  const folder: FolderPullRequests = { branch: "fix/main-checkout", pullRequests: [pr({ branch: "fix/main-checkout", number: 9 }), pr()] };

  it("matches a worktree session by its own branch", () => {
    const inWorktree = session("w", { worktree: { repoPath: "/w/zorvo", path: "/data/wt/row", branch: "feat/row" } });
    expect(pullRequestOnBranch(folder, sessionBranchOf(inWorktree, folder, newestSessionInFolder([inWorktree])))?.number).toBe(250);
  });

  it("gives the folder's checked-out branch only to the newest session there", () => {
    const older = session("old", { createdAt: 1 });
    const newer = session("new", { createdAt: 2 });
    const archivedNewest = session("archived", { createdAt: 3, archivedAt: 4 });
    const newest = newestSessionInFolder([older, newer, archivedNewest]);
    expect(sessionBranchOf(newer, folder, newest)).toBe("fix/main-checkout");
    expect(sessionBranchOf(older, folder, newest)).toBeNull();
    expect(pullRequestOnBranch(folder, sessionBranchOf(older, folder, newest))).toBeNull();
  });

  it("has no pull request for a branch gh did not list", () => {
    expect(pullRequestOnBranch(folder, "feat/unknown")).toBeNull();
  });

  it("shows the pull request a session's agent made from a worktree of its own", () => {
    const listed: FolderPullRequests = {
      branch: "main",
      pullRequests: [pr({ branch: "fix/notice", number: 259, url: "https://github.com/O/R/pull/259" }), pr({ branch: "fix/drip", number: 257 })],
    };
    const byUrl = session("a", { agentWork: { branches: [], pullRequestUrls: ["https://github.com/o/r/pull/259"] } });
    const byBranch = session("b", { agentWork: { branches: ["fix/drip", "fix/unlisted"], pullRequestUrls: [] } });
    expect(pullRequestOfWork(listed, byUrl.agentWork)?.number).toBe(259);
    expect(pullRequestOfWork(listed, byBranch.agentWork)?.number).toBe(257);
    expect(pullRequestOfWork(listed, undefined)).toBeNull();
    const newest = newestSessionInFolder([byUrl, byBranch]);
    expect(sessionPullRequestOf(byUrl, listed, newest)?.number).toBe(259);
    expect(sessionPullRequestOf(byBranch, listed, newest)?.number).toBe(257);
  });

  it("lists every pull request the agent made, newest first and each once", () => {
    const listed: FolderPullRequests = {
      branch: "feat/ibkr-flex-pipeline",
      pullRequests: [
        pr({ branch: "feat/ibkr-flex-pipeline", number: 273, url: "https://github.com/O/R/pull/273" }),
        pr({ branch: "feat/ibkr-flex-xml-parser", number: 272, url: "https://github.com/O/R/pull/272" }),
        pr({ branch: "fix/other", number: 271 }),
      ],
    };
    const work = {
      branches: ["feat/ibkr-flex-xml-parser", "feat/ibkr-flex-pipeline", "fix/unlisted"],
      pullRequestUrls: ["https://github.com/O/R/pull/272"],
    };
    expect(pullRequestsOfWork(listed, work).map((found) => found.number)).toEqual([273, 272]);
    expect(pullRequestOfWork(listed, work)?.number).toBe(273);
    expect(pullRequestsOfWork(listed, undefined)).toEqual([]);
  });

  it("prefers a worktree session's own branch, and falls back to the folder's branch", () => {
    const inWorktree = session("w", {
      worktree: { repoPath: "/w/zorvo", path: "/data/wt/row", branch: "feat/row" },
      agentWork: { branches: ["fix/main-checkout"], pullRequestUrls: [] },
    });
    const plain = session("p", { createdAt: 5 });
    const newest = newestSessionInFolder([inWorktree, plain]);
    expect(sessionPullRequestOf(inWorktree, folder, newest)?.number).toBe(250);
    expect(sessionPullRequestOf(plain, folder, newest)?.number).toBe(9);
  });
});
