import { memo } from "react";
import type { ActivityEntry } from "../../lib/activity";
import { activityResult, activityVerb, dotTone, type DotTone } from "../../lib/activity-turns";
import { escapeVisible } from "../../lib/visible-text";

const RESULT_STYLES: Record<string, string> = {
  Failed: "text-danger",
  "You denied": "text-danger",
  "Waiting for you": "text-status-attention",
  "Not answered": "text-status-attention",
  Running: "text-status-running",
  "Did not finish": "text-fg-muted",
};

const DOT_STYLES: Record<DotTone, string> = {
  done: "border-status-running bg-status-running",
  failed: "border-danger bg-surface-1",
  running: "border-status-running bg-surface-1",
  waiting: "border-status-attention bg-surface-1",
  open: "border-border-strong bg-surface-1",
};

/** How much of a row's text names it to a screen reader. */
const MAX_LABEL_LENGTH = 80;

/** The row's one line, escaped so a hidden character shows; a command's later lines are marked, not shown. */
function oneLine(text: string): string {
  const [first, ...rest] = text.split("\n");
  return escapeVisible(first) + (rest.length > 0 ? " …" : "");
}

function Target({ entry }: { entry: ActivityEntry }) {
  const base = "min-w-0 flex-1 truncate text-caption text-fg-secondary";
  if (entry.kind === "file") {
    return <span className={`${base} font-mono`}>{oneLine(entry.isNamed ? entry.path : `${entry.path} (no file named)`)}</span>;
  }
  if (entry.kind === "command") return <span className={`${base} font-mono`}>{oneLine(entry.command)}</span>;
  return (
    <span className={base}>
      {entry.command ? (
        <>
          to run <span className="font-mono">{oneLine(entry.command)}</span>
        </>
      ) : (
        oneLine(entry.prompt)
      )}
    </span>
  );
}

const textOf = (entry: ActivityEntry) =>
  entry.kind === "file" ? entry.path : entry.kind === "command" ? entry.command : (entry.command ?? entry.prompt);

/** Everything the row cuts short: every line of the command, and for a permission what the agent asked too. */
const fullTextOf = (entry: ActivityEntry) =>
  entry.kind === "permission" && entry.command ? `${entry.prompt}\n${entry.command}` : textOf(entry);

/** One thing the agent reported, on the turn's timeline: verb, what it was about, how it ended. Text only. */
export const ActivityEntryRow = memo(function ActivityEntryRow({ entry, isBusy, onJump }: {
  entry: ActivityEntry;
  isBusy: boolean;
  onJump: (messageId: string) => void;
}) {
  const result = activityResult(entry, isBusy);
  // What you picked says more than the result: "Allow always" grants a standing permission.
  const choice = entry.kind === "permission" && entry.choice ? ` (${escapeVisible(entry.choice)})` : "";
  const label = `${escapeVisible(textOf(entry).split("\n")[0].slice(0, MAX_LABEL_LENGTH))}, ${result}${choice}. Show in the chat`;
  return (
    // The whole command, every line, for a row that shows only its first.
    <li
      title={fullTextOf(entry).split("\n").map(escapeVisible).join("\n")}
      className="relative flex items-start gap-2.5 py-[5px] pl-[22px] before:absolute before:inset-y-0 before:left-1.5 before:w-px before:bg-border">
      <span
        aria-hidden="true"
        data-dot=""
        className={`absolute top-[9px] left-0.5 size-[9px] rounded-full border-[1.5px] ${DOT_STYLES[dotTone(entry, isBusy)]}`}
      />
      <span className="w-[52px] shrink-0 text-ui-sm text-fg-muted">{activityVerb(entry)}</span>
      <Target entry={entry} />
      <button
        type="button"
        aria-label={label}
        onClick={() => onJump(entry.messageId)}
        className={`focus-ring shrink-0 rounded text-caption whitespace-nowrap hover:underline ${RESULT_STYLES[result] ?? "text-fg-subtle"}`}
      >
        {result}
      </button>
    </li>
  );
});
