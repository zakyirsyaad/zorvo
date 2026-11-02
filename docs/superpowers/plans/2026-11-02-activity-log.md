# Activity log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only side panel showing, per session, the files an agent reported, the commands it ran, the permissions asked and answered, and the changed files it did not report.

**Architecture:** A pure library derives entries from the transcript and checks them against git stats. A new `activity` side panel renders them. The only data change is `ToolExecution.command`, and known paths surviving tool updates.

**Tech Stack:** React 19, Tailwind 4, Vitest, pnpm. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-11-02-activity-log-design.md`

## Global Constraints

- No Rust change, and `useAcpEngine.ts` does not change.
- `MAX_COMMAND_LENGTH` 2000, `MAX_ACTIVITY_ROWS` 500, 100 rows of Not reported.
- A row never claims more than the agent reported. **Changed** needs a `completed` tool.
- No check against git unless targets and stats loaded without failure, and the transcript has loaded.
- Text only: never markdown or links. Commands, prompts, choices and paths pass through the visible escape.
- No keyboard shortcuts. Everything stays on this Mac.
- Design rules from `CLAUDE.md`: tokens only, `ui/` primitives first, `focus-ring` on every focusable control, sentence case. Copy is verbatim from the spec.
- Test names below are labels. Write Vitest names as sentences.
- Conventional Commits. Stage explicit paths. `App.tsx` gets wiring only.

## Review Focus

1. A declined edit whose diff arrived before the refusal: it never reads Changed, and its file reads as unreported if git shows it. (Task 2)
2. A file an agent read and a command then rewrote: it is listed as not reported. (Task 2)
3. A `/tmp` cwd against a `/private/tmp` root, and a rename: a reported file is not listed as unreported. (Task 2)
4. A transcript still loading, a failed target read, and a `historyElsewhere` session: no false "not reported" list and no false "Nothing yet". (Task 3)
5. A command holding a bidi control or a newline: it reads as what it is, one row, with its lines kept. (Task 3)

---

### Task 1: Keep the data: commands and paths

**Files:**
- Create: `src/lib/visible-text.ts`
- Modify: `src/lib/acp-events.ts`, `src/lib/review-comments.ts`, `src/types/index.ts`, `src/components/chat/ToolDetails.tsx`
- Test: `src/test/acp-events.test.ts`, `src/test/visible-text.test.ts`, `src/test/review-comments.test.ts`

**Interfaces:**
- Produces:
  - `ToolExecution.command?: string`.
  - `ToolDetail` gains `{ kind: 'changed'; path: string }`, for a diff too large to keep.
  - `escapeVisible(text: string): string` in `lib/visible-text.ts`, adding U+200B-200D and U+FEFF to the set.
  - `export const MAX_COMMAND_LENGTH = 2000`, and `commandOf(rawInput: unknown): string | undefined` in `acp-events.ts`.

- [ ] **Step 1: Write the failing tests**

- `keeps a command from a string`, `from an array, quoting an element with a space`, `from cmd`, on both `tool_call` and `tool_call_update`. A number gives none. 2500 characters give 2000 ending with `…`.
- `an update with empty locations keeps the known ones`, and `an update with empty content keeps the known details`.
- `a diff over the limit stays a changed detail with its path`.
- `escapes zero-width characters`. The Task 2 of diff comments tests in `review-comments.test.ts` still pass unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/acp-events.test.ts src/test/visible-text.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`updateToolCall` treats an empty array from `toLocations` or `toDetails` as absent. `ToolDetails.tsx` renders `changed` as `Changed {path} (too large to show)`, as the text detail read before. Move `ESCAPED` and `escapeVisible` out of `review-comments.ts`, which imports them.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat: keep a tool's command and known paths`

---

### Task 2: The rules

**Files:**
- Create: `src/lib/activity.ts`
- Test: `src/test/activity.test.ts`

**Interfaces:**
- Consumes: `ToolExecution.command`, `ToolDetail` `changed`, `DiffTargets`, `FileStat`.
- Produces:

```ts
export type ActivityEntry = /* as in the spec's "The list" */;
export interface ActivityList { entries: ActivityEntry[]; otherTools: number }
export function activityOf(messages: readonly ChatMessage[]): ActivityList;
export function reportedPath(path: string, cwd: string, targets: Pick<DiffTargets, 'root' | 'prefix'>): string | null; // null outside the repository
export function unreportedFiles(entries: readonly ActivityEntry[], stats: readonly FileStat[], targets: Pick<DiffTargets, 'root' | 'prefix'>, cwd: string): string[];
export function statusWord(entry: ActivityEntry, isBusy: boolean): string;
```

Cache each message's entries in a module `WeakMap<ChatMessage, ...>`. `statusWord` holds the row rule: **Changed**, **Read** and **Touched** only at `completed`; `running` is **Running** when `isBusy`, else **Did not finish**; `failed` is **Failed**; a permission is **Waiting for you**, **Allowed**, **Rejected** or **Not answered**.

- [ ] **Step 1: Write the failing tests**

Each bullet of the spec's "The list":
- `a tool with locations and a diff of one file gives one entry`, and the `:line` suffix is dropped.
- `action follows kind`, for edit, delete, move, read, search, other.
- `an edit naming no file gives an entry from its name`.
- `an execute tool gives a command entry and touched files`, using `command`, else `name`.
- `a tool with no file is counted in otherTools`.
- `a card reads waiting, allowed, rejected and unanswered`. A `chosenOptionId` of a reject option gives `rejected`.
- `order is message, tools, then card`. `a replayed message has no time`. `a tool with no startedAt uses the message's time`.
- `a command of the wrong type is ignored`.

`statusWord`: `a failed edit with a diff never reads Changed`; `a running tool in an idle session reads Did not finish`.

`reportedPath`: absolute, relative with `prefix: 'sub/'`, `cwd` `/tmp/r` with `root` `/private/tmp/r`, and outside gives null.

`unreportedFiles`:
- `a completed change is not listed`.
- `a read is listed`, `a failed edit is listed`, `a command changing a named file is not listed when it is touched and completed`.
- `a rename matches on oldPath`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/activity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** in `src/lib/activity.ts`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run src/test/activity.test.ts && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat: derive a session's activity from its transcript`

---

### Task 3: The panel

**Files:**
- Create: `src/components/activity/ActivityPanel.tsx`, `ActivityEntryRow.tsx`
- Modify: `src/hooks/useSidePanel.ts`, `src/hooks/useDiffStats.ts`, `src/components/TopBar.tsx`, `src/App.tsx`
- Test: `src/test/activity-panel.test.tsx`, `src/test/top-bar.test.tsx`

**Interfaces:**
- Consumes: Task 2, `escapeVisible`, `useDiffTargets`, `useDiffStatsSince`.
- Produces:
  - `SidePanel` gains `'activity'`, and `show('activity')` reloads when opening.
  - `SidePanelState.headStatsFailed: boolean`.
  - `ActivityPanel` props: `messages: readonly ChatMessage[] | undefined` (undefined while loading), `session: Session`, `isBusy: boolean`, `version: number`, `headStats`, `headStatsFailed`, `onJump: (messageId: string) => void`, `onOpenDiff: () => void`, `onClose: () => void`.

Key `ActivityPanel` by session id in `App.tsx`. Use `sidePanel.headStats` for `head`, and `useDiffStatsSince` with `onFailed` only for a session with `worktree.startCommit`, passing an `onError` that does nothing, so a failure shows only in the panel.

- [ ] **Step 1: Write the failing tests**

- `filters narrow the rows and each shows its count`. Counts ignore the cap.
- `the two fixed lines always show`.
- `reads the activity while the transcript loads`: `Reading the activity…`, and no check.
- `an empty session reads Nothing yet`.
- `lists a file git shows and the agent did not, with the sentence`, and `says what it compared`, for both targets.
- `says Nothing unreported`.
- `says Could not check against git`, on a failed stats read and a failed target read, with no list.
- `a historyElsewhere session is not checked`, with its sentence.
- `caps rows at 500 after the filter`, with the older-entries line, and Not reported at 100 with `{n} more.`
- `shows the not listed tool calls`.
- `escapes a bidi control in a command`. `keeps a multi-line command's lines and clamps to 3 until opened`. `renders markdown as text`.
- `opens from the top bar for a session, not for a draft or a run's panel`.
- `resets the filter on a session switch`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/activity-panel.test.tsx src/test/top-bar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rows are `memo`, and the list goes through `useDeferredValue`. `onJump` and `onOpenDiff` are wired in Task 4, so entries are buttons calling them. Check the row in a real scroll container at 500 rows.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat: show a session's activity in a side panel`

---

### Task 4: Jump to the chat, proof, docs

**Files:**
- Modify: `src/hooks/useStickToBottom.ts`, `src/components/ChatCanvas.tsx`, `src/components/chat/MessageRow.tsx`, `src/App.tsx`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`
- Test: `src/test/chat-canvas.test.tsx`, `src/test/activity-panel.test.tsx`

**Interfaces:**
- Consumes: `onJump`, `onOpenDiff`.
- Produces:
  - `StickToBottom.stopFollowing: () => void`.
  - `ChatCanvas` prop `jumpTo?: { messageId: string; nonce: number } | null`, acted on in an effect.
  - `MessageRow` root gets `id="message-{id}"` and `tabIndex={-1}`.

- [ ] **Step 1: Write the failing tests**

- `a jump stops following and moves focus to the message`: new output after the jump does not move the view.
- `a second jump to the same message works`, through `nonce`.
- `pressing an unreported file opens the diff`.
- Focus on a message shows `focus-ring`, and no timer runs.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/chat-canvas.test.tsx src/test/activity-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement, run them to verify they pass, and commit**

`feat: jump from an activity entry to its message`

- [ ] **Step 4: Prove it in the real app**

Use the harness recipe in `real-app-e2e-harness.md`, with a scratch `HOME`, real `state.json` mtimes unchanged. Show as output: a session that edits, runs a command and asks a permission; a file changed outside its report listed as not reported; a declined edit not reading Changed; a jump to the chat in WKWebView while the agent streams; restart. Fix what this finds, test first, in its own `fix:` commit.

- [ ] **Step 5: Write the docs**

README: one bullet under "What you can do". CHANGELOG: one `### Added` line. CLAUDE.md: an **Activity log.** paragraph, as the spec's Docs section says.

- [ ] **Step 6: Run every check**

Run: `pnpm lint && pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

`docs: describe the activity log`
