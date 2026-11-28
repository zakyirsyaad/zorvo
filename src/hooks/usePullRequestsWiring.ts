import { useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  newestSessionInFolder,
  pullRequestOnBranch,
  pullRequestsOfWork,
  sessionPullRequestOf,
} from '../lib/pull-request-look';
import { isArchived, workspacePathOf } from '../lib/session-helpers';
import type { Session } from '../types';
import type { NoticeTone } from './useNotice';
import { usePullRequest } from './usePullRequest';
import { useRepoPullRequests } from './useRepoPullRequests';
import { useWorkspacePullRequests } from './useWorkspacePullRequests';

export interface PullRequestsWiringDeps {
  sessions: readonly Session[];
  activeSession: Session | undefined;
  isSessionBusy: (sessionId: string) => boolean;
  isGithubSignedIn: boolean;
  isRepository: boolean;
  shownFolderPath: string | undefined;
  branch: string | null | undefined;
  changesFolderPath: string | undefined;
  turnsEnded: number;
  suppressRepoError: boolean;
  reportError: (message: string) => void;
  setNotice: (message: string, tone?: NoticeTone) => void;
}

/**
 * Joins workspace, session, branch and repository pull request queries plus
 * external PR link opening.
 */
export function usePullRequestsWiring({
  sessions,
  activeSession,
  isSessionBusy,
  isGithubSignedIn,
  isRepository,
  shownFolderPath,
  branch,
  changesFolderPath,
  turnsEnded,
  suppressRepoError,
  reportError,
  setNotice,
}: PullRequestsWiringDeps) {
  const listedFolders = useMemo(
    () => [...new Set(sessions.filter((session) => !isArchived(session)).map(workspacePathOf))],
    [sessions],
  );
  const busyFolders = sessions.filter((session) => isSessionBusy(session.id)).map(workspacePathOf);
  const activeWork = activeSession?.agentWork;
  const liveRefreshKey = activeWork
    ? `${activeWork.pullRequestUrls.join(',')}|${activeWork.branches.join(',')}`
    : '';
  const folderPullRequests = useWorkspacePullRequests(listedFolders, isGithubSignedIn, busyFolders, {
    liveFolder: activeSession ? workspacePathOf(activeSession) : undefined,
    liveRefreshKey,
  });
  const newestInFolder = useMemo(() => newestSessionInFolder(sessions), [sessions]);
  const pullRequestOf = useCallback(
    (session: Session) => {
      const folder = folderPullRequests.get(workspacePathOf(session));
      return folder ? sessionPullRequestOf(session, folder, newestInFolder) : null;
    },
    [folderPullRequests, newestInFolder],
  );

  // The top bar reads the same list; its own call is only for a branch outside the 100 newest.
  const shownFolder = activeSession ? folderPullRequests.get(workspacePathOf(activeSession)) : undefined;
  // A session in the folder's own checkout first shows the pull requests its agent made, often from a worktree of its own.
  const workPullRequests = useMemo(
    () =>
      shownFolder && activeSession && !activeSession.worktree
        ? pullRequestsOfWork(shownFolder, activeSession.agentWork)
        : [],
    [shownFolder, activeSession],
  );
  const listedPullRequest =
    workPullRequests[0] ?? (shownFolder ? pullRequestOnBranch(shownFolder, branch ?? null) : null);
  const ownPullRequest = usePullRequest(
    isRepository && !listedPullRequest ? shownFolderPath : undefined,
    branch ?? undefined,
    turnsEnded,
  );
  const pullRequest = listedPullRequest ?? ownPullRequest;
  // The overview card lists every pull request the agent made; without any, the one the top bar shows.
  const pullRequests = useMemo(
    () => (workPullRequests.length > 0 ? workPullRequests : pullRequest ? [pullRequest] : []),
    [workPullRequests, pullRequest],
  );

  const repoPullRequests = useRepoPullRequests(
    changesFolderPath,
    turnsEnded,
    suppressRepoError ? () => {} : reportError,
  );

  const openPullRequest = (url: string) => {
    invoke('open_external_url', { url }).catch((error) =>
      setNotice(`Could not open the pull request: ${String(error)}`),
    );
  };

  return { pullRequest, pullRequests, pullRequestOf, repoPullRequests, openPullRequest };
}
