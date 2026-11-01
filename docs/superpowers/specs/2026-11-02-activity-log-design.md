# Activity log — design

Date: 2026-11-02
Branch: `feat/activity-log`, from `main` at 15e331a.

## Goal

Answer "what has this agent done?" in one place, per session: the files it touched, the commands it
ran, and the permissions asked and answered. It leads with Zorvo's promise of transparency, and it
stays honest about what Zorvo can and cannot know.

Success: a user can read a session's activity without scrolling the chat, jump to any entry in the
chat, and see which changed files the agent did not report.

## What is decided

- A read-only view derived from the transcript. No new log, no new event path, no change to
  `useAcpEngine`'s turn handling.
- It says plainly that this is the agent's own report. Only file changes are checked, against git.
- Rewinding removes activity with the messages. The panel says so, always.
- Everything stays on this Mac.

Not built: a permanent audit log, export, search, statistics, elicitations in the list.

## What the transcript holds

`ChatMessage.tools` (`ToolExecution`: `name`, `status`, `kind`, `locations`, `details`, `startedAt`)
and `ChatMessage.actionCard` (`ActionCard`: `prompt`, `commandSnippet`, `status`, `options`,
`chosenOptionId`). A command is stored only on a permission card today.

**One data change.** `ToolExecution` gains `command?: string`, read from `rawInput` in `addToolCall`
and `updateToolCall` (`lib/acp-events.ts`). `rawInput.command` or `rawInput.cmd` may be a string, or
an array of strings (joined with spaces). Cut to `MAX_COMMAND_LENGTH` 2000. Older transcripts have
none, and show the tool's `name`. `normalizeTranscript` must keep the field, and a wrong type drops
only the field.

## The list

`activityOf(messages: readonly ChatMessage[]): ActivityEntry[]` in `lib/activity.ts`, pure, oldest
first in the data and newest first on screen.

```ts
type ActivityEntry = { messageId: string; time: number | null } & (
  | { kind: 'file'; path: string; action: 'read' | 'changed' | 'touched'; status: ToolExecution['status'] }
  | { kind: 'command'; command: string; status: ToolExecution['status'] }
  | { kind: 'permission'; prompt: string; command?: string; answer: 'allowed' | 'rejected' | 'unanswered'; choice?: string }
);
```

- **Files.** One entry per path per tool, from `locations` and from `details` of kind `diff`. The
  `:line` suffix is dropped. A diff, or a `kind` of `edit`, `delete` or `move`, means `changed`. A
  `kind` of `read` or `search` means `read`. Anything else means `touched`.
- **Commands.** A tool with `kind` `execute` gives one entry, using `command`, else `name`.
- **Other tools** give no entry unless they name a file.
- **Permissions.** One per `actionCard`. `answer` follows `status`, and `rejected` with no
  `chosenOptionId` is `unanswered`, which is how a card left open reads. `choice` is the name of the
  chosen option.
- `time` is `tool.startedAt` or `card.timestamp`, and null when the message has `hasKnownTime: false`
  (a replayed history), which shows no time.

## Checking files against git

`unreportedFiles(entries, stats, targets, cwd): string[]`, pure. Agents report paths as absolute, or
relative to their working folder. `reportedPath` normalizes them to the repository root using
`DiffTargets.root` and `prefix`. A path outside the repository cannot be checked and is left alone.

The stats are `useTargetStats` on one target: `start` for a session with `worktree.startCommit`, else
`head`. A file in the stats that no entry names, whatever its `action`, is listed under **Not
reported by the agent**, with: "These changed in git, but the agent did not list them. A command,
you, or another session may have changed them." A command can change files without naming them, so
the wording accuses nobody.

Without a repository, or while stats fail, the section does not show, and the panel says "Could not
check against git." when a read failed.

The check is per folder, so sessions sharing a folder see each other's changes. Committed work in a
session with no start commit is not in `head`, so it cannot appear.

## The panel

`SidePanel` gains `'activity'`. A top-bar button opens `components/activity/ActivityPanel.tsx`, shown
for a session on screen, not for a draft or a compare run's panel. It opens beside the chat like Files.

- Header: **Activity**, and filters **All**, **Files**, **Commands**, **Permissions**, each with its
  count, as toggle buttons.
- Fixed line at the top: "Agents report this themselves. Zorvo can only check file changes against
  git."
- Fixed line at the bottom: "Rewinding removes activity from this list."
- Entries, newest first. Status reads in words: **Running**, **Failed**, **Allowed**, **Rejected**,
  **Not answered**. A file shows its action as **Read**, **Changed** or **Touched**.
- **Not reported by the agent** sits above the entries, and shows under All and Files.
- Commands, prompts and paths pass through the visible escape from `lib/review-comments.ts`, moved to
  a shared `lib/visible-text.ts`, so a bidi control cannot make a command read differently.
- Rendered as text, never as markdown or links.
- Up to `MAX_ACTIVITY_ROWS` 500 rows, newest first, with "{n} older entries are not shown." The list
  is derived with `useMemo` on the session's messages, and only while the panel is open.

**Jump to the chat.** There is no way to reach a message today. `MessageRow` gets
`id="message-{id}"`, and pressing an entry calls `scrollIntoView` on it, moves focus there, and marks
it briefly. If `ChatCanvas` does not render every message, an entry whose message is not rendered has
no button. The plan states which applies, after reading `ChatCanvas`.

An empty session reads "Nothing yet. What the agent does shows here."

## Units

- `src/lib/activity.ts`: `activityOf`, `reportedPath`, `unreportedFiles`. Pure.
- `src/lib/visible-text.ts`: the escape, moved.
- `src/components/activity/ActivityPanel.tsx`, `ActivityEntryRow.tsx`.
- Changed: `lib/acp-events.ts`, `lib/persistence.ts`, `types/index.ts`, `hooks/useSidePanel.ts`,
  `components/TopBar.tsx`, `components/chat/MessageRow.tsx`, `App.tsx` (wiring only).

## Copy

- **Activity**, **All**, **Files**, **Commands**, **Permissions**
- **Running**, **Failed**, **Allowed**, **Rejected**, **Not answered**, **Read**, **Changed**, **Touched**
- **Not reported by the agent**
- The sentences quoted above, verbatim.

## Testing

Vitest:

- `activityOf`: each `kind`, a tool with both `locations` and a diff gives one file entry, `path:line`,
  a replayed message has no time, a card in each state, and a transcript from before `command`.
- `addToolCall` and `updateToolCall` keep `command` from a string, an array, `cmd`, and a wrong type.
- `reportedPath`: absolute, relative to a subfolder cwd, outside the repository.
- `unreportedFiles`: a reported file is not listed, a read-only report counts as reported, a command
  changing a file lists it.
- The panel: filters and counts, the two fixed lines, escapes, no markdown, the row cap, a failed
  git read, no panel on a draft, and a jump moves focus to the message.

Real app, with the fake-agent harness: run a session that edits, runs a command and asks a
permission, plus a file changed outside the agent's report. Read the panel, jump to the chat, and
restart.

## Docs

README: one bullet. CHANGELOG: one `### Added` line. CLAUDE.md: an **Activity log.** paragraph: derived
from the transcript, the agent's own report, the git check, and why rewinding removes entries.
