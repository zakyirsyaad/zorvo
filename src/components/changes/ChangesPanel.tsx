import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, Maximize2, RefreshCw } from "lucide-react";
import { formatLineCount, type DiffTargets, type FileStat } from "../../lib/diff-stats";
import { commitPathsOf, type ChangeKind, type FileChange } from "../../lib/git-changes";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { FileDiff } from "./FileDiff";
import { LineCounts } from "./LineCounts";
import { ReviewCommentsBar } from "./ReviewCommentsBar";
import { DIFF_NOT_LOADED, useFileReviews } from "../../hooks/useFileReviews";
import type { ReviewComments } from "../../hooks/useReviewComments";
import type { AddReview } from "../../hooks/useReviewWiring";
import { PullRequestList } from "./PullRequestList";
import type { PullRequestSummary } from "../../hooks/useRepoPullRequests";

export interface ChangesPanelProps {
  /** The folder the session works in; its whole repository's changes are listed. */
  rootPath: string;
  rootName: string;
  /** null while the first list is read. */
  changes: FileChange[] | null;
  /** Goes up with every list read; open diffs read again then. */
  version: number;
  onReload: () => void;
  /** The user's pull requests in this repository, newest first; none shown when null (gh missing, not on GitHub). */
  pullRequests?: PullRequestSummary[] | null;
  onOpenPullRequest?: (url: string) => void;
  /** Why the pull requests cannot be read: the GitHub CLI is missing, or the user is not connected. */
  githubProblem?: "not-installed" | "signed-out";
  /** Opens the GitHub section of Settings, where the user fixes `githubProblem`. */
  onOpenGithubSettings?: () => void;
  /** Lines added and removed against HEAD; **Open the diff** shows when there are any. */
  diffStats?: { added: number; removed: number };
  onOpenDiff?: () => void;
  /** Each file's counts against HEAD, shown on its card. */
  stats?: readonly FileStat[];
  /** The comments of the session on screen; lines take comments only with them, as in the full review. */
  review?: ReviewComments;
  /** Puts this session's comments in the message. */
  addReview?: AddReview;
  /** The repository's root and the folder's prefix, read by the inspector; a comment's path is worded from them. */
  targets?: DiffTargets;
  /** The last read of `targets` failed. */
  targetsFailed?: boolean;
  /** The last read of `stats` failed, so comments cannot be checked or added. */
  statsFailed?: boolean;
}

/** The Changes tab lists what Commit would take, so its comments are always on the diff against HEAD. */
const TARGET = "head";
const ONLY_HEAD = [TARGET] as const;
/** Until the inspector has read them: no root, so Add waits. */
const NO_TARGETS: DiffTargets = { base: null, root: "", prefix: "" };
const noop = () => {};

const KIND_LABEL: Record<ChangeKind, { letter: string; name: string; style: string }> = {
  modified: { letter: "M", name: "Modified", style: "text-fg-muted" },
  added: { letter: "A", name: "Added", style: "text-status-running" },
  untracked: { letter: "U", name: "Untracked", style: "text-status-running" },
  deleted: { letter: "D", name: "Deleted", style: "text-danger" },
  renamed: { letter: "R", name: "Renamed", style: "text-fg-secondary" },
};

type CommitState = { status: "idle" } | { status: "committing" } | { status: "done"; hash: string } | { status: "failed"; error: string };

function ChangeCard({ change, stat, commentCount, isChecked, isOpen, onCheck, onOpen, children }: {
  change: FileChange;
  /** The file's counts against HEAD, once read. */
  stat: FileStat | undefined;
  /** How many of the session's comments are on this file. */
  commentCount: number;
  isChecked: boolean;
  isOpen: boolean;
  onCheck: (isChecked: boolean) => void;
  onOpen: () => void;
  /** The file's diff, while it is open. */
  children?: ReactNode;
}) {
  const kind = KIND_LABEL[change.kind];
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <li className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className={`flex items-center gap-2 px-2.5 py-2 ${isOpen ? "border-b border-border" : ""}`}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={`Include ${change.path} in the commit`}
          className="size-3.5 shrink-0 accent-primary focus-ring"
        />
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={isOpen}
          title={change.oldPath ? `${change.oldPath} → ${change.path}` : change.path}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-ring"
        >
          {/* The kind leads, as drawn; its color still tells added from deleted at a glance. */}
          <span title={kind.name} aria-label={kind.name} className={`w-2.5 shrink-0 text-center font-mono text-caption ${kind.style}`}>
            {kind.letter}
          </span>
          <span className={`min-w-0 flex-1 truncate font-mono text-caption ${isOpen ? "text-fg" : "text-fg-secondary"}`}>{change.path}</span>
        </button>
        {commentCount > 0 && (
          <span className="shrink-0 text-caption text-fg-muted">
            {commentCount} {commentCount === 1 ? "comment" : "comments"}
          </span>
        )}
        {stat && !stat.isBinary && <LineCounts added={stat.added} removed={stat.removed} />}
        <Chevron size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
      </div>
      {/* A long line scrolls here, never widening the inspector. */}
      {isOpen && <div className="overflow-x-auto">{children}</div>}
    </li>
  );
}

/**
 * What changed in a session's repository since the last commit: each file's
 * diff, and a commit of the files chosen. It never pushes or throws changes away.
 */
