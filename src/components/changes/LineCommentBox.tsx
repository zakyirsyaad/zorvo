import { useId, useState, type Ref } from "react";
import { Button } from "../ui/Button";
import { MAX_COMMENT_LENGTH } from "../../lib/review-comments";

/** Where a comment is written or edited. The owner keeps the text, so this box can come and go. */
export function LineCommentBox({ label, location, initialBody, error, onChange, onSave, onCancel, ref }: {
  /** The text field's visible label, which says which line this is for. */
  label: string;
  /** The file and line, for a box in the comments bar, where no row or section says which. */
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
  const fieldId = useId();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface-2 p-2.5 font-sans text-ui">
      {location && <p className="truncate font-mono text-caption text-fg-muted">{location}</p>}
      <label htmlFor={fieldId} className="text-caption text-fg-muted">
        {label}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        onChange={(event) => {
          setBody(event.target.value);
          onChange(event.target.value);
        }}
        className="w-full resize-y rounded-md border border-border-strong bg-ground px-2 py-1.5 text-fg focus-ring"
      />
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" tone="secondary" size="row" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" size="row" disabled={body.trim() === ""} onClick={() => onSave(body)}>
          Save comment
        </Button>
      </div>
    </div>
  );
}
