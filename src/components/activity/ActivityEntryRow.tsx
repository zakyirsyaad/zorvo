import { memo, useState } from "react";
import { statusWord, type ActivityEntry } from "../../lib/activity";
import { escapeVisible } from "../../lib/visible-text";

/** A multi-line command shows this many lines until opened. */
const MAX_COLLAPSED_LINES = 3;

const STATUS_STYLES: Record<string, string> = {
  Failed: "text-danger",
  Rejected: "text-danger",
  "Did not finish": "text-status-attention",
  "Waiting for you": "text-status-attention",
  "Not answered": "text-status-attention",
  Running: "text-status-running",
};

/** How much of a row's text names it to a screen reader. */
const MAX_LABEL_LENGTH = 80;

function textOf(entry: ActivityEntry): string {
  if (entry.kind === "file") return entry.isNamed ? entry.path : `${entry.path} (no file named)`;
  return entry.kind === "command" ? entry.command : entry.prompt;
}

const clockOf = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Escaped line by line, so a command keeps its lines and a hidden character shows. */
function linesOf(text: string): string[] {
  return text.split("\n").map(escapeVisible);
}

function Detail({ text }: { text: string }) {
  const lines = linesOf(text);
  const [isOpen, setIsOpen] = useState(false);
  const shown = isOpen ? lines : lines.slice(0, MAX_COLLAPSED_LINES);
  return (
    <>
      <span className="block whitespace-pre-wrap break-all font-mono text-[11px] text-fg-secondary">{shown.join("\n")}</span>
      {lines.length > MAX_COLLAPSED_LINES && !isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="focus-ring mt-0.5 rounded text-[11px] text-fg-muted hover:text-fg"
        >
          Show all {lines.length} lines
        </button>
      )}
    </>
  );
}

/** One thing the agent reported. Text only: nothing here is rendered as markdown or a link. */
export const ActivityEntryRow = memo(function ActivityEntryRow({ entry, isBusy, onJump }: {
  entry: ActivityEntry;
  isBusy: boolean;
  onJump: (messageId: string) => void;
}) {
  const word = statusWord(entry, isBusy);
  const text = textOf(entry);
  const label = `${escapeVisible(text.split("\n")[0].slice(0, MAX_LABEL_LENGTH))}, ${word}. Show in the chat`;
  return (
    <li className="border-b border-border px-3 py-1.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Detail text={text} />
          {entry.kind === "permission" && entry.command && <Detail text={entry.command} />}
          {entry.kind === "permission" && entry.choice && (
            <span className="block text-[11px] text-fg-muted">{escapeVisible(entry.choice)}</span>
          )}
          {entry.time !== null && (
            <time dateTime={new Date(entry.time).toISOString()} className="block text-[10px] text-fg-subtle">
              {clockOf(entry.time)}
            </time>
          )}
        </div>
        <button
          type="button"
          aria-label={label}
          onClick={() => onJump(entry.messageId)}
          className={`focus-ring shrink-0 rounded text-[11px] hover:underline ${STATUS_STYLES[word] ?? "text-fg-muted"}`}
        >
          {word}
        </button>
      </div>
    </li>
  );
});
