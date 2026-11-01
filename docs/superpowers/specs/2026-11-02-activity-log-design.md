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
an array of strings (joined with spaces, quoting an element that holds a space). Cut to
`MAX_COMMAND_LENGTH` 2000, ending with "…". Older transcripts have none, and show the tool's `name`.
`normalizeTranscript` does not inspect `tools`, so `activityOf` guards the type itself.

**Keeping paths known.** `updateToolCall` no longer lets an empty `locations` or `content` replace
known ones, and a diff too large to keep stays a `diff` detail with its `path`, without its text, so
the file stays named.

## The list

`activityOf(messages: readonly ChatMessage[]): ActivityEntry[]` in `lib/activity.ts`, pure, oldest
first in the data and newest first on screen.

```ts
type ActivityEntry = { messageId: string; time: number | null } & (
  | { kind: 'file'; path: string; action: 'read' | 'changed' | 'touched'; status: ToolExecution['status'] }
  | { kind: 'command'; command: string; status: ToolExecution['status'] }
  | { kind: 'permission'; prompt: string; command?: string; answer: 'waiting' | 'allowed' | 'rejected' | 'unanswered'; choice?: string }
);
```

- **Files.** One entry per path per tool, from `locations` and from `details` of kind `diff`. The
  `:line` suffix is dropped. `action` is what the tool was for, not what happened: a diff, or a `kind`
  of `edit`, `delete` or `move`, is `changed`; a `kind` of `read` or `search` is `read`; anything else
  is `touched`. A tool of `kind` `edit`, `delete` or `move` naming no file gives one entry from `name`.
- **Commands.** A tool with `kind` `execute` gives one command entry, using `command`, else `name`,
  plus a `touched` entry for each file it names.
- **Other tools** that name no file give no entry, and are counted: "{n} other tool calls are not
  listed."
- **Permissions.** One per `actionCard`. `pending` is `waiting`. `approved` is `allowed`. `rejected`
  with a `chosenOptionId` is `rejected`, and without one is `unanswered`, which is how a card closed
  at a turn's end reads. `choice` is the name of the chosen option.
- **Order** is message order, then a message's tools, then its card, never time. An update replaces a
  tool in place, so one tool gives one set of entries.
- `time` is `tool.startedAt` or `card.timestamp`, else `message.timestamp`, and null when the message
  has `hasKnownTime: false` (a replayed history), which shows no time.

**What a row may claim.** A file reads **Changed** only when its tool is `completed`, and that means
reported as changed. Otherwise the row shows the path and the tool's status only. A `running` tool
reads **Running** only while its session is busy, else **Did not finish**, since `closeTurn` keeps
running tools. A permission's card cannot be tied to a tool, so a row never says a rejected tool did
not run.

## Checking files against git

`unreportedFiles(entries, stats, targets, cwd): string[]`, pure. Agents report absolute paths, or
paths relative to their working folder. `reportedPath` normalizes them to the repository root: it
matches under `cwd`, then under `DiffTargets.root`, since `root` is canonical and `cwd` may not be
(`/tmp` against `/private/tmp`). A path outside the repository cannot be checked and is left alone.

Only a `completed` entry of action `changed` or `touched` counts as reported, matching a stat's `path`
or `oldPath`. Reading a file does not report changing it, and a failed edit changed nothing.

The stats are `sidePanel.headStats` for `head`, or one `useDiffStatsSince` read for `start`, used for
a session with `worktree.startCommit`, else `head`. Its failure is exposed and not reported twice. The
list is read when the panel opens, on turn end and on focus, so it can lag a working agent.

**Not reported by the agent** lists a file in the stats that nothing reported, with: "These changed in
git, but the agent did not list them. A command, a rewind, you, or another session may have changed
them." A command can change files without naming them, so the wording accuses nobody. Up to 100 show,
with "{n} more."

The section always says what was compared: "Compared with uncommitted changes." or "Compared since
this worktree began." An empty section reads "Nothing unreported.", never as proof of more than that.

No check runs unless targets and stats both loaded without failure, the transcript has loaded, and
the session is in a repository. A failed read says "Could not check against git." A session with
`historyElsewhere` says "Earlier work stays in the agent, so it is not checked." and shows no section,
since its earlier files would all read as unreported.

The check is per folder, so sessions sharing a folder see each other's changes. Committed work in a
session with no start commit is not in `head`, so it cannot appear.

## The panel

