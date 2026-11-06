import { useId, useMemo } from "react";
import type { CommentAdder, FileReview } from "../components/changes/LineComment";
import { useCommentedFileReads } from "./useCommentedFileReads";
import type { ReviewComments } from "./useReviewComments";
import type { AddReview } from "./useReviewWiring";
import type { DiffTargetId, DiffTargets, FileStat } from "../lib/diff-stats";
import { commentStatus, sortComments, type CheckedComment, type FileRead } from "../lib/review-comments";
import type { ReviewComment } from "../types";

/** Why Add is off when a view's diff could not be read. */
export const DIFF_NOT_LOADED = "The diff has not loaded, so comments cannot be added. Refresh to try again.";

export interface FileReviewsInput {
  rootPath: string;
  /** The comments of the session on screen; without them nothing is offered. */
  review: ReviewComments | undefined;
  /** Puts this session's comments in the message. */
  addReview: AddReview | undefined;
  target: DiffTargetId;
  targets: DiffTargets;
  /** The files the diff lists, or null before the first answer. */
  stats: readonly FileStat[] | null;
  /** What the "start" target is measured from. */
  startCommit?: string;
  /** Goes up on Refresh, which reads the commented files again. */
  refreshes: number;
  /** A reason Add is off for this view (its targets or its list failed to load). */
  blockedReason?: string;
  /** Takes the focus when what held it, in a list of comments, goes away. */
  onFocusLost: () => void;
}

export interface FileReviews {
  /** The session's comments, in order. */
  comments: readonly ReviewComment[];
  /** Every comment with its status on `target`. */
  checked: readonly CheckedComment[];
  /** What each commented file on `target` reads as. */
  reads: Readonly<Record<string, FileRead>>;
  adder: CommentAdder | undefined;
  fileReviewFor: (path: string) => FileReview | undefined;
}

/** What a view of a diff needs to show and add one session's comments, file by file. */
export function useFileReviews({
  rootPath,
  review,
  addReview,
  target,
  targets,
  stats,
  startCommit,
  refreshes,
  blockedReason,
  onFocusLost,
}: FileReviewsInput): FileReviews {
  const comments = useMemo(() => sortComments(review?.comments ?? []), [review?.comments]);
  const { reads, isReading } = useCommentedFileReads(rootPath, comments, target, stats, startCommit, refreshes);
  // Each status can scan a whole file's rows, and an agent's every chunk redraws the view.
  const checked = useMemo(
    () => comments.map((comment) => ({ comment, status: commentStatus(comment, target, reads[comment.file]) })),
    [comments, reads, target],
  );
  const onTarget = useMemo(() => checked.filter(({ comment }) => comment.target === target), [checked, target]);
  const reasonId = useId();
  const adder: CommentAdder | undefined = addReview && {
    inMessage: addReview.inMessage,
    blockedReason: addReview.blockedReason ?? blockedReason,
    reasonId,
    // Until the root is known (loading, or the targets failed) a path cannot be worded from the agent's folder.
    isWaiting: isReading || targets.root === "",
    add: (picked) =>
      addReview.add(picked, target, { root: targets.root, prefix: targets.prefix, baseName: targets.base?.name ?? null }),
  };
  const fileReviewFor = (path: string): FileReview | undefined =>
    review && {
      review,
      adder,
      target,
      checked: onTarget.filter(({ comment }) => comment.file === path),
      read: reads[path],
      onFocusLost,
    };
  return { comments, checked, reads, adder, fileReviewFor };
}
