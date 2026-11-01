# Compare agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One prompt goes to two to four agents, each in its own worktree, and a summary panel lets the user answer them and pick the winner.

**Architecture:** A run is not stored: it is the listed sessions that share `compareRunId`. Pure logic lives in `lib/compare-run.ts`, the actions in `hooks/useCompareRun.ts`, and the panel takes the chat's place while `activeRunId` is set. Two small Rust commands count changes from a recorded start commit and re-root attachments into a worktree.

**Tech Stack:** React 19, Tailwind 4, Vitest and Testing Library; Tauri 2, Rust.

**Spec:** `docs/superpowers/specs/2026-11-01-compare-agents-design.md`

## Global Constraints

- `MAX_COMPARE_AGENTS = 4`. A run has at least 2 agents.
- A group shows while two or more **listed** sessions share `compareRunId`.
- `STATE_VERSION` stays 2. No migration.
- The webview sends ids and folders, never a command. Every new command that takes a folder calls `files::ensure_known_workspace` first, and is `#[tauri::command(async)]`.
- `commit` is 40 or 64 hex characters and passes `git cat-file -e <commit>^{commit}` before any other git use.
- Nothing answers a permission for the user. Agents start in their safest mode through the existing path (`applySafeMode`).
- Design system: tokens only, `src/components/ui/` primitives, `focus-ring` on every focusable control, sentence case, address the user as "you".
- Copy, verbatim: `Runs in ${n} worktrees. Each agent uses its own quota.` · `Stop ${n} agents and keep ${agent}'s work?` · `Compare finished: ${n} agents are done.`
- Status labels, verbatim: Starting, Working, Needs you, Needs sign-in, Failed, Done, Stopped.
- Prefer a hook or `lib/` helper over growing `App.tsx`. New Rust integration test files need a `mod` line in `tests/it/main.rs`.
- Stage explicit paths, never `git add -A`: other sessions share this checkout.
- Before the first commit, also stage this plan and the spec.

## Review Focus

- **An agent's process dies mid-run.** The row reads Failed, Pick still works on it and on the others, and archiving it does not hang. Test in Task 7.
- **The user opens another session while worktrees are being made.** Focus stays where they went, the run still starts, and the message is not lost. Test in Task 6.
- **A permission is answered in the chat while the row shows it.** The row drops it, and pressing a stale option does nothing rather than answering a later request. Test in Task 7.
- **A start commit is gone, or a worktree folder was deleted by hand.** That row shows `—` in Changes, reports once, and the panel keeps working. Test in Task 2 and Task 7.
- **A session in a run is forked or rewound.** A fork gets no `compareRunId`, so it is an ordinary session outside the group. Test in Task 6.

---

### Task 1: Persist the two new fields

**Files:**
- Modify: `src-tauri/src/store.rs:126-182`, `src/types/index.ts:105-131`, `src/lib/persistence.ts:53-72`, `src/lib/session-start.ts:27-46`
- Test: `src-tauri/tests/it/store_test.rs` (or the existing store test module), `src/test/persistence.test.ts`

**Interfaces:**
- Produces: `Session.compareRunId?: string | null`, `SessionWorktree.startCommit?: string`, `SessionSpec.compareRunId?: string | null`

- [ ] **Step 1: Write failing tests**

Rust: `session_record_keeps_compare_run_id_and_start_commit` (a record round-trips through serde JSON with both), `a_bad_compare_run_id_drops_the_field_not_the_session` (`compareRunId: 7` gives `None` and the rest stays), `a_worktree_saved_before_start_commit_loads` (no `startCommit` key gives `None`).
TS, in `persistence.test.ts`: `keeps a session's compareRunId and worktree startCommit`, `drops a compareRunId that is not a string`, `keeps a worktree whose startCommit is missing`, `drops a startCommit that is not a string and keeps the worktree`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd src-tauri && cargo test --test it store_test::` and `pnpm vitest run src/test/persistence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the fields**

`SessionRecord.compare_run_id: Option<String>` with a `lenient_*` deserializer like its neighbours (add `lenient_string` if none fits). `SessionWorktreeRecord.start_commit: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`. In `lib/persistence.ts`, destructure `compareRunId` out of `rest` and keep it only when it is a string or null; `isWorktree` accepts a missing `startCommit`, and a non-string one is removed. `newSessionRecord` copies `compareRunId`.

