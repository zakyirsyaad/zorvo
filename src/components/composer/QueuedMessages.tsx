import { useLayoutEffect, useRef, useState } from "react";
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
  /** Changes with every announcement, so the same words are spoken again. */
  announcementKey: number;
  /** Set when an ended session cannot be continued: Send now is off and this is why. */
  sendNowBlockedReason?: string;
  onSendNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  /** Where focus goes when the last row leaves. */
  onFocusComposer: () => void;
}

type Control = "send" | "remove";

/** First words of a message, for a control's name: it says which message it acts on. */
function firstWords(text: string): string {
  const line = previewOf(text);
  return line.length > 40 ? `${line.slice(0, 40)}...` : line;
}

const attachmentLabel = (count: number) => (count === 1 ? "1 attachment" : `${count} attachments`);

interface RowProps {
  message: QueuedMessage;
  blockedReasonId?: string;
  isSendNowOff: boolean;
  register: (control: Control, element: HTMLButtonElement | null) => void;
  onSendNow: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function QueuedRow({ message, blockedReasonId, isSendNowOff, register, onSendNow, onEdit, onRemove }: RowProps) {
  const textId = `queued-text-${message.id}`;
  const textRef = useRef<HTMLSpanElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const name = firstWords(message.text) || attachmentLabel(message.attachments.length);

  // Clamped means the text needs more room than two lines give; measured, since it depends on the width.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || isExpanded) return;
    const measure = () => setIsClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.text, isExpanded]);

  const describedBy = blockedReasonId ? `${textId} ${blockedReasonId}` : textId;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-2 py-2 pr-2 pl-3 motion-safe:animate-appear">
      <span className="flex min-w-40 flex-1 flex-col items-start">
        <span
          ref={textRef}
          id={textId}
          title={escapeVisibleLines(message.text)}
          className={`text-ui break-words text-fg ${isExpanded ? "" : "line-clamp-2"}`}
        >
          {previewOf(message.text)}
        </span>
        {(isClamped || isExpanded) && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={isExpanded}
            aria-controls={textId}
            aria-label={`${isExpanded ? "Show less" : "Show all"}: ${name}`}
            onClick={() => setIsExpanded((value) => !value)}
          >
            {isExpanded ? "Show less" : "Show all"}
          </Button>
        )}
        {message.attachments.length > 0 && (
          <span className="text-caption text-fg-subtle">{attachmentLabel(message.attachments.length)}</span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          ref={(element) => register("send", element)}
          size="sm"
          variant="outline"
          disabled={isSendNowOff}
          aria-label={`Send now: ${name}`}
          aria-describedby={describedBy}
          onClick={onSendNow}
        >
          Send now
        </Button>
        <Button size="sm" variant="ghost" aria-label={`Edit: ${name}`} aria-describedby={textId} onClick={onEdit}>
          Edit
        </Button>
        <Button
          ref={(element) => register("remove", element)}
          size="sm"
          variant="ghost"
          aria-label={`Remove: ${name}`}
          aria-describedby={textId}
          onClick={onRemove}
        >
          Remove
        </Button>
      </span>
    </li>
  );
}

/**
 * Messages sent while the agent works, above the composer. They go out one per turn end, oldest first.
 * The live region stays mounted so what it says is announced when it changes.
 */
export function QueuedMessages({
  messages,
  agentName,
  hold,
  announcement,
  announcementKey,
  sendNowBlockedReason,
  onSendNow,
  onEdit,
  onRemove,
  onFocusComposer,
}: QueuedMessagesProps) {
  const holdNote = messages.length > 0 ? queueHoldNote(hold, agentName) : null;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const request = useRef<{ control: Control; id: string; index: number } | null>(null);
  const reasonId = "queued-send-now-reason";

  /** A row that leaves takes the focused button with it: the row in its place gets the focus, else the one before it. */
  useLayoutEffect(() => {
    const asked = request.current;
    if (!asked) return;
    request.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const kept = messages.some((message) => message.id === asked.id);
    const row = kept ? messages.find((message) => message.id === asked.id) : (messages[asked.index] ?? messages[asked.index - 1]);
    const target = row ? buttons.current.get(`${row.id}:${asked.control}`) : undefined;
    if (target) target.focus();
    else if (messages.length === 0) onFocusComposer();
  });

  const act = (control: Control, id: string, callback: (id: string) => void) => () => {
    request.current = { control, id, index: messages.findIndex((message) => message.id === id) };
    callback(id);
  };

  return (
    <div className={`flex w-full max-w-chat flex-col gap-1.5 select-none ${messages.length > 0 ? "pb-2" : ""}`}>
      <p role="status" className="sr-only">
        <span key={announcementKey}>{announcement}</span>
      </p>
      {sendNowBlockedReason && messages.length > 0 && (
        <span id={reasonId} className="sr-only">
          {sendNowBlockedReason}
        </span>
      )}
      {messages.length > 0 && (
        <ul aria-label="Queued messages" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {messages.map((message) => (
            <QueuedRow
              key={message.id}
              message={message}
              blockedReasonId={sendNowBlockedReason ? reasonId : undefined}
              isSendNowOff={Boolean(sendNowBlockedReason)}
              register={(control, element) => {
                const key = `${message.id}:${control}`;
                if (element) buttons.current.set(key, element);
                else buttons.current.delete(key);
              }}
              onSendNow={act("send", message.id, onSendNow)}
              onEdit={() => onEdit(message.id)}
              onRemove={act("remove", message.id, onRemove)}
            />
          ))}
        </ul>
      )}
      {holdNote && <p className="px-1 text-caption text-fg-subtle">{holdNote}</p>}
    </div>
  );
}
