import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { LineCommentBox } from "./LineCommentBox";
import type { RowReview } from "./DiffRows";
import { isCommentableRow, type FileChange, type UnifiedRow } from "../../lib/git-changes";
import {
  commentStatus,
  MAX_COMMENTS_PER_SESSION,
  type CheckedComment,
  type CommentStatus,
  type FileRead,
} from "../../lib/review-comments";
import {
  draftKeyOf,
  editDraftKeyOf,
  parseDraftKey,
  type CommentAnchor,
  type ReviewComments,
} from "../../hooks/useReviewComments";
import type { ReviewComment, ReviewTarget } from "../../types";

const LIMIT_NOTE = `This session has ${MAX_COMMENTS_PER_SESSION} comments. Clear sent comments or delete some first.`;
const GONE_NOTE = "This line is no longer here in the diff.";
const STATUS_LABEL: Partial<Record<CommentStatus, string>> = { outdated: "Outdated", elsewhere: "Not in this diff" };
/** How long Delete waits for its confirming second click. */
const CONFIRM_DELETE_MS = 4000;

/** Puts comments in the message. Absent, no comment says In message or offers to add. */
export interface CommentAdder {
  inMessage: ReadonlySet<string>;
  /** Why nothing can be added now, shown beside the header's Add under `reasonId`. */
  blockedReason: string | undefined;
  reasonId: string;
  /** A status, or a path, is still being read: a message now would word it wrongly. */
  isWaiting: boolean;
  add: (comments: readonly CheckedComment[]) => void;
}

/** A button of a comment that the header's Add leaves out: an Outdated one's Add, a Sent one's Add again. */
export function ownAddLabel(comment: ReviewComment, status: CommentStatus, inMessage: ReadonlySet<string>): string | null {
  if (status === "elsewhere" || inMessage.has(comment.id)) return null;
  if (comment.sentAt !== undefined) return "Add again";
  return status === "outdated" ? "Add" : null;
}

/** What one file's section needs to show its comments. */
export interface FileReview {
  review: ReviewComments;
  adder?: CommentAdder;
  target: ReviewTarget;
  /** This file's comments on `target`, in order, with the statuses `DiffView` worked out once. */
  checked: readonly CheckedComment[];
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

/**
 * A comment can hold 2000 characters and has no undo, so deleting takes two clicks:
 * Delete turns into "Delete?", which deletes, and turns back by itself. It is one
 * button throughout, so focus stays on it; only Cancel can go away under the focus,
 * and focus then comes back to Delete.
 */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      if (document.activeElement === cancelButton.current) deleteButton.current?.focus();
      setIsConfirming(false);
    }, CONFIRM_DELETE_MS);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  return (
    <>
      <Button
        ref={deleteButton}
        variant={isConfirming ? "danger" : "ghost"}
        aria-label={isConfirming ? "Confirm delete" : undefined}
        title={isConfirming ? "Delete this comment for good" : undefined}
        size="sm" className="shrink-0"
        onClick={isConfirming ? onDelete : () => setIsConfirming(true)}
      >
        {isConfirming ? "Delete?" : "Delete"}
      </Button>
      {isConfirming && (
        <Button
          ref={cancelButton}
          variant="ghost"
          size="sm" className="shrink-0"
          onClick={() => {
            deleteButton.current?.focus();
            setIsConfirming(false);
          }}
        >
          Cancel
        </Button>
      )}
    </>
  );
}

/** One saved comment: under its row, or with `location` and its quote in a list, where no row explains it. */
export function LineComment({ comment, status, review, adder, location, onRemoved }: {
  comment: ReviewComment;
  status: CommentStatus;
  review: ReviewComments;
  adder?: CommentAdder;
  location?: string;
  onRemoved: () => void;
}) {
  const editKey = editDraftKeyOf(comment.id);
  const edit = review.draftFor(editKey);
  const isEditing = edit !== undefined;
  const isSent = comment.sentAt !== undefined;
  const isInMessage = adder?.inMessage.has(comment.id) ?? false;
  const addLabel = adder ? ownAddLabel(comment, status, adder.inMessage) : null;
  const statusLabel = STATUS_LABEL[status];
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
        {(location || statusLabel || isSent || isInMessage) && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-fg-muted">
            {location && <span className="min-w-0 truncate font-mono">{location}</span>}
            {statusLabel && <span className={status === "outdated" ? "font-medium text-status-attention" : "font-medium"}>{statusLabel}</span>}
            {isInMessage && <span className="font-medium">In message</span>}
            {isSent && <span className="font-medium">Sent</span>}
          </p>
        )}
        {location && <p className="truncate font-mono text-[11px] text-fg-subtle">{comment.quote}</p>}
        {status === "outdated" && <p className="text-[11px] text-fg-subtle">{GONE_NOTE}</p>}
        <p className="whitespace-pre-wrap break-words text-fg-secondary">{comment.body}</p>
      </div>
      {adder && addLabel && (
        <Button
          variant="ghost"
          size="sm" className="shrink-0"
          disabled={adder.isWaiting || adder.blockedReason !== undefined}
          aria-describedby={adder.blockedReason ? adder.reasonId : undefined}
          onClick={() => adder.add([{ comment, status }])}
        >
          {addLabel}
        </Button>
      )}
      <Button
        ref={editButton}
        variant="ghost"
        size="sm" className="shrink-0"
        onClick={() => {
          shouldMoveFocus.current = true;
          review.openEdit(comment);
        }}
      >
        Edit
      </Button>
      <DeleteButton
        onDelete={() => {
          onRemoved();
          review.deleteComment(comment.id);
        }}
      />
    </div>
  );
}