`SidePanel` gains `'activity'`. A top-bar button opens `components/activity/ActivityPanel.tsx`, shown
for a session on screen in the main window, not for a draft or a compare run's panel. It opens beside
the chat like Files. It is keyed by session, so a switch resets the filter, and it shows again when a
session returns. While the transcript loads it reads "Reading the activity…", not an empty list.

- Header: **Activity**, and filters **All**, **Files**, **Commands**, **Permissions**, each with its
  count, as toggle buttons.
- Fixed line at the top: "Agents report this themselves. Zorvo can only check file changes against
  git."
- Fixed line at the bottom: "Rewinding removes activity from this list."
- Entries, newest first. Status reads in words: **Running**, **Did not finish**, **Failed**,
  **Waiting for you**, **Allowed**, **Rejected**, **Not answered**. A completed file shows **Read**,
  **Changed** or **Touched**.
- **Not reported by the agent** sits above the entries, and shows under All and Files.
- Commands, prompts, choices and paths pass through the visible escape from `lib/review-comments.ts`,
  moved to a shared `lib/visible-text.ts`, so a bidi control cannot make a command read differently.
  The escape also covers U+200B-200D and U+FEFF. A multi-line command is escaped per line, keeps its
  lines, and clamps to 3 until opened.
- Rendered as text, never as markdown or links.
- The filter applies first, then up to `MAX_ACTIVITY_ROWS` 500 rows show, with "{n} older entries are
  not shown." Counts and the git check use all entries.
- Derived only while the panel is open. Updates flush per frame, so `activityOf` caches each message's
  entries in a `WeakMap` (unchanged messages keep their identity), rows are memoized, and the list goes
  through `useDeferredValue`.

**Jump to the chat.** There is no way to reach a message today. `ChatCanvas` renders every visible
message, and tool and card messages always pass its filter, so every entry has a target. `MessageRow`
gets `id="message-{id}"` and `tabIndex={-1}`. Pressing an entry stops the chat following the bottom,
calls `scrollIntoView`, and moves focus there, so the focus ring is the mark, with no timer. The jump
lands on the reply, not on a tool inside a collapsed group.

**Pressing an unreported file** opens the diff panel.

An empty session reads "Nothing yet. What the agent does shows here."

## Units

- `src/lib/activity.ts`: `activityOf`, `reportedPath`, `unreportedFiles`. Pure.
- `src/lib/visible-text.ts`: the escape, moved.
- `src/components/activity/ActivityPanel.tsx`, `ActivityEntryRow.tsx`.
- Changed: `lib/acp-events.ts`, `lib/review-comments.ts`, `types/index.ts`, `hooks/useSidePanel.ts`
  (`'activity'` reloads on opening), `hooks/useStickToBottom.ts`, `components/TopBar.tsx`,
  `components/ChatCanvas.tsx`, `components/chat/MessageRow.tsx`, `App.tsx` (wiring only).

## Copy

- **Activity**, **All**, **Files**, **Commands**, **Permissions**
- **Running**, **Did not finish**, **Failed**, **Waiting for you**, **Allowed**, **Rejected**,
  **Not answered**, **Read**, **Changed**, **Touched**
- **Not reported by the agent**
- The sentences quoted above, verbatim.

## Testing

Vitest:

- `activityOf`: each `kind`, a tool with both `locations` and a diff gives one file entry, `path:line`,
  a replayed message has no time, a card in each state, and a transcript from before `command`.
- `addToolCall` and `updateToolCall` keep `command` from a string, an array, `cmd`, and a wrong type.
- `reportedPath`: absolute, relative to a subfolder cwd, a `/tmp` cwd against a `/private/tmp` root,
  outside the repository.
- `unreportedFiles`: a completed change is not listed; a read, a failed edit and a command changing a
  file are listed; a rename matches on `oldPath`; nothing runs when targets failed or the transcript
  has not loaded.
- A declined edit that already sent its diff never reads Changed. A running tool in an idle session
  reads Did not finish.
- `updateToolCall` keeps known paths against an empty update, and a too-large diff keeps its path.
- The panel: filters and counts, the two fixed lines, escapes, no markdown, the row cap, a failed
  git read, no panel on a draft, and a jump moves focus to the message.

Real app, with the fake-agent harness: run a session that edits, runs a command and asks a
permission, plus a file changed outside the agent's report. Read the panel, jump to the chat, and
restart. The `rawInput` shapes of Claude, Gemini and Qwen are not verified, so the release's run with
real agents must read this panel too.

## Docs

README: one bullet. CHANGELOG: one `### Added` line. CLAUDE.md: an **Activity log.** paragraph: derived
from the transcript, the agent's own report, the git check, and why rewinding removes entries.
