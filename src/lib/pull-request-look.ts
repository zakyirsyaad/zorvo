import type { PullRequestStatus } from '../hooks/usePullRequest';
import type { AgentWork, Session } from '../types';
import { isArchived, workspacePathOf } from './session-helpers';

/** How a pull request reads at a glance: its state, with failing checks standing out on an open one. */
export type PullRequestLook = 'open' | 'draft' | 'failing' | 'merged' | 'closed';

/** Merged and closed say what happened; a draft is not up for review; an open one is failing when any check fails. */
export function pullRequestLook({ state, isDraft, checks }: PullRequestStatus): PullRequestLook {
  if (state === 'merged') return 'merged';
  if (state === 'closed') return 'closed';
  if (isDraft) return 'draft';
  return checks.failing > 0 ? 'failing' : 'open';
}

/** The colour of each look: green open, quiet draft and closed, red failing checks, the merged token. */
export const LOOK_STYLE: Record<PullRequestLook, string> = {
  open: 'text-status-running',
  draft: 'text-fg-subtle',
  closed: 'text-fg-subtle',
  failing: 'text-danger',
  merged: 'text-status-merged',
};

const LOOK_WORDS: Record<PullRequestLook, string> = {
  open: 'open',
  draft: 'draft',
  closed: 'closed',
  failing: 'open, checks failing',
  merged: 'merged',
};

/** What a screen reader hears for the row's mark: "Pull request 244, open, checks failing". */
export function pullRequestLabel(pullRequest: PullRequestStatus): string {
  return `Pull request ${pullRequest.number}, ${LOOK_WORDS[pullRequestLook(pullRequest)]}`;
}

/** The short state word for a pull request: "Draft", "Open", "Merged", or "Closed". */
export function pullRequestStateWord(pullRequest: PullRequestStatus): string {
  const look = pullRequestLook(pullRequest);
  return look === 'failing' ? 'Open' : look.charAt(0).toUpperCase() + look.slice(1);
}

export type PullRequestChecksTone = 'failing' | 'running' | 'passing';

export interface PullRequestChecksSummary {
  tone: PullRequestChecksTone;
  label: string;
}

/** Compact check count + semantic tone for an open/draft pull request, or null when no checks apply. */
export function pullRequestChecksSummary(pullRequest: PullRequestStatus): PullRequestChecksSummary | null {
  const look = pullRequestLook(pullRequest);
  const { passing, failing, pending } = pullRequest.checks;
  const total = passing + failing + pending;
  if (total === 0 || look === 'merged' || look === 'closed') return null;
  if (failing > 0) return { tone: 'failing', label: `${failing}/${total} failed` };
  if (pending > 0) return { tone: 'running', label: `${pending}/${total} running` };
  return { tone: 'passing', label: `${passing}/${total} passed` };
}

/** The state and the checks in one line, for the row's tooltip: "Open · 2 of 5 checks failing". */
export function pullRequestLine(pullRequest: PullRequestStatus): string {
  const look = pullRequestLook(pullRequest);
  const state = pullRequestStateWord(pullRequest);
  const { passing, failing, pending } = pullRequest.checks;
  const total = passing + failing + pending;
  if (total === 0 || look === 'merged' || look === 'closed') return state;
  if (failing > 0) return `${state} · ${failing} of ${total} checks failing`;
  if (pending > 0) return `${state} · ${pending} of ${total} checks running`;
  return `${state} · checks passing`;
}

/** What the sidebar knows about one folder: its checked-out branch and its newest pull requests. */
export interface FolderPullRequests {
  branch: string | null;
  pullRequests: readonly PullRequestStatus[];
}

/** The newest unarchived session in each folder of its own (not a worktree), by id; worked out once per session list. */
export function newestSessionInFolder(sessions: readonly Session[]): ReadonlyMap<string, string> {
  const newest = new Map<string, Session>();
  for (const session of sessions) {
    if (session.worktree || isArchived(session)) continue;
    const path = workspacePathOf(session);
    const current = newest.get(path);
    if (!current || session.createdAt > current.createdAt) newest.set(path, session);
  }
  return new Map([...newest].map(([path, session]) => [path, session.id]));
}

/**
 * The branch whose pull request a session's row shows: a worktree session's own branch, else the
 * folder's checked-out branch, but only for the newest session in that folder (`newestSessionInFolder`).
 * Sessions do not record the branch they ran on, so an older session there would show whatever branch
 * is checked out now.
 */
export function sessionBranchOf(
  session: Session,
  folder: FolderPullRequests,
  newestInFolder: ReadonlyMap<string, string>,
): string | null {
  if (session.worktree) return session.worktree.branch;
  return newestInFolder.get(workspacePathOf(session)) === session.id ? folder.branch : null;
}

/** The pull request whose head is `branch`, the newest first, as gh lists them. */
export function pullRequestOnBranch(folder: FolderPullRequests, branch: string | null): PullRequestStatus | null {
  if (!branch) return null;
  return folder.pullRequests.find((pullRequest) => pullRequest.branch === branch) ?? null;
}

/**
 * Every pull request the agent made itself, newest first: those whose address `gh pr create`
 * printed and those whose head is a branch it made (`agentWorkOf`). An agent often works in a
 * worktree of its own inside the folder, whose branch the folder's checkout never shows.
 */
export function pullRequestsOfWork(folder: FolderPullRequests, work: AgentWork | undefined): PullRequestStatus[] {
  if (!work) return [];
  const urls = new Set(work.pullRequestUrls.map((url) => url.toLowerCase()));
  const branches = new Set(work.branches);
  return folder.pullRequests
    .filter((pullRequest) => urls.has(pullRequest.url.toLowerCase()) || branches.has(pullRequest.branch))
    .sort((a, b) => b.number - a.number);
}

/** The newest pull request the agent made itself (`pullRequestsOfWork`). */
export function pullRequestOfWork(folder: FolderPullRequests, work: AgentWork | undefined): PullRequestStatus | null {
  return pullRequestsOfWork(folder, work)[0] ?? null;
}

/**
 * The pull request a session's row shows: a worktree session's branch's, else one its agent made,
 * else the folder's branch's for the newest session there (`sessionBranchOf`).
 */
export function sessionPullRequestOf(
  session: Session,
  folder: FolderPullRequests,
  newestInFolder: ReadonlyMap<string, string>,
): PullRequestStatus | null {
  if (session.worktree) return pullRequestOnBranch(folder, session.worktree.branch);
  return pullRequestOfWork(folder, session.agentWork) ?? pullRequestOnBranch(folder, sessionBranchOf(session, folder, newestInFolder));
}