- [ ] **Step 4: Run them and see them pass**

Same commands. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: persist a session's compare run and its worktree's start commit`

### Task 2: Count changes from the start commit

**Files:**
- Modify: `src-tauri/src/worktrees.rs:30-36,244-272`, `src-tauri/src/diff_stats.rs:458-480`, `src-tauri/src/lib.rs:431`, `src/lib/session-worktree.ts`, `src/hooks/useDiffStats.ts`, `src/test/setup.ts`
- Test: `src-tauri/tests/it/` (a new `diff_since_test.rs` with its `mod` line), `src/test/diff-stats.test.tsx`

**Interfaces:**
- Consumes: `SessionWorktree.startCommit`
- Produces: Rust `diff_stats_since(git: &Path, dir: &Path, commit: &str) -> Result<Vec<FileStat>, String>`; command `session_diff_stats_since(path: String, commit: String)`; TS `useDiffStatsSince(path: string | undefined, commit: string | undefined, version: number, onError: (message: string) => void): DiffStats`; `createSessionWorktree` returns `worktree.startCommit`

- [ ] **Step 1: Write failing tests**

Rust: `counts_commits_and_uncommitted_changes_from_a_feature_branch` (repo with a feature branch ahead of main, worktree from it, one committed and one uncommitted change: exactly those two files), `counts_an_untracked_file`, `refuses_a_commit_that_is_not_hex` (`"HEAD"`, `"--all"`, `"abc"`), `refuses_a_commit_the_repository_does_not_have`, `create_worktree_reports_the_commit_it_started_from`.
TS: `useDiffStatsSince reads session_diff_stats_since with the commit`, `reads nothing without a commit`, `reports a failure once per folder`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd src-tauri && cargo test --test it diff_since_test::` and `pnpm vitest run src/test/diff-stats.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`SessionWorktree` gains `start_commit: String`, read with `git rev-parse HEAD` in the new worktree. Extract the shared part of `diff_stats` into a private `stats_against(git, toplevel, base, target)`. `untracked_stats` takes the target today: pass `DiffTarget::Head`, so untracked files count once. Validate the hash with a small `is_commit_id(&str) -> bool`, then `cat-file`. Register the command in `lib.rs`. `useDiffStatsSince` shares `useDiffStats`'s body through one internal hook. Fake the command in `src/test/setup.ts`.

- [ ] **Step 4: Run them and see them pass**

Same commands, plus `cargo clippy --all-targets -- -D warnings`. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: count a worktree's changes from the commit it started at`

### Task 3: Keep attachments inside the worktree

**Files:**
- Create: `src-tauri/src/attachment_paths.rs`
- Modify: `src-tauri/src/lib.rs`, `src/lib/session-worktree.ts`, `src/App.tsx:414-447`, `src/test/setup.ts`
- Test: `src-tauri/src/attachment_paths.rs` (`#[cfg(test)]`), `src/test/session-worktree.test.ts`

**Interfaces:**
- Produces: command `worktree_attachment_paths(repo_path: String, cwd: String, paths: Vec<String>) -> Result<Vec<String>, String>`; TS `attachmentsFor(repoPath: string, cwd: string, attachments: readonly string[] | undefined): Promise<readonly string[] | undefined>`

- [ ] **Step 1: Write failing tests**

Rust: `re_roots_a_file_inside_the_repository`, `leaves_a_file_outside_the_repository`, `leaves_a_file_the_worktree_does_not_have`, `re_roots_from_a_subfolder_workspace` (`cwd` is a subfolder of the worktree root), `does_not_treat_a_sibling_folder_as_inside` (`/w/repo-two/a` with repo `/w/repo`), `refuses_an_unknown_folder`.
TS: `attachmentsFor asks the backend only when there are attachments`, and in `src/test/chrome-wiring.test.tsx` `a worktree session's attachment points into its worktree`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd src-tauri && cargo test attachment_paths::` and `pnpm vitest run src/test/session-worktree.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Compare canonical paths with `Path::strip_prefix`, never string prefixes. A pure `re_root(repo: &Path, cwd: &Path, path: &Path) -> PathBuf` carries the logic. In `handleNewSession`, after the worktree is made, replace `first.attachments` with `await attachmentsFor(...)` before `startSession`; a failure leaves them unchanged and shows the notice.

