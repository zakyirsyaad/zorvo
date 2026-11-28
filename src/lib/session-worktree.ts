import { invoke } from '@tauri-apps/api/core';
import type { Session, SessionWorktree } from '../types';

const queues = new Map<string, Promise<unknown>>();

/**
 * A new session's worktree of `repoPath`, and the folder its agent runs in.
 * It starts from the local branch `baseBranch`, or from the folder's HEAD.
 * Git locks a repository's index while it makes a worktree, so calls for one
 * `repoPath` run one after another, whatever the earlier call's result.
 */
export function createSessionWorktree(
  repoPath: string,
  title: string,
  baseBranch?: string,
): Promise<{ worktree: SessionWorktree; cwd: string }> {
  const run = () => makeSessionWorktree(repoPath, title, baseBranch);
  const previous = queues.get(repoPath);
  const mine = previous ? previous.then(run, run) : run();
  queues.set(repoPath, mine);
  const release = () => {
    if (queues.get(repoPath) === mine) queues.delete(repoPath);
  };
  mine.then(release, release);
  return mine;
}

async function makeSessionWorktree(
  repoPath: string,
  title: string,
  baseBranch?: string,
): Promise<{ worktree: SessionWorktree; cwd: string }> {
  const created = await invoke<{ path: string; cwd: string; branch: string; startCommit: string }>('create_session_worktree', {
    repoPath,
    title,
    ...(baseBranch ? { baseBranch } : {}),
  });
  return {
    worktree: { repoPath, path: created.path, branch: created.branch, startCommit: created.startCommit },
    cwd: created.cwd,
  };
}

/**
 * `attachments` with the files of the folder `repoPath` pointed at the same
 * files in the worktree `cwd`, so an agent never edits the main checkout. The
 * backend is asked only when there is something to point.
 */
export async function attachmentsFor(
  repoPath: string,
  cwd: string,
  attachments: readonly string[] | undefined,
): Promise<readonly string[] | undefined> {
  if (!attachments?.length) return attachments;
  return invoke<string[]>('worktree_attachment_paths', { repoPath, cwd, paths: attachments });
}

/**
 * Removes a deleted session's worktree when no other session runs in it,
 * once its agent has stopped: never from under a running agent. The backend
 * keeps one with uncommitted changes, and its branch always. Resolves with a
 * notice for the user when the worktree was kept, or null. `onRemoved` runs
 * once the worktree is gone, never for a kept one, so shells in a kept worktree live on.
 */
export async function removeSessionWorktree(
  session: Session,
  otherSessions: readonly Session[],
  stopped: Promise<boolean>,
  onRemoved?: (path: string) => void,
): Promise<string | null> {
  const worktree = session.worktree;
  if (!worktree) return null;
  if (otherSessions.some((s) => s.id !== session.id && s.worktree?.path === worktree.path)) return null;
  if (!(await stopped)) return `Kept the worktree of "${session.name}": its agent could not be stopped.`;
  try {
    await invoke('remove_session_worktree', { repoPath: worktree.repoPath, path: worktree.path });
  } catch (error) {
    return `Kept the worktree of "${session.name}": ${String(error)}`;
  }
  onRemoved?.(worktree.path);
  return null;
}