export function ChangesPanel({
  rootPath,
  rootName,
  changes,
  version,
  onReload,
  pullRequests,
  onOpenPullRequest,
  githubProblem,
  onOpenGithubSettings,
  diffStats,
  onOpenDiff,
  stats,
  review,
  addReview,
  targets = NO_TARGETS,
  targetsFailed = false,
  statsFailed = false,
}: ChangesPanelProps) {
  // Files left out of the commit; any new change is included by default.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [commit, setCommit] = useState<CommitState>({ status: "idle" });

  const messageId = useId();
  const statOf = useMemo(() => new Map((stats ?? []).map((stat) => [stat.path, stat])), [stats]);
  const panel = useRef<HTMLElement>(null);
  const focusPanel = () => panel.current?.focus({ preventScroll: true });
  const { checked, reads, adder, fileReviewFor } = useFileReviews({
    rootPath,
    review,
    addReview,
    target: TARGET,
    targets,
    stats: stats ?? null,
    refreshes: version,
    blockedReason: targetsFailed || statsFailed ? DIFF_NOT_LOADED : undefined,
    onFocusLost: focusPanel,
  });
  // Another target's comments belong to the full review, which can show that target.
  const onHead = useMemo(() => checked.filter(({ comment }) => comment.target === TARGET), [checked]);
  const list = changes ?? [];
  const chosen = list.filter((change) => !excluded.has(change.path));
  const canCommit = chosen.length > 0 && message.trim() !== "" && commit.status !== "committing";

  const setIncluded = (path: string, isIncluded: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (isIncluded) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommit({ status: "committing" });
    try {
      const hash = await invoke<string>("commit_session_changes", {
        path: rootPath,
        files: commitPathsOf(chosen),
        message: message.trim(),
      });
      setCommit({ status: "done", hash });
      setMessage("");
      setOpenPath(null);
    } catch (error) {
      setCommit({ status: "failed", error: String(error) });
    }
    onReload();
  };

  return (
    <aside
      ref={panel}
      aria-label="Changes panel"
      tabIndex={review ? -1 : undefined}
      className={`flex h-full min-h-0 flex-1 flex-col text-ui text-fg-secondary select-none${review ? " focus-ring-inset" : ""}`}
    >
      {pullRequests && onOpenPullRequest && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto">
          <PullRequestList pullRequests={pullRequests} onOpen={onOpenPullRequest} />
        </div>
      )}
      {!pullRequests && githubProblem && onOpenGithubSettings && (
        <section aria-label="Pull requests" className="border-b border-border px-3 py-2">
          <p className="text-caption text-fg-subtle">
            {githubProblem === "not-installed"
              ? "Pull requests need the GitHub CLI, which is not installed."
              : "Pull requests need you to be connected to GitHub."}
          </p>
          <Button variant="ghost" onClick={onOpenGithubSettings} size="sm" className="mt-1">
            Open GitHub settings
          </Button>
        </section>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        <div className="flex items-center gap-2">
          <p className={changes !== null && list.length > 0 ? "font-semibold text-fg" : "text-fg-subtle"}>
            {changes === null
              ? "Reading the changes…"
              : list.length === 0
                ? "No uncommitted changes."
                : `${list.length} ${list.length === 1 ? "file" : "files"} changed`}
          </p>
          {diffStats && <LineCounts added={diffStats.added} removed={diffStats.removed} />}
          <span className="flex-1" />
          {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && onOpenDiff && (
            <Button
              variant="ghost"
              size="row"
              aria-label={`${formatLineCount(diffStats.added)} lines added, ${formatLineCount(diffStats.removed)} removed. Open the diff`}
              icon={<Maximize2 size={12} aria-hidden="true" />}
              onClick={onOpenDiff}
            >
              Open the diff
            </Button>
          )}
          <IconButton label="Refresh changes" size="row" onClick={onReload}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
        <ul aria-label={`Changes in ${rootName}`} className="flex flex-col gap-2.5">
          {list.map((change) => {
            const fileReview = fileReviewFor(change.path);
            return (
            <ChangeCard
              key={change.path}
              change={change}
              stat={statOf.get(change.path)}
              commentCount={fileReview?.checked.length ?? 0}
              isChecked={!excluded.has(change.path)}
              isOpen={openPath === change.path}
              onCheck={(isChecked) => setIncluded(change.path, isChecked)}
              onOpen={() => setOpenPath((current) => (current === change.path ? null : change.path))}
            >
              <FileDiff
                rootPath={rootPath}
                change={change}
                version={version}
                target={TARGET}
                density="card"
                review={fileReview}
                takesComments={!change.path.endsWith("/")}
              />
            </ChangeCard>
            );
          })}
        </ul>
        {/* At the bottom of the scroll area, as drawn: it rides under the last card. */}
        {review && (
          <ReviewCommentsBar
            variant="card"
            review={review}
            adder={adder}
            checked={onHead}
            target={TARGET}
            targets={targets}
            options={ONLY_HEAD}
            reads={reads}
            listed={stats ?? null}
            onTargetChange={noop}
            onFocusLost={focusPanel}
          />
        )}
      </div>

      {list.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border px-3.5 pt-3 pb-3.5">
          <label htmlFor={messageId} className="sr-only">
            Commit message
          </label>
          <textarea
            id={messageId}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Commit message"
            className="w-full resize-none rounded-lg border border-border-strong bg-ground px-2.5 py-2 text-ui text-fg placeholder-fg-subtle focus-ring"
          />
          <Button
            variant="primary"
            onClick={() => void handleCommit()}
            disabled={!canCommit}
            className="w-full"
          >
            {commit.status === "committing"
              ? "Committing…"
              : `Commit ${chosen.length} file${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
      {commit.status === "done" && (
        <p role="status" className="border-t border-border px-4 py-1.5 text-caption text-status-running">
          Committed {commit.hash}.
        </p>
      )}
      {commit.status === "failed" && (
        <p role="alert" className="border-t border-border px-4 py-1.5 text-caption text-danger">
          {commit.error}
        </p>
      )}
    </aside>
  );
}
