import { useState, type Ref } from "react";
import { Button } from "../ui/Button";
import { MAX_COMMENT_LENGTH } from "../../lib/review-comments";

/** Where a comment is written or edited. The owner keeps the text, so this box can come and go. */
export function LineCommentBox({ label, location, initialBody, error, onChange, onSave, onCancel, ref }: {
  /** The text field's name, which says which line this is for. */
  label: string;
  /** The line, for a box in a list, where no row above says which. */
  location?: string;
  initialBody: string;
  /** Why Save did nothing. */
  error?: string;
  onChange: (body: string) => void;
  onSave: (body: string) => void;
  onCancel: () => void;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const [body, setBody] = useState(initialBody);
  return (
    <div className="flex flex-col gap-1.5 font-sans text-xs">
      {location && <p className="truncate font-mono text-[11px] text-fg-muted">{location}</p>}
      <textarea
        ref={ref}
        aria-label={label}
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        onChange={(event) => {
          setBody(event.target.value);
          onChange(event.target.value);
        }}
        className="w-full resize-y rounded-md border border-border bg-surface-2 px-2 py-1 text-fg focus-ring"
      />
      {error && (
        <p role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={body.trim() === ""} onClick={() => onSave(body)}>
          Save comment
        </Button>
      </div>
    </div>
  );
}
