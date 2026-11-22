import { Button } from "../ui/Button";
import { escapeVisibleLines } from "../../lib/visible-text";
import { previewOf, queueHoldNote, type QueueHold, type QueuedMessage } from "../../lib/queued-messages";

export interface QueuedMessagesProps {
  messages: readonly QueuedMessage[];
  agentName: string;
  /** Why the queue is not sending by itself, when it is not. */
  hold: QueueHold | null;
  /** Spoken politely when it changes: queued, sent. */
  announcement: string;
  onSendNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

/** First words of a message, for a control's name: it says which message it acts on. */
function firstWords(text: string): string {
  const line = previewOf(text);
  return line.length > 40 ? `${line.slice(0, 40)}...` : line;
}

const attachmentLabel = (count: number) => (count === 1 ? "1 attachment" : `${count} attachments`);

/**
 * Messages sent while the agent works, above the composer. They go out one per turn end, oldest first.
 * The live region stays mounted so what it says is announced when it changes.
 */
export function QueuedMessages({ messages, agentName, hold, announcement, onSendNow, onEdit, onRemove }: QueuedMessagesProps) {
  const holdNote = messages.length > 0 ? queueHoldNote(hold, agentName) : null;
  return (
    <div className={`flex w-full max-w-chat flex-col gap-1.5 select-none ${messages.length > 0 ? "pb-2" : ""}`}>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {messages.length > 0 && (
        <ul aria-label="Queued messages" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {messages.map((message) => {
            const textId = `queued-text-${message.id}`;
            const name = firstWords(message.text) || attachmentLabel(message.attachments.length);
            return (
              <li
                key={message.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-2 py-2 pr-2 pl-3 motion-safe:animate-appear"
              >
                <span className="flex min-w-40 flex-1 flex-col">
                  <span id={textId} title={escapeVisibleLines(message.text)} className="line-clamp-2 text-ui break-words text-fg">
                    {previewOf(message.text)}
                  </span>
                  {message.attachments.length > 0 && (
                    <span className="text-caption text-fg-subtle">{attachmentLabel(message.attachments.length)}</span>
                  )}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" aria-label={`Send now: ${name}`} aria-describedby={textId} onClick={() => onSendNow(message.id)}>
                    Send now
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Edit: ${name}`} aria-describedby={textId} onClick={() => onEdit(message.id)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove: ${name}`} aria-describedby={textId} onClick={() => onRemove(message.id)}>
                    Remove
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {holdNote && <p className="px-1 text-caption text-fg-subtle">{holdNote}</p>}
    </div>
  );
}
