import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { LineCommentBox } from "./LineCommentBox";
import type { RowReview } from "./DiffRows";
import { isCommentableRow, type FileChange, type UnifiedRow } from "../../lib/git-changes";
import {
  commentStatus,
  MAX_COMMENTS_PER_SESSION,
  type CommentStatus,
  type FileRead,
} from "../../lib/review-comments";
import {
  draftKeyOf,
  editDraftKeyOf,
  parseDraftKey,
  type ReviewComments,
} from "../../hooks/useReviewComments";
import type { ReviewComment, ReviewTarget } from "../../types";

const LIMIT_NOTE = `This session has ${MAX_COMMENTS_PER_SESSION} comments. Clear sent comments or delete some first.`;
const GONE_NOTE = "This line is no longer here in the diff.";

/** Where on a diff a comment or a box sits. */
export type LinePlace = Pick<ReviewComment, "target" | "file" | "side" | "line">;

/** What one file's section needs to show its comments. */
export interface FileReview {
  review: ReviewComments;
  target: ReviewTarget;
  /** This file's comments on `target`, in order. */
  comments: readonly ReviewComment[];
  /** The file's diff as `commentStatus` reads it; undefined until there is an answer. */
  read: FileRead | undefined;
  /** Takes the focus when what held it, in a list of comments, goes away. */
  onFocusLost: () => void;
}

type FileNames = Pick<FileChange, "path" | "oldPath">;

/** The sides and numbers of a row: a context row has both. */
function linesOf(row: UnifiedRow): Pick<ReviewComment, "side" | "line">[] {
  return [
    ...(row.newLine === undefined ? [] : [{ side: "new" as const, line: row.newLine }]),
    ...(row.oldLine === undefined ? [] : [{ side: "old" as const, line: row.oldLine }]),
  ];
}

const lineIdOf = ({ side, line }: Pick<ReviewComment, "side" | "line">) => `${side}:${line}`;

const lineIdsOf = (rows: readonly UnifiedRow[]) => new Set(rows.flatMap(linesOf).map(lineIdOf));

/** One saved comment: under its row, or with `location` and its quote in a list, where no row explains it. */
export function LineComment({ comment, status, review, location, onRemoved }: {
  comment: ReviewComment;
  status: CommentStatus;
  review: ReviewComments;
  location?: string;
  onRemoved: () => void;
}) {
  const editKey = editDraftKeyOf(comment.id);
  const edit = review.draftFor(editKey);
  const isEditing = edit !== undefined;
  const isSent = comment.sentAt !== undefined;
  const isOutdated = status === "outdated";
  const editButton = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const shouldMoveFocus = useRef(false);

  useEffect(() => {
    if (!shouldMoveFocus.current) return;
    shouldMoveFocus.current = false;
    (isEditing ? box : editButton).current?.focus();
  }, [isEditing]);

  if (edit) {
    return (
      <LineCommentBox
        ref={box}
        label={`Edit comment on line ${comment.line}`}
        location={location}
        initialBody={edit.body}
        onChange={(body) => review.setDraftBody(editKey, body)}
        onSave={(body) => {
          shouldMoveFocus.current = true;
          review.editComment(comment.id, body);
        }}
        onCancel={() => {
          shouldMoveFocus.current = true;
          review.closeDraft(editKey);
        }}
      />
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-sans text-xs">
      <div className={`min-w-0 flex-1 ${isSent ? "opacity-60" : ""}`}>
        {(location || isOutdated || isSent) && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-fg-muted">
            {location && <span className="min-w-0 truncate font-mono">{location}</span>}
            {isOutdated && <span className="font-medium text-status-attention">Outdated</span>}
            {isSent && <span className="font-medium">Sent</span>}
          </p>
        )}
        {location && <p className="truncate font-mono text-[11px] text-fg-subtle">{comment.quote}</p>}
        {isOutdated && <p className="text-[11px] text-fg-subtle">{GONE_NOTE}</p>}
        <p className="whitespace-pre-wrap break-words text-fg-secondary">{comment.body}</p>
      </div>
      <Button
        ref={editButton}
        variant="ghost"
        className="shrink-0 px-2 py-1"
        onClick={() => {
          shouldMoveFocus.current = true;
          review.openEdit(comment);
        }}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        className="shrink-0 px-2 py-1"
        onClick={() => {
          onRemoved();
          review.deleteComment(comment.id);
        }}
      >
        Delete
      </Button>
    </div>
  );
}

/** A comment being written, wherever it is shown. `oldPath` is the file's before a rename. */
export function DraftBox({ review, place, oldPath, location, onDone }: {
  review: ReviewComments;
  place: LinePlace;
  oldPath?: string | null;
  location?: string;
  onDone: () => void;
}) {
  const key = draftKeyOf(place);
  const draft = review.draftFor(key);
  const [isFull, setIsFull] = useState(false);
  if (!draft) return null;
  const anchor = { ...place, ...(place.side === "old" && oldPath ? { oldFile: oldPath } : {}) };
  return (
    <LineCommentBox
      label={`Comment on line ${place.line}`}
      location={location}
      initialBody={draft.body}
      error={isFull ? LIMIT_NOTE : undefined}
      onChange={(body) => review.setDraftBody(key, body)}
      onSave={() => {
        const isSaved = review.saveDraft(key, anchor);
        setIsFull(!isSaved);
        if (isSaved) onDone();
      }}
      onCancel={() => {
        onDone();
        review.closeDraft(key);
      }}
    />
  );
}

/** The comments that read true against `rows`, by line: those are the ones shown under their row. */
function commentsOnRows(file: FileReview, rows: readonly UnifiedRow[]): ReadonlyMap<string, readonly ReviewComment[]> {
  const placed = new Map<string, readonly ReviewComment[]>();
  if (file.comments.length === 0) return placed;
  const shown = lineIdsOf(rows);
  for (const comment of file.comments) {
    const id = lineIdOf(comment);
    if (commentStatus(comment, file.target, file.read) === "current" && shown.has(id)) {
      placed.set(id, [...(placed.get(id) ?? []), comment]);
    }
  }
  return placed;
}

/** One row of a diff's grid holding a comment or a box. */
function GridRow({ children }: { children: ReactNode }) {
  return (
    <div role="row">
      <div role="gridcell" className="px-2 py-1">
        {children}
      </div>
    </div>
  );
}

/** What a file's `DiffRows` needs: it asks about rows, and knows nothing of sessions. */
export function rowReviewOf(file: FileReview, change: FileNames, rows: readonly UnifiedRow[]): RowReview {
  const { review, target } = file;
  const placed = commentsOnRows(file, rows);
  const placeOf = (line: Pick<ReviewComment, "side" | "line">): LinePlace => ({ ...line, target, file: change.path });
  // A removed row takes a comment on the old side, and an added or context row on the new one.
  const newCommentPlace = (row: UnifiedRow) => (isCommentableRow(row) ? placeOf(linesOf(row)[0]) : undefined);
  return {
    canComment: (row) => {
      const place = newCommentPlace(row);
      return place !== undefined && review.draftFor(draftKeyOf(place)) === undefined;
    },
    openBox: (row) => {
      const place = newCommentPlace(row);
      if (place) review.openDraft(draftKeyOf(place), row);
    },
    under: (row, onDone) => {
      // Most files have neither, and this runs for every row of every open file.
      if (placed.size === 0 && review.draftKeys.length === 0) return null;
      const lines = linesOf(row);
      const comments = lines.flatMap((line) => placed.get(lineIdOf(line)) ?? []);
      const boxes = lines.map(placeOf).filter((place) => review.draftFor(draftKeyOf(place)));
      if (comments.length === 0 && boxes.length === 0) return null;
      return (
        <>
          {comments.map((comment) => (
            <GridRow key={comment.id}>
              <LineComment comment={comment} status="current" review={review} onRemoved={onDone} />
            </GridRow>
          ))}
          {boxes.map((place) => (
            <GridRow key={draftKeyOf(place)}>
              <DraftBox review={review} place={place} oldPath={change.oldPath} onDone={onDone} />
            </GridRow>
          ))}
        </>
      );
    },
  };
}

/** What a file's rows do not show: comments with no row to sit under, and boxes whose row has left the diff. */
export function FileComments({ file, change, rows }: {
  file: FileReview;
  change: FileNames;
  /** The rows comments can sit under. */
  rows: readonly UnifiedRow[];
}) {
  const { review, target, read, onFocusLost } = file;
  if (file.comments.length === 0 && review.draftKeys.length === 0) return null;
  const shown = lineIdsOf(rows);
  const placed = commentsOnRows(file, rows);
  const listed = file.comments.filter((comment) => !placed.get(lineIdOf(comment))?.includes(comment));
  const boxes = review.draftKeys.flatMap((key) => {
    const place = parseDraftKey(key);
    return place && place.file === change.path && place.target === target && !shown.has(lineIdOf(place)) ? [place] : [];
  });
  if (listed.length === 0 && boxes.length === 0) return null;
  return (
    <div className="mx-1.5 mb-1.5 flex flex-col gap-1">
      {listed.map((comment) => (
        <LineComment
          key={comment.id}
          comment={comment}
          status={commentStatus(comment, target, read)}
          review={review}
          location={`Line ${comment.line}`}
          onRemoved={onFocusLost}
        />
      ))}
      {boxes.map((place) => (
        <DraftBox
          key={draftKeyOf(place)}
          review={review}
          place={place}
          oldPath={change.oldPath}
          location={`Line ${place.line}`}
          onDone={onFocusLost}
        />
      ))}
    </div>
  );
}

/** What a section's header says about its comments, which holds with the section closed. */
export function commentSummary({ comments, target, read }: FileReview): string {
  const outdated = comments.filter((comment) => commentStatus(comment, target, read) === "outdated").length;
  const count = `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`;
  return outdated > 0 ? `${count}, ${outdated} outdated` : count;
}