- [ ] **Step 4: Run them and see them pass**

Same commands. Expected: PASS.

- [ ] **Step 5: Commit**

`fix: point a worktree session's attachments into its worktree`

### Task 4: The run's logic

**Files:**
- Create: `src/lib/compare-run.ts`
- Test: `src/test/compare-run.test.ts`

**Interfaces:**
- Consumes: `Session`, `isListed`, `ChatMessage`, `ActionCard`
- Produces:

```ts
export const MAX_COMPARE_AGENTS = 4;
export type RunRowStatus = 'starting' | 'working' | 'needs-you' | 'needs-sign-in' | 'failed' | 'done' | 'stopped';
export interface CompareRun { id: string; name: string; sessions: Session[] }
export interface RowFacts { session: Session; isBusy: boolean; hasStarted: boolean; pendingCard: ActionCard | null; hasOpenForm: boolean; needsSignIn: boolean; failed: boolean }

export function compareRuns(sessions: readonly Session[]): CompareRun[];
export function runOf(sessions: readonly Session[], runId: string): CompareRun | null;
export function rowStatus(facts: RowFacts): RunRowStatus;
export function statusLabel(status: RunRowStatus): string;
export function isRunSettled(statuses: readonly RunRowStatus[]): boolean;
export function othersToStop(run: CompareRun, winnerId: string, isBusy: (id: string) => boolean): Session[];
export function pendingPermission(messages: readonly ChatMessage[]): ActionCard | null;
export function pickableAgentIds(selected: readonly string[], agentId: string): string[];
```

- [ ] **Step 1: Write failing tests**

`compareRuns groups listed sessions by run id, in createdAt order`; `is no run with one listed session`; `leaves archived sessions out`; `ignores sessions without a run id`; `rowStatus puts sign-in before permission, permission before busy, failed before done`; `reads stopped for an ended session that was not failed`; `isRunSettled is false while any row is starting, working or needs you`; `othersToStop leaves out the winner and sessions already stopped`; `pendingPermission finds the last unanswered card and skips answered ones`; `pickableAgentIds toggles, and stops at MAX_COMPARE_AGENTS`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/test/compare-run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/compare-run.ts`**

Pure functions over the types above, no React and no `invoke`. `statusLabel` returns the verbatim labels.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: add the logic of a compare run`

### Task 5: Pick several agents in the composer

**Files:**
- Create: `src/components/composer/AgentMultiPicker.tsx`, `src/hooks/useCompareDraft.ts`
- Modify: `src/components/ComposerDock.tsx:316-323`, `src/App.tsx:171-189,846-858`, `src/lib/composer-state.ts`, `src/lib/composer-controls.ts`
- Test: `src/test/compare-composer.test.tsx`

**Interfaces:**
- Consumes: `MAX_COMPARE_AGENTS`, `pickableAgentIds`
- Produces: `useCompareDraft({ primaryAgentId, isRepository }) => { agentIds: string[]; isCompare: boolean; toggle(agentId: string): void; reset(): void }`; `AgentMultiPicker` props `{ options: { value: string; label: string; disabledReason?: string }[]; selected: readonly string[]; isOpen: boolean; onToggle(): void; onChange(agentId: string): void }`; `composerNote` takes `compareCount?: number`

- [ ] **Step 1: Write failing tests**

`ticking a second agent shows the quota note` (exact copy, n=2); `hides the permission, model and effort chips and the slash menu, and brings them back at one agent`; `turns Worktree on and keeps it on while two are ticked`; `cannot tick a fifth agent`; `an agent reading Sign in cannot be ticked and says why`; `an uninstalled agent cannot be ticked and says why`; `a Not checked agent can be ticked`; `outside a repository the chip stays single-choice`; `one agent works as it does today` (the existing composer tests still pass).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/test/compare-composer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`AgentMultiPicker` follows `OptionDropdown`'s markup with checkbox rows, keyboard behaviour and `focus-ring`. A row with `disabledReason` shows it as its description. `App.tsx` builds the options from `pickableAgents`, `useAgentSignInStatus` and `isAgentRunnable`. While `isCompare`, `controls` is empty, `commands` is empty, the draft probe is skipped, and `sendDisabled` ignores `draftNeedsSignIn` and `draftNeedsInstall`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run src/test/compare-composer.test.tsx src/test/composer` and `pnpm lint`. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: pick several agents in the composer`

### Task 6: Start a run

**Files:**
- Create: `src/hooks/useCompareRun.ts`
- Modify: `src/App.tsx:403-447,560-625`, `src/hooks/useSessionFork.ts` (only if it would copy the field)
- Test: `src/test/compare-run-start.test.tsx`

**Interfaces:**
- Consumes: `createSessionWorktree`, `attachmentsFor`, `withPreferred`, `useCompareDraft`
- Produces: `startSession(spec, first, options?: { choices?: AcpChoices; focus?: boolean })`; `useCompareRun(deps) => { startRun(agents: AgentProfile[], first: FirstMessage): Promise<void> }`; `activeRunId: string | null`, `openRun(runId: string)`

- [ ] **Step 1: Write failing tests**

`makes one worktree and one session per agent, one at a time` (the second `create_session_worktree` starts after the first resolves); `all sessions share one compareRunId and carry startCommit`; `each agent gets its own remembered choices` (a model of agent A never reaches agent B's `acp_set_model`); `each agent's attachments point into its own worktree`; `opens the panel and stays there`; `keeps the session the user opened meanwhile`; `a worktree failing for one agent skips it and names it`; `one session started is a normal session with no compareRunId and no panel`; `no session started puts the message back in the composer`; `a fork of a run's session has no compareRunId`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/test/compare-run-start.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

The run id is `crypto.randomUUID()`. Sessions are created after all worktrees exist, so a run that ends with one session gets no id. `startSession` keeps its behaviour with no `options`; `focus: false` skips `setActiveSessionId`, and `choices` replaces `startChoices`. `setAcpChoices(NO_CHOICES)` and `branchPicker.reset()` run once, after the run. `openRun` is called only if `activeSessionId` is still the draft. `handleSendMessage` calls `startRun` when `isCompare`.

- [ ] **Step 4: Run them and see them pass**

Same command, plus `pnpm vitest run src/test/chrome-wiring.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: start one prompt on several agents`

### Task 7: The panel and Pick

**Files:**
- Create: `src/components/compare/CompareRunPanel.tsx`, `src/components/compare/CompareRunRow.tsx`
- Modify: `src/hooks/useCompareRun.ts`, `src/App.tsx:760-805`
- Test: `src/test/compare-run-panel.test.tsx`

**Interfaces:**
- Consumes: `CompareRun`, `rowStatus`, `pendingPermission`, `othersToStop`, `useDiffStatsSince`, `ActionCard` component, `archiveSession`, `chooseOption`
- Produces: `CompareRunPanel` props `{ run: CompareRun; rows: RowFacts[]; version: number; onOpen(sessionId: string): void; onChoose(sessionId: string, cardId: string, optionId: string): void; onPick(winnerId: string): void }`; `useCompareRun` gains `pick(run: CompareRun, winnerId: string): Promise<void>`

- [ ] **Step 1: Write failing tests**

`shows each status with its label`; `shows files, added and removed from useDiffStatsSince`; `shows — when the diff cannot be read and keeps the other rows`; `a permission request shows the agent's own options in the row`; `answering it calls chooseOption for that session`; `a request answered in the chat leaves the row`; `a stale option press does nothing`; `a form reads Needs you and the row opens the chat`; `Pick with nothing running stops nothing and asks nothing`; `Pick with two running asks with the exact copy, and Cancel changes nothing`; `Pick archives the others and opens the winner`; `an agent that cannot be stopped stays listed, is named, and the group stays`; `a failed agent can be picked and archived`; `numbers refresh when a turn ends`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/test/compare-run-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

A row is a bordered list row, not a card. It reuses `ActionCard` unchanged for the request, so risky options look the same. The stale guard is `acp.chooseOption`'s own check of the card's state: confirm it ignores an answered card, and add that test in the engine's tests if not. Pick confirms with the existing dialog primitive, archives losers one at a time through `archiveSession`, then `setActiveSessionId(winnerId)` and `activeRunId = null` only if none stayed listed. `version` is a counter `App.tsx` bumps from `onAttention` when `reason` is `finished` or `failed`.

- [ ] **Step 4: Run them and see them pass**

Same command, plus `pnpm lint`. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: compare a run's agents in one panel and pick a winner`

### Task 8: The group in the sidebar

**Files:**
- Modify: `src/components/sidebar/SessionList.tsx:271`, `src/lib/session-helpers.ts:93`, `src/components/Sidebar.tsx`, `src/App.tsx`
- Test: `src/test/sidebar-compare.test.tsx`

**Interfaces:**
- Consumes: `compareRuns`, `openRun`, `activeRunId`
- Produces: `SessionNode` gains `run?: CompareRun`; `Sidebar` prop `onOpenRun(runId: string): void`

- [ ] **Step 1: Write failing tests**

`a run shows as one group with a row per agent`; `clicking the group opens the panel`; `clicking a row opens that chat`; `with one listed session left it is a plain row`; `a run's sessions are not listed twice under Pinned`; `the group is marked current while its panel is open`; `a session outside a run renders as it did`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/test/sidebar-compare.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Fold the run into `forkTree`'s node list so existing rows stay as they are. Child rows show the agent's name, not the shared session title.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: show a compare run as one group in the sidebar`

### Task 9: Sign-in and notifications inside a run

**Files:**
- Modify: `src/hooks/useCompareRun.ts`, `src/App.tsx:306-327`
- Test: `src/test/compare-run-sign-in.test.tsx`

**Interfaces:**
- Consumes: `onAuthRequired`, `requestSignIn`, `retryAfterSignIn`, `notifyAttention`, `isRunSettled`
- Produces: `useCompareRun` gains `signInNeeded: ReadonlyMap<string, { methods: AuthMethod[]; unsent?: FirstMessage }>` and `takeSignIn(sessionId: string): void`

- [ ] **Step 1: Write failing tests**

`a refused session in a run takes no sign-in slot and puts nothing in the composer`; `the row reads Needs sign-in`; `two refusals in one tick give two rows`; `opening the row asks for that agent's sign-in, and a good sign-in sends its message`; `a draft's open sign-in is left alone when a run's session is refused`; `when another sign-in runs, opening the row says so`; `a session outside a run signs in as it did`; `a run's session sends no finished notification`; `one notification when all have settled`, with the exact copy; `a needs-answer notification still comes one by one`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/test/compare-run-sign-in.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `App.tsx`'s `onAuthRequired`, a session with `compareRunId` goes to `useCompareRun`, which keeps `{ methods, unsent }` in `signInNeeded`. Opening that row calls `takeSignIn`, which runs today's `requestSignIn` path with the kept message, and `onSignInBlocked` when it returns false. `notifyAttention` skips `finished` for a run's session; `useCompareRun` sends the one notice when `isRunSettled` turns true, once per run.

- [ ] **Step 4: Run them and see them pass**

Same command, plus `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

`feat: handle sign-in and notifications inside a compare run`

### Task 10: Prove it end to end and document it

**Files:**
- Modify: `README.md` ("What you can do"), `CHANGELOG.md` (`Unreleased`, `### Added`), `CLAUDE.md` (a **Compare agents.** paragraph under Architecture), `src-tauri/tests/fixtures/fake_acp_agent.mjs` (only if a flag is missing)
- Test: `src-tauri/tests/it/` as needed

- [ ] **Step 1: Run the feature with two fake agents**

Run `pnpm tauri dev` with two `FAKE_ACP` agents in a git repository. From Send to Pick: both worktrees exist, each row's numbers match `git diff --stat <startCommit>` in its worktree, a permission answered in a row reaches that agent, and after Pick only the winner is listed and the loser's worktree still holds its work. Restart the app with a run open: the rows read Stopped and each opens its chat.

- [ ] **Step 2: Write the docs**

README: one bullet, "Compare agents", saying each works in its own worktree and each uses its own quota. CHANGELOG: one `### Added` line. CLAUDE.md: where the run lives (`compareRunId`, `lib/compare-run.ts`, `useCompareRun`), why nothing is stored, and the `authRequest` rule.

- [ ] **Step 3: Run every check**

Run: `pnpm lint && pnpm test`, and in `src-tauri/`: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: all pass.

- [ ] **Step 4: Commit**

`docs: describe comparing agents`

- [ ] **Step 5: Review before the push**

Give a fresh reviewer the diff only, and ask them to trace `authRequest` interleavings: a run starting while a draft's sign-in is open, two refusals in one tick, and Settings' sweep during a run. Fix what it finds, then open the pull request.