/** A comment being written, wherever it is shown. */
export function DraftBox({ review, place, location, onDone }: {
  review: ReviewComments;
  place: CommentAnchor;
  location?: string;
  onDone: () => void;
}) {
  const key = draftKeyOf(place);
  const draft = review.draftFor(key);
  const [isFull, setIsFull] = useState(false);
  if (!draft) return null;
  return (
    <LineCommentBox
      label={`Comment on line ${place.line}`}
      location={location}
      initialBody={draft.body}
      error={isFull ? LIMIT_NOTE : undefined}
      onChange={(body) => review.setDraftBody(key, body)}
      onSave={() => {
        const isSaved = review.saveDraft(key, place);
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

/** `file` read from the rows on screen, which stand in until the file's own read answers. */
export function againstRows(file: FileReview, rows: readonly UnifiedRow[]): FileReview {
  const read: FileRead = { status: "read", rows };
  const checked = file.checked.map(({ comment }) => ({ comment, status: commentStatus(comment, file.target, read) }));
  return { ...file, read, checked };
}

/** The comments that read true against `rows`, by line: those are the ones shown under their row. */
function commentsOnRows(file: FileReview, rows: readonly UnifiedRow[]): ReadonlyMap<string, readonly CheckedComment[]> {
  const placed = new Map<string, readonly CheckedComment[]>();
  if (file.checked.length === 0) return placed;
  const shown = lineIdsOf(rows);
  for (const checked of file.checked) {
    const id = lineIdOf(checked.comment);
    if (checked.status === "current" && shown.has(id)) {
      placed.set(id, [...(placed.get(id) ?? []), checked]);
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
  const placeOf = (line: Pick<ReviewComment, "side" | "line">): CommentAnchor => ({ ...line, target, file: change.path });
  // A removed row takes a comment on the old side, and an added or context row on the new one.
  const newCommentPlace = (row: UnifiedRow) => (isCommentableRow(row) ? placeOf(linesOf(row)[0]) : undefined);
  return {
    canComment: (row) => {
      const place = newCommentPlace(row);
      return place !== undefined && review.draftFor(draftKeyOf(place)) === undefined;
    },
    openBox: (row) => {
      const place = newCommentPlace(row);
      if (place) review.openDraft(draftKeyOf(place), row, place.side === "old" ? (change.oldPath ?? undefined) : undefined);
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
          {comments.map(({ comment, status }) => (
            <GridRow key={comment.id}>
              <LineComment comment={comment} status={status} review={review} adder={file.adder} onRemoved={onDone} />
            </GridRow>
          ))}
          {boxes.map((place) => (
            <GridRow key={draftKeyOf(place)}>
              <DraftBox review={review} place={place} onDone={onDone} />
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
  const { review, target, onFocusLost } = file;
  if (file.checked.length === 0 && review.draftKeys.length === 0) return null;
  const shown = lineIdsOf(rows);
  const placed = commentsOnRows(file, rows);
  const listed = file.checked.filter(({ comment }) => !placed.get(lineIdOf(comment))?.some((shownHere) => shownHere.comment === comment));
  const boxes = review.draftKeys.flatMap((key) => {
    const place = parseDraftKey(key);
    return place && place.file === change.path && place.target === target && !shown.has(lineIdOf(place)) ? [place] : [];
  });
  if (listed.length === 0 && boxes.length === 0) return null;
  return (
    <div className="mx-1.5 mb-1.5 flex flex-col gap-1">
      {listed.map(({ comment, status }) => (
        <LineComment
          key={comment.id}
          comment={comment}
          status={status}
          review={review}
          adder={file.adder}
          location={`Line ${comment.line}`}
          onRemoved={onFocusLost}
        />
      ))}
      {boxes.map((place) => (
        <DraftBox key={draftKeyOf(place)} review={review} place={place} location={`Line ${place.line}`} onDone={onFocusLost} />
      ))}
    </div>
  );
}

/** What a section's header says about its comments, which holds with the section closed. */
export function commentSummary({ checked }: FileReview): string {
  const outdated = checked.filter(({ status }) => status === "outdated").length;
  const count = `${checked.length} ${checked.length === 1 ? "comment" : "comments"}`;
  return outdated > 0 ? `${count}, ${outdated} outdated` : count;
}
