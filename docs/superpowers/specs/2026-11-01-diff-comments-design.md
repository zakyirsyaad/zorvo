# Diff comments — design

Date: 2026-11-01
Branch: `feat/diff-comments`, from `main` at c7b37d2.

## Goal

Tell an agent exactly what to change, line by line. The user opens an agent's diff, leaves comments
on specific lines, adds them to the message in the composer, reads or edits that message, and sends
it. The agent gets each comment with its file, its line, and the line itself.

Compare agents shows numbers and lets the user pick a winner. This feature is what makes the result
something the user can direct, and it keeps Zorvo's promise: nothing reaches an agent that the user
did not see first, and nothing is lost by accident.

Success: from reading a diff to a precise instruction in the agent, without describing where the
line is in words, with no comment lost, sent to the wrong session, or attached to the wrong line.

## What is decided

- Comments reach the agent through the composer. The user sees the text, can edit it, and presses
  Send. There is no other way for a comment to go out.
- Comments survive a restart.
- Comments live in the existing diff panel, not a separate screen.
- A comment never moves. See "Keeping a comment true".

Not built: comments on a range of lines, replies or threads, a resolved state, comments on GitHub,
keyboard shortcuts.

## The flow

1. The user opens the diff panel (the top bar's Diff chip, or a compare row's numbers).
2. Moving over a row, or arrowing to it, shows one comment control. Pressing it opens a box under
   the row. The user writes and presses **Save comment**. Context rows can be commented too.
3. A saved comment shows under its row with **Edit** and **Delete**.
4. The panel's header offers **Add N comments to message**. It appends text to the composer, never
   replacing what is typed, and moves focus there.
5. The user reads it, edits it if they want, and presses Send.
6. When the agent's turn ends without an error, the comments that went out leave the list.

## Data

A comment belongs to one session. `Session.reviewComments` holds a list of:

```ts
interface ReviewComment {
  id: string;
  /** The path from the repository's root, as the diff lists it. */
  file: string;
  /** The path before a rename, for a comment on a removed line. */
  oldFile?: string;
  side: 'new' | 'old';
  /** Line number in that side's file, when the comment was written. */
  line: number;
  /** Hash of the whole line, so a long line needs no full copy. */
  lineHash: string;
  /** The line as written, cut to `MAX_QUOTE_LENGTH`. */
  quote: string;
  /** What the diff was compared with. A removed line's number depends on it. */
  target: 'head' | 'base' | 'start';
  body: string;
  createdAt: number;
}
```

Limits: `MAX_COMMENT_LENGTH` 2000, `MAX_QUOTE_LENGTH` 200, `MAX_COMMENTS_PER_SESSION` 200. At the
limit Save says why: "This session has 200 comments. Add or delete some first."

`src-tauri/src/store.rs` gets `review_comments` on `SessionRecord`, read by a lenient per-item
deserializer in the style of `lenient_worktree`. A wrong type must never fail `state.json` parsing,
because that quarantines every session. Absent means empty, and an empty list is not written.
`persistence.ts` validates it too, since `withValidFields` passes unknown fields through: it drops
bad items and enforces the limits. `STATE_VERSION` stays 2.

Fork copies nothing and continue keeps the field, as both do today.

A quote is a line of the user's code, so it can hold a secret from a file such as `.env`. It sits in
`state.json` beside transcripts, which already hold the same content, and goes to popouts in the
session snapshot, as the rest of the session does. It is never logged.

## Keeping a comment true

A comment is checked only against the diff it was written on: its `target`, its `side`, its `line`.

| Status | Means | Shown | Add N comments |
|---|---|---|---|
| Current | The row at that line has the same `lineHash` | Under its row | Included |
| Outdated | The row differs or is gone, or the target no longer lists the file | "Outdated" in the file's list, or at the top when the file is gone | Left out |
| Unknown | The diff was cut before that line (`git-changes.ts` row limit, `changes.rs` size limit) | In the file's list | Included |
| Not in this diff | The panel shows another target, so it is not checked | "Not in this diff" at the top, with a link to its target | Left out |

There is no search for the same text elsewhere. Almost a third of the non-blank lines in this
repository repeat within their file, so a search would attach a comment to the wrong line and the
message would confirm it.

An Outdated comment has its own **Add**, which prints that the line has changed. It is left out of
the count because a line the agent has already fixed should not go out by default. A Not in this diff
comment has its own **Add** too, which names the comparison it came from and claims nothing about the
line.

The panel reads the diffs of files that have comments when it opens, even in closed sections, so
each status is known. There are at most 200 comments, and the existing read limiter applies.

Comment counts come from the session, not from rendered rows.

## The message

```text
Review comments on the diff against the start of this worktree:

src/auth/login.ts:42
> if (!user) throw new Error();
Use AuthError here.

src/auth/login.ts:12 (removed line, in the earlier version)
> const retries = 3;
Keep this.
```

- The heading names the target ("the last commit", "main", "the start of this worktree") and does
  not say "your changes", since a diff can hold the user's edits too.
- A path is relative to the session's working folder, because the agent's cwd may be a subfolder. A
  file outside it gets its absolute path. `session_diff_targets` returns the repository's root and
  the folder's prefix (`git rev-parse --show-prefix`), since the frontend knows neither.
- A removed line says so, and uses `oldFile` when there is one.
- An Outdated comment added on its own adds "(this line has changed since this comment)".
- A Not in this diff comment added on its own adds "(on the diff against {target})".
- A second Add leaves out the heading when the composer already holds it.

## The composer

There is one `ComposerDock` with no key, and neither a session switch nor a new draft clears its
text. So what was added has to be tracked.

`ComposerHandle` gains `insertText(text)`, which appends after a blank line, grows the textarea, and
focuses it, and `text()`.

A new hook, `useReviewMessage`, holds in memory only, never on disk:

```ts
{ sessionId: string; blocks: { commentIds: string[]; text: string }[] }
```

- **Add** skips comments already in `blocks`, so pressing it twice does not duplicate them.
- **Which session.** While the composer still holds a block and another session is on screen, Send
  is blocked through `sendDisabled`, and `composerNote` says: "These review comments are for
  {title}. Go back to that session, or remove them." A compare draft is blocked the same way.
- **Editing.** A block counts as present only when its exact text starts a line in the composer. An
  edited block no longer counts, so its comments stay in the list and can go out again. If the user
  edits a block and then sends it from another session, that is their own text.

Nothing about this is written to disk, since composer text does not survive a restart either.

## When a comment leaves the list

Send, resume, start, the sign-in resend, retry and popout send all pass through `prompt()` in
`useAcpEngine`, and `acp_prompt` returns on write, not on acceptance. So a comment leaves on the
turn's end, not on Send.

1. When a message goes out, the comments whose blocks it holds become "sending", in memory. They
   show as sending, and Add skips them.
2. On a turn end with no error, and not an auth refusal, not cancelled, they are removed.
3. On an error, a refusal, Stop, exit or a restart, they stay.

The one failure this allows is a comment that stays after it went out, which the user deletes. A
duplicate is better than a lost instruction.

## The diff target

`session_file_diff` takes an optional `since` commit. When it is set, `changes_for` uses
`changes_since`, since the HEAD branch misses committed files. `is_commit_id` and the existence check
in `diff_stats_since` become one shared function. `ensure_known_workspace` and the changed-file check
stay.

`DiffTargetId` gains `'start'`, labelled **Start of this worktree**, because a fork shares its
source's worktree. It exists for a session with `worktree.startCommit`, and it is the default only
for a session with a `compareRunId`, so ordinary sessions keep what they show today.

`DiffViewHeader` renders its picker when there is a base or a start. `DiffView` stops forcing HEAD
when there is no base, and resolves among the targets that exist. A start commit that git can no
longer find falls back to the next target with a notice, rather than reading forever.

The top bar's Diff chip keeps counting from HEAD, so its numbers can differ from the panel's. It
stays visible when the session has comments, with their count.

## The diff panel

`FileDiff` and `DiffRows` have another caller, `ChangesPanel`, so comment controls are opt-in through
a `review` prop that only `DiffView` passes. With no session on screen, such as a new-session draft
or a compare run's panel, there is no `review` prop and no controls.

- `DiffView`'s key gains the session id. Sessions in one folder share it today, so an open box would
  save into the newly shown session.
