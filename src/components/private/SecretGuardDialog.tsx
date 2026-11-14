import type { SecretGuardReview } from "../../hooks/useSecretGuard";
import { Button } from "../ui/Button";
import { PrivateDialog } from "./PrivateDialog";

export interface SecretGuardDialogProps {
  review: SecretGuardReview;
  onSendAnyway: () => void;
  onEdit: () => void;
}

/** Shown before a private message that may hold a secret leaves the app. */
export function SecretGuardDialog({ review, onSendAnyway, onEdit }: SecretGuardDialogProps) {
  return (
    <PrivateDialog
      title="This message may hold a secret"
      onEscape={onEdit}
      footer={
        <>
          <Button variant="ghost" tone="danger" className="mr-auto" onClick={onSendAnyway}>
            Send anyway
          </Button>
          <Button variant="primary" onClick={onEdit}>
            Edit message
          </Button>
        </>
      }
    >
      <p className="text-ui text-fg-muted">
        {review.matches.length > 0
          ? "Zorvo found these on this Mac, before anything was sent."
          : "Zorvo couldn't check these attachments on this Mac."}
      </p>
      {review.matches.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
          {review.matches.map((match, index) => (
            <li
              key={`${match.kind}:${match.file ?? "message"}:${match.line}:${index}`}
              className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5 last:border-b-0"
            >
              <span className="text-ui text-fg">{match.kind}</span>
              <span className="font-mono text-caption text-fg-subtle">
                {match.preview} · {match.file === null ? "in your message" : `in ${match.file}, attached`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {review.skipped.length > 0 && (
        <p className="text-ui-sm text-fg-subtle">
          {`Couldn't check ${review.skipped.length} ${review.skipped.length === 1 ? "file" : "files"}: ${review.skipped.join(", ")}`}
        </p>
      )}
      <p className="text-ui-sm text-fg-subtle">
        {review.agentName} can still read files in the folder itself. This check covers only what you send.
      </p>
    </PrivateDialog>
  );
}