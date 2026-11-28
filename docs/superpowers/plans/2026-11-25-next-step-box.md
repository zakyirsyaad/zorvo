# Next-Step Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the end of an agent's turn, show a box under the last reply with the agent's recap and question (from a new `wrap_up` tool), Zorvo's facts about the repository, and buttons that send a message as if typed in the composer.

**Architecture:** The agent calls `wrap_up` on Zorvo's tool server. The webview stores the result as `ChatMessage.nextStep` on the turn's last reply. A pure module (`lib/next-step.ts`) turns live facts (git stats, branch state, the session's pull request, dev-server ports) plus `nextStep` into ordered buttons. `NextStepBox` draws it, and a press goes through the composer's own `sendFromComposer`.

**Tech Stack:** Rust (Tauri 2 commands, `agent_tools`), React 19 + TypeScript, Vitest + Testing Library, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-11-25-next-step-box-design.md` (artboards `NextStepChat`, `NextStepStates` on the canvas "Zorvo redesign v2", Version 74).

## Global Constraints

- `wrap_up` limits: `recap` ≤ 300 chars (required), `ask` ≤ 100, `replies` ≤ 2 items of ≤ 24 chars, `pick` ∈ `commit | create_pr | merge | auto_merge | open_preview | open_pr`.
- Messages sent, verbatim: Commit → "Commit these changes."; Create PR → "Commit, push and open a pull request."; Merge → "Merge the pull request."; Turn on auto-merge → "Turn on auto-merge for the pull request.". A reply button sends its label. Open PR and Open in Zorvo's browser send nothing.
- At most five buttons. Order: the agent's pick (when offered), Zorvo's buttons in table order, the replies. Zorvo's buttons are cut first.
- Merge only when the PR is open, every check passed, no conflicts, and `mergeStateStatus` is `CLEAN`.
- `wrap_up` is answered with no card and no grant, text "Shown at the end of your turn."; not a worker tool; `TOOL_NAMES` becomes 12.
- Every agent string goes through `escapeVisible` before display. Facts are never stored.
- `STATE_VERSION` stays 2. Every new backend command that takes a folder calls `files::ensure_known_workspace` first and spawns git only through `spawn::command`.
- UI copy follows `docs/design-system/README.md`. Colours only from tokens. Motion: none new.
- Out of scope: a sidebar status line, Zorvo running git or gh for a button, Auto-fix, buttons in a popout.

## Review Focus

1. `wrap_up` that lands after the turn-end event has already closed the reply: it must still attach to that turn's last reply, not open a new empty reply. Test in Task 6.
2. A press while the composer holds a typed draft: the draft must stay untouched and only the button's message goes out. Test in Task 9.
3. A send the agent does not take (agent refused, sign-in needed): the box stays active and no `answered` is recorded. Test in Task 9.
4. A facts read that fails (`gh` signed out, no git repo, folder gone): chips drop out silently and the box still draws from what is known. A box with neither facts nor an agent part does not draw. Test in Task 7 and Task 8.
5. Agent strings with control, bidi or very long text: shown escaped and refused over the limits by `validate`. Tests in Task 1 and Task 6.

---

### Task 1: `wrap_up` on the tool server

**Files:**
- Modify: `src-tauri/src/agent_tools/tools.rs` (`TOOL_NAMES`, `tool_list`, `validate`, the field table near line 243, the count test near line 1006)
- Test: unit tests in the same file

**Interfaces:**
- Produces: tool `wrap_up` listed for coordinators by MCP and by `zorvo tools`; `validate("wrap_up", args)` returns `{recap, ask?, pick?, replies?}` with strings trimmed.

- [ ] **Step 1: Write the failing tests** in `tools.rs`'s test module:
  - `there_are_twelve_tools_and_wrap_up_is_one`: `TOOL_NAMES.len() == 12`, contains `"wrap_up"`; `worker_tool_list()` has no `wrap_up`.
  - `wrap_up_needs_a_recap`: `validate("wrap_up", &json!({}))` is `Err`; `json!({"recap":"  "})` is `Err`.
  - `wrap_up_caps_each_field`: recap of 301 chars, ask of 101, three replies, a reply of 25 chars, and `pick: "deploy"` are each `Err`; the message never contains the sent text.
  - `wrap_up_trims_and_keeps_its_fields`: `{"recap":" Done. ","ask":"Merge?","pick":"merge","replies":["Not yet"]}` → `Ok` with `recap == "Done."` and the rest kept.
- [ ] **Step 2: Run:** `cd src-tauri && cargo test --lib agent_tools::tools` → the four tests FAIL.
- [ ] **Step 3: Implement.** Add `"wrap_up"` to `TOOL_NAMES` (length 12); add its entry to `tool_list()` with the spec's schema and description verbatim; add `"wrap_up" => &["recap", "ask", "pick", "replies"]` to the field table; add a `"wrap_up"` arm to `validate` using the existing string-cap helpers and an enum check for `pick`.
- [ ] **Step 4: Run:** `cargo test --lib agent_tools` → PASS. Then `cargo test --test it agent_tools_` → PASS (fix any count assertion that lists eleven tools, e.g. in the CLI listing test).
- [ ] **Step 5: Commit** `feat: add the wrap_up tool for an agent's end of turn`.

### Task 2: `session_branch_state`

**Files:**
- Create: `src-tauri/src/branch_state.rs`
- Modify: `src-tauri/src/lib.rs` (`mod branch_state;`, register in `generate_handler!`)
- Test: `src-tauri/tests/it/branch_state_test.rs` (+ `mod branch_state_test;` in `tests/it/main.rs`)

**Interfaces:**
- Produces: `#[tauri::command(async)] pub fn session_branch_state(store: State<AppStore>, cwd: String) -> Result<BranchState, String>` and the pure `pub fn read_branch_state(git: &Path, dir: &Path) -> Result<BranchState, String>`.
- `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct BranchState { branch: Option<String>, upstream: Option<String>, ahead: u32, is_default_branch: bool }`. `branch` is `None` on a detached HEAD. `is_default_branch` is true for the branch `origin/HEAD` points at, else for `main` or `master` when `origin/HEAD` is unset.

- [ ] **Step 1: Write the failing tests** against a scratch repository made with `git init`:
  - `no_upstream_reads_none_and_zero_ahead`
  - `counts_commits_not_pushed` (a bare remote, push, two more commits → `ahead == 2`)
  - `main_is_the_default_branch` and `a_feature_branch_is_not`
  - `detached_head_has_no_branch`
- [ ] **Step 2: Run:** `cargo test --test it branch_state_test::` → FAIL (module missing).
- [ ] **Step 3: Implement** `read_branch_state` with `spawn::command` running `git rev-parse --abbrev-ref HEAD`, `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` (non-zero exit → `None`), `git rev-list --count @{upstream}..HEAD`, and `git symbolic-ref --quiet refs/remotes/origin/HEAD`. The command calls `files::ensure_known_workspace(&store, &cwd)` first and never returns a path.
- [ ] **Step 4: Run** the tests → PASS; `pnpm vitest run src/test/tauri-contract.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: read a session's branch, upstream and unpushed commits`.

### Task 3: A pull request's merge state

**Files:**
- Modify: `src-tauri/src/pull_requests.rs` (the `--json` field lists at lines ~296, ~408, ~612; `PullRequestStatus` at line 32; `PullRequestSummary` at line 326; their parsers)
- Modify: `src/hooks/usePullRequest.ts` (`PullRequestStatus`), the frontend parser of the list
- Test: existing `pull_requests.rs` unit tests; the frontend parser's test file

**Interfaces:**
- Produces: `PullRequestStatus.mergeState?: string` (GitHub's `mergeStateStatus`, e.g. `"CLEAN"`, `"BLOCKED"`, `"DIRTY"`, `"UNKNOWN"`), absent when `gh` gives none.

- [ ] **Step 1: Write the failing tests:** a fixture row with `"mergeStateStatus":"CLEAN"` parses to `merge_state: Some("CLEAN")`; a row without it parses to `None`; the frontend parser keeps `mergeState` only when it is a string.
- [ ] **Step 2: Run** `cargo test --lib pull_requests` and the frontend test → FAIL.
- [ ] **Step 3: Implement:** add `mergeStateStatus` to the three field lists, read it in the parsers, serialize as `mergeState`. The spec also names `mergeable`; it is not needed, since `CLEAN` already means mergeable with checks passed.
- [ ] **Step 4: Run** both → PASS.
- [ ] **Step 5: Commit** `feat: read a pull request's merge state`.

### Task 4: `lib/next-step.ts`

**Files:**
- Create: `src/lib/next-step.ts`, `src/test/next-step.test.ts`
- Modify: `src/types/index.ts` (`ChatMessage.nextStep?: NextStep`, `ChatMessage.endedNormally?: true`)

**Interfaces:**
- Produces:
  - `type NextStepAction = 'commit' | 'create_pr' | 'merge' | 'auto_merge' | 'open_preview' | 'open_pr'`
  - `interface NextStep { recap?: string; ask?: string; pick?: NextStepAction; replies?: string[]; answered?: { label: string; at: number } }`
  - `interface NextStepFacts { branch?: string; changes?: { files: number; added: number; removed: number }; ahead?: number; hasUpstream?: boolean; pr?: { number: number; url: string; state: string; checks: { passing: number; failing: number; pending: number }; mergeState?: string }; preview?: { port: number; command: string } }`
  - `type NextStepButton = { kind: 'action'; action: NextStepAction; label: string; message?: string; isPick: boolean } | { kind: 'reply'; label: string; message: string }`
  - `offeredActions(facts: NextStepFacts): NextStepAction[]` (table order)
  - `buttonsOf(step: NextStep | undefined, facts: NextStepFacts): NextStepButton[]`
  - `messageOf(action: NextStepAction): string | undefined`
  - `parseNextStep(raw: unknown): NextStep | null` (transcript and tool arguments; drops a malformed field; null when nothing is left)
  - `ACTION_LABELS: Record<NextStepAction, string>` = Commit, Create PR, Merge, Turn on auto-merge, Open in Zorvo's browser, Open PR.

- [ ] **Step 1: Write the failing tests:**
  - each row of the spec's table: uncommitted → `['commit','create_pr', …]`; ahead with no PR → `create_pr` only; PR open, `checks {passing:9,failing:0,pending:0}`, `mergeState 'CLEAN'` → includes `merge`, not `auto_merge`; pending checks → `auto_merge`, not `merge`; `mergeState 'BLOCKED'` or a failing check → neither; open PR → `open_pr`; preview → `open_preview`.
  - `buttonsOf` puts an offered pick first with `isPick: true`; drops a pick that is not offered; appends replies; caps at five, cutting Zorvo's buttons before the pick or replies.
  - `messageOf` returns the four exact sentences and `undefined` for the two open actions.
  - `parseNextStep` keeps a well-formed object, keeps `{ answered: { label: 'Create PR', at: 1 } }` alone (a Zorvo-only box that was answered), drops a 301-char recap, a fourth reply or an unknown pick, and returns null for `{}`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/next-step.test.ts` → FAIL.
- [ ] **Step 3: Implement** the module (pure, no React).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: decide the next-step box's buttons from the facts`.

### Task 5: Mark a normal turn end and keep `nextStep` in transcripts

**Files:**
- Modify: `src/lib/acp-events.ts` (`closeTurn`), `src/hooks/session-engine/useAcpEngine.ts` (the `onTurnEnd` call `updateNow(sessionId, closeTurn)` near line 266), `src/lib/persistence.ts` (`normalizeTranscript`)
- Test: `src/test/acp-events.test.ts`, `src/test/persistence.test.ts`

**Interfaces:**
- Consumes: `NextStep`, `parseNextStep` (Task 4).
- Produces: `closeTurn(messages, now = Date.now(), stopReason?: string)`; the last reply gets `endedNormally: true` only when `stopReason === 'end_turn'`.

- [ ] **Step 1: Write the failing tests:** `closeTurn(msgs, 1, 'end_turn')` marks the last reply `endedNormally`; `'cancelled'` and no reason do not; persistence keeps a valid `nextStep` and `endedNormally: true`, and drops a malformed `nextStep` and any other `endedNormally` value.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement:** the engine calls `updateNow(sessionId, (prev) => closeTurn(prev, Date.now(), error ? undefined : stopReason))`; `normalizeTranscript` gets `withValidNextStep`, written like `withValidArtifactCard`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: remember which turns ended normally`.

### Task 6: Answer `wrap_up` in the webview and tell the agent

**Files:**
- Modify: `src/hooks/useAgentTools.ts` (dispatch beside `show_visual` near line 705), `src/lib/agent-tools-context.ts` (`MCP_PATH_CONTEXT`, `COMMAND_PATH_CONTEXT`)
- Create: `src/lib/next-step-part.ts` (`withNextStep(messages, step, ctx)`)
- Test: `src/test/use-agent-tools.test.tsx` (or the file that tests `show_visual`), `src/test/next-step-part.test.ts`

**Interfaces:**
- Consumes: `parseNextStep` (Task 4), `withOpenReply`, `escapeVisible`.
- Produces: `withNextStep(messages: readonly ChatMessage[], step: NextStep, ctx: AcpReducerContext): ChatMessage[]`, which sets `nextStep` on the open reply, or, when the turn has already closed, on the last agent reply after the user's last message; a second call replaces it. Constant `WRAP_UP_SHOWN_TEXT = 'Shown at the end of your turn.'`.

- [ ] **Step 1: Write the failing tests:**
  - `withNextStep` on an open reply; on a closed last reply (Review Focus 1: no new reply is added); a second call replaces; a user message after the last reply → the step attaches to nothing and messages are unchanged.
  - The hook answers `wrap_up` with `ok: true` and `WRAP_UP_SHOWN_TEXT`, stores escaped strings (a recap holding `‮` comes out spelled, Review Focus 5), answers a worker's call with `NO_SESSION`.
  - The context strings contain "call wrap_up".
- [ ] **Step 2: Run** the test files → FAIL.
- [ ] **Step 3: Implement** the handler like `handleShowVisual` (no card, no grant, `flushUpdates` before `updateMessages`), and add the spec's sentence to both context notes, before "Do not mention this note."
- [ ] **Step 4: Run** → PASS, plus `pnpm vitest run src/test/agent-tools-context.test.ts` if it exists.
- [ ] **Step 5: Commit** `feat: show an agent's wrap_up under its last reply`.

### Task 7: `useNextStepFacts`

**Files:**
- Create: `src/hooks/useNextStepFacts.ts`
- Modify: `src/lib/background-tasks.ts` (`BackgroundTask.ports?: number[]` on shell tasks)
- Test: `src/test/use-next-step-facts.test.tsx`, `src/test/background-tasks.test.ts`

**Interfaces:**
- Consumes: `session_diff_stats` (existing), `session_branch_state` (Task 2), `PullRequestStatus.mergeState` (Task 3), `NextStepFacts` (Task 4).
- Produces: `useNextStepFacts(args: { session: Session | null; isActive: boolean; pullRequest: PullRequestStatus | null; tasks: readonly BackgroundTask[] }): NextStepFacts`. It reads when `isActive` turns true and on window focus while active; it reads nothing while inactive.

- [ ] **Step 1: Write the failing tests:** facts assembled from mocked `invoke` answers; a rejected `session_branch_state` leaves `branch`/`ahead` out and keeps the rest (Review Focus 4); no reads while inactive; a shell task's ports become `preview` with the lowest port.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; shell tasks carry `ports` from `BackgroundProcess.ports`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: read the facts for the next-step box`.

### Task 8: `NextStepBox` in the chat

**Files:**
- Create: `src/components/chat/NextStepBox.tsx`, `src/test/next-step-box.test.tsx`
- Modify: `src/components/chat/MessageRow.tsx`, `src/components/ChatCanvas.tsx` (new prop)

**Interfaces:**
- Consumes: `buttonsOf`, `ACTION_LABELS` (Task 4).
- Produces: `ChatCanvasProps.nextStep?: NextStepView | null` with `interface NextStepView { messageId: string; facts: NextStepFacts; blockedReason?: string; isSending: boolean; onPress: (button: NextStepButton) => void }`. `MessageRow` draws `NextStepBox` for a reply with `endedNormally` when it is `nextStep.messageId` (active) or has `message.nextStep` (inert).

- [ ] **Step 1: Write the failing tests** (copy from the artboards):
  - active box with an agent step: source "Next step", recap, fact chips, the question, primary button first, the line "Claude Code suggests Create PR" referenced by the primary's `aria-describedby`.
  - Zorvo-only box: source "{Agent} finished", no recap, no question.
  - nothing to show (no step, no facts) → nothing rendered (Review Focus 4).
  - `blockedReason` disables every message button and shows the reason; Open PR stays enabled.
  - inert box: buttons disabled, facts hidden, "You answered Create PR" when `answered` is set.
  - in a popout (`nextStep` prop absent, step present): recap and question, no buttons, "Answer in the main window."
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `Button` from `components/ui`, tokens only, `<section aria-label="Next step">`; the box is drawn after the reply's other parts.
- [ ] **Step 4: Run** → PASS; `pnpm vitest run src/test/design-tokens.test.ts src/test/motion.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: draw the next-step box under a finished turn`.

### Task 9: Wire it in `App`

**Files:**
- Create: `src/hooks/useNextStep.ts` (keeps `App.tsx` from growing)
- Modify: `src/App.tsx` (call the hook, pass `nextStep` to `ChatCanvas`)
- Test: `src/test/use-next-step.test.tsx`

**Interfaces:**
- Consumes: `useNextStepFacts` (Task 7), `messageOf` (Task 4), `sendFromComposer(sessionId, { text })`, which this task changes to return `Promise<boolean>` (true when the agent took the message; the existing callers ignore it), `composerNote`/`isComposerSendBlocked`, `requestBrowserOpen`, `invoke('open_external_url', { url })`, `toolsRoleOf`.
- Produces: `useNextStep(args): NextStepView | null`. Null for a worker, a compare-run session, a session not on screen, or when the last message is not an agent reply with `endedNormally`, or while the session is busy or waiting.

- [ ] **Step 1: Write the failing tests:**
  - a press of Create PR calls `sendFromComposer(id, { text: 'Commit, push and open a pull request.' })` once even when pressed twice quickly; a reply press sends its label.
  - the composer's draft is not read or cleared (Review Focus 2).
  - an accepted send records `answered: { label, at }` on the reply; a refused send records nothing and the view stays (Review Focus 3).
  - Open PR calls `open_external_url` with the PR's url and records nothing; Open in Zorvo's browser calls `requestBrowserOpen('http://localhost:5173')`.
  - a worker session and a compare-run session give `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the hook and the two lines in `App.tsx`.
- [ ] **Step 4: Run** the hook test, `src/test/acp-app.test.tsx`, and `pnpm lint` on the changed files → PASS.
- [ ] **Step 5: Commit** `feat: send a next-step button as the user's message`.

### Task 10: Docs and the full check

**Files:**
- Modify: `CHANGELOG.md` (Unreleased → Added), `CLAUDE.md` (a **Next step** paragraph after **Agent tools**; `wrap_up` added to the tool list and the count "twelve tools")

- [ ] **Step 1: Write** the CHANGELOG line: "**A next-step box at the end of a turn.** Under an agent's last reply, Zorvo shows what changed in the repository, and the agent's short recap and question. Its buttons send your answer as a message, so Commit, Create PR or Merge is one click."
- [ ] **Step 2: Run** `pnpm lint`, `pnpm vitest run` on the files changed in Tasks 3–9, and in `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` → all PASS.
- [ ] **Step 3: Commit** `docs: describe the next-step box`.