- Rows up to 1,500 are not virtualized, and a row is 20px where an `IconButton` is 28px. So one
  floating control serves the file, shown on hover and on focus.
- Rows are keyed by index and refresh on focus, so a comment being written lives in a per-session
  map in the hook, keyed by `side:line`, not in the row.
- Each file is one Tab stop. Arrow up and down move between rows, and Enter opens the box. Rows get
  an accessible name with their line number and kind, which they lack today.
- Hunk, note, symlink and nested-repository rows take no comments, and neither do binary files.

**Add is disabled, with the reason beside it,** when no composer is mounted (`RemovedAgentPanel`) or
the composer is disabled. Add from an expanded diff collapses it, since the expanded panel hides the
composer.

An archived session keeps its comments. Its composer is mounted, and Send unarchives it as it does
today.

**Mid-turn.** Comments can be written and added while the agent works. Stop takes Send's place until
the turn ends, as it does for any draft. The diff refreshes on turn end, on focus and on reload, so a
line can become Outdated after it was commented.

## Compare

A compare row's numbers become a button: "Review {agent}'s changes". It opens that session with the
diff panel beside the chat, on **Start of this worktree**, so what the user reads matches the numbers
they picked from. A row showing "—", or no changes, has no button.

## Units

- `src/lib/review-comments.ts`: types, limits, `lineHash`, `commentStatus`, `formatMessage`. Pure.
- `src/hooks/useReviewComments.ts`: the session's comments, add, edit, delete, drafts.
- `src/hooks/useReviewMessage.ts`: blocks, ownership, sending, removal on turn end.
- `src/components/changes/LineComment.tsx`, `LineCommentBox.tsx`, `ReviewCommentsBar.tsx`.
- Changed: `DiffView`, `DiffViewHeader`, `FileDiff`, `DiffRows`, `ComposerDock`, `CompareRunRow`,
  `App.tsx` (wiring only, in a hook where it can be), `lib/persistence.ts`, `types/index.ts`,
  `lib/composer-state.ts`, `lib/diff-stats.ts`, `src-tauri/src/store.rs`, `changes.rs`,
  `diff_stats.rs`.

## Copy

- **Comment on line {n}**, **Save comment**, **Cancel**, **Edit**, **Delete**
- **Add {n} comment(s) to message**, **Add**
- **Outdated**, **Not in this diff**, **Sending**
- "This line has changed since you wrote this comment."
- "This session has 200 comments. Add or delete some first."
- "These review comments are for {title}. Go back to that session, or remove them."
- "There is no message box for this session, so comments cannot be added."
- **Review {agent}'s changes**, **Start of this worktree**

## Testing

Vitest:

- `commentStatus` for each row of the status table, including a duplicate line in another place,
  which must read Outdated and never move.
- `formatMessage`: a subfolder cwd, a file outside it, a removed line, a rename, a stale comment, a
  second Add without the heading.
- Add twice inserts once, and keeps what was typed.
- Two comments with the same body, and paths where one ends with the other, each go out and leave
  correctly.
- A block for session A blocks Send in session B and in a compare draft.
- An edited block's comments stay in the list.
- Comments leave only on a clean turn end, and stay on a failed send, a refusal, Stop and exit.
- A corrupt `reviewComments` drops bad items and keeps the session.
- `ChangesPanel` shows no controls. A draft shows no controls.
- Switching sessions with a box open saves nothing to the other session.
- A focus refresh keeps a comment being written.

Rust: `file_diff` with `since` covers committed, uncommitted and untracked files, refuses a bad
commit id, and matches `diff_stats_since`. A bad `reviewComments` loads as an empty list without
quarantining the state. `session_diff_targets` reports the root and prefix from a subfolder.

Real app, with the fake-agent harness: from a compare row into the diff, comment on an added and a
removed line, add, edit, send, and read what the agent received. Then restart and see a saved comment
return, and change a commented line and see it go Outdated.

## Docs

README: one bullet under "What you can do". CHANGELOG: one `### Added` line. CLAUDE.md: a **Diff
comments.** paragraph with the status table's rule, why a comment never moves, why comments leave on
the turn's end, and what `useReviewMessage` holds and why it stays in memory.
