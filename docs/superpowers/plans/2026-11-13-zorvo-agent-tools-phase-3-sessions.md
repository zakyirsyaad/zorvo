# Zorvo agent tools, phase 3 (independent sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can call `start_session` to open an independent session of an agent from a brief, in its own folder, in a worktree of its own, or in another folder Zorvo knows.

**Architecture:** Phase 2 already answers `agent-tool-call` in `useAgentTools`, with a grant per session behind a card Zorvo makes. This phase adds one tool to that handler. An independent session is an ordinary session that records who opened it (`Session.openedBy`); it sends no reports and gets no tools itself. The rules are pure functions in `src/lib/agent-tools.ts`; a small hook starts the session through the same `startSession` and `createSessionWorktree` a user's own new session uses. A session in another folder never rides on the grant: it shows its own card every time, with Allow once.

**Tech Stack:** React 19 hooks, TypeScript, Vitest and Testing Library; one Rust change (`store.rs`, to keep `openedBy`).

**Spec:** `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md`: "Tools" (`start_session`, `list_agents`), "Approval" (the folder card), "UI" ("Opened by"), "Security". `read_session`, `stop_session` and handles are phase 4: `start_session` returns no handle yet.

## Global Constraints

- An agent sends an agent id or name, a brief, and optionally a title, `worktree: true` and a `folder`. It never sends a branch name, a worktree path, a mode, a model or a session id.
- `folder` must be, character for character after trimming one trailing slash, the `path` of a workspace in Zorvo's folder list, and not the caller's own folder. No normalising, no `..`, no symlink resolving in the webview: anything else is refused. The backend's `ensure_known_workspace` checks again when the session starts.
- `brief`: the backend already trims it, caps it at 20,000 characters and refuses a leading `/`; `title` at most 60 characters. The webview does not repeat those checks. Everything the card shows goes through the card's `visibleTask` (line breaks kept, other control and bidi characters spelled out).
- At most 3 sessions opened by the same session may be in a turn at once. The count is held synchronously: three calls in one tick open three, the fourth is refused.
- A session an agent opened gets no tools (`sessionGetsAgentTools` false for any `openedBy`), so it cannot open sessions. It is not a delegate: no handoff file, no report, no line under its opener's chat.
- The new session is never selected: the user stays where they are.
- The grant from phase 2 covers `start_session` in the caller's own folder (with or without `worktree`). A `folder` call shows a card every time, grant or not, with **Allow once** and **Deny**, and never creates or widens a grant.
- Card titles, exactly: `{Caller} wants to open a {Target} session`; with a folder, `{Caller} wants to open a {Target} session in another folder`.
- Answered to the agent on success: `JSON.stringify({ opened: true, session: <title>, folder: <path>, note: 'It works on its own and does not report back.' })`.
- Brief text and arguments are never logged and never put in a notice or in an error sent to the agent.
- `STATE_VERSION` stays 2; `openedBy` is optional and read leniently in `persistence.ts` and `store.rs`.
- UI copy follows `docs/design-system/README.md`; no raw colours; the v2 delegate artboards for the line and the card.
- Targeted tests only locally; stage explicit paths; Conventional Commits; push with `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30'`; a line under Unreleased in `CHANGELOG.md`.

## Review Focus

1. **A folder that only looks known**: `/w/a/../b`, `/w/a/` against `/w/a`, a different case, a path with a control character, the caller's own folder, a worktree path under the app data dir. Expected: only an exact listed path that is not the caller's is accepted; the rest get an error that lists nothing but the listed folders' names. Test in Task 2.
2. **A grant already given, then a `folder` call**: expected, a card with Allow once; pressing it opens that one session and the next `folder` call asks again. Test in Task 5.
3. **Four `start_session` calls in one tick**: expected, three sessions, the fourth refused, with a grant and also when all four waited on one card. Test in Task 4.
4. **`worktree: true` outside a repository, or the worktree cannot be made**: expected, no session, the agent told it could not be opened there, the cause kept from the agent, nothing left half made. Test in Task 4.
5. **The opener is deleted or archived while its opened sessions run**: expected, they keep running, show "The session that opened this is gone." and no call or count refers to the missing session. Test in Task 6.

---

### Task 1: Who opened a session

**Files:**
- Modify: `src/types/index.ts` (`Session.openedBy`), `src/lib/persistence.ts`, `src/lib/session-start.ts` (`SessionSpec.openedBy`, `newSessionRecord`), `src/lib/agent-tools.ts` (`sessionGetsAgentTools`), `src-tauri/src/store.rs` (`SessionRecord.opened_by`)
- Test: `src/test/persistence.test.ts`, `src/test/agent-tools.test.ts`, `src/test/useDelegation.test.ts` (the `newSessionRecord` describe), `src-tauri/tests/it/store_test.rs`

**Interfaces:**
- Produces:
  - `export interface OpenedByLink { sessionId: string; at: number }` and `Session.openedBy?: OpenedByLink | null`.
  - `SessionSpec.openedBy?: OpenedByLink`, copied onto the record by `newSessionRecord`.
  - `persistence.ts`: kept when `sessionId` is a non-empty string and `at` a finite number; dropped otherwise, leaving the session.
  - `store.rs`: `opened_by: Option<OpenedByRecord>` (`session_id`, `at`), `skip_serializing_if = "Option::is_none"`, read with a lenient reader as `delegated_from` is.
  - `sessionGetsAgentTools(session: Pick<Session, 'compareRunId' | 'delegatedFrom' | 'openedBy'>)`: also false for any `openedBy`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps an openedBy link and drops a malformed one', …)          // { sessionId: 's-a', at: 5 } kept; { sessionId: 3 }, 'x', { sessionId: '', at: 1 } dropped, session kept
it('copies the spec\'s openedBy onto the record', …)
it('gives no tools to a session an agent opened', …)               // sessionGetsAgentTools({ openedBy: { sessionId: 's-a', at: 1 } }) === false
```

```rust
#[test] fn a_session_keeps_who_opened_it() { /* round trip; a wrong-typed openedBy loads the session without it */ }
```

- [ ] **Step 2: Run** the three Vitest files and `cargo test --test it store_test::a_session_keeps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, `pnpm lint`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/persistence.ts src/lib/session-start.ts src/lib/agent-tools.ts src-tauri/src/store.rs src/test/persistence.test.ts src/test/agent-tools.test.ts src/test/useDelegation.test.ts src-tauri/tests/it/store_test.rs
git commit -m "feat: record which session opened a session"
```

---

### Task 2: Rules for opening a session (pure)

**Files:**
- Modify: `src/lib/agent-tools.ts`
- Test: `src/test/agent-tools-rules.test.ts`

**Interfaces:**
- Consumes: `OpenedByLink` (Task 1), `escapeVisible`.
- Produces:
  - `export const MAX_RUNNING_OPENED = 3;`
  - `openedSessionsOf(openerId: string, sessions: readonly Session[]): Session[]` — not archived, `openedBy.sessionId === openerId`, oldest first.
  - `resolveFolder(wanted: string, input: { workspaces: readonly { name: string; path: string }[]; callerCwd: string }): { path: string } | { error: string }` — see the Global Constraints. Error: `That folder is not one Zorvo knows. Use a path from list_agents' folders: {names, comma separated}.`, or `No other folder can be used.` when the list is empty; for the caller's own folder, `That is this session's own folder. Leave "folder" out to work here.` The error never repeats `wanted`.
  - `otherFolders(workspaces, callerCwd): { name: string; path: string }[]` — the list `list_agents` returns: every workspace but the caller's.
  - `sessionTitleOf(agentName: string, brief: string, title?: string): string` — the trimmed `title` when there is one, else `delegateSessionName(agentName, brief)`.
  - `openRefusal(input: { runningOpened: number }): string | null` — at 3 or more: `Three sessions this session opened are still working. Wait for one to finish.`
  - `openedResultText(result: { sessionName: string; folder: string }): string` — the JSON in the Global Constraints.
  - `listAgentsText` gains two optional inputs and outputs: `opened: { agent: string; title: string; state: DelegateState; folder: string }[]` and `folders: { name: string; path: string }[]`; both keys are always present in the JSON (empty arrays).
  - `NOT_YET` stays for `read_session` and `stop_session`.

- [ ] **Step 1: Write the failing tests** — one `it` per bullet, and for `resolveFolder` every case of Review Focus 1, plus: the exact path is accepted; a trailing slash on `wanted` is accepted; the error holds the names and not `wanted`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tools-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The existing `listAgentsText` tests gain `opened: []` and `folders: []` in what they expect.
- [ ] **Step 4: Run again**, plus `src/test/use-agent-tools.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-tools.ts src/test/agent-tools-rules.test.ts src/test/use-agent-tools.test.tsx
git commit -m "feat: rules for a session an agent opens"
```

---

### Task 3: The card for opening a session

**Files:**
- Modify: `src/lib/agent-tool-card.ts`, `src/types/index.ts` (`ZorvoToolRequest`), `src/components/ActionCard.tsx`
- Test: `src/test/agent-tool-card.test.tsx`

**Interfaces:**
- Produces:
  - `ZorvoToolRequest.tool: 'delegate' | 'start_session'`, and `ZorvoToolRequest.isOtherFolder?: true`, `ZorvoToolRequest.hasOwnWorktree?: true`.
  - `WaitingTask` gains `kind: 'delegate' | 'start_session'` (required) and `hasOwnWorktree?: boolean`.
  - `export const ALLOW_ONCE = 'zorvo-allow-once';`
  - `toolCardFor` (the session-wide card): one waiting `start_session` reads `{Caller} wants to open a {Target} session`, with the brief as the prompt; several waiting tasks of mixed kinds keep the phase 2 title `{Caller} wants to give other agents {n} tasks` when all are delegations, else `{Caller} asks for {n} things`, and each block is headed `For {Target}:` (a delegation) or `New {Target} session:` (a session; `New {Target} session, in its own worktree:` with `hasOwnWorktree`).
  - `folderCard(input: { cardId; sessionId; callerName; targetName; targetId; folder; brief; hasOwnWorktree: boolean; now }): ActionCard` — title `{Caller} wants to open a {Target} session in another folder`, options `[{ optionId: ALLOW_ONCE, name: 'Allow once', kind: 'allow_once' }, { optionId: DENY, name: 'Deny', kind: 'reject_once' }]`, `zorvoTool.isOtherFolder: true`.
  - `settleToolCard` gains nothing: `approved` records `chosenOptionId` as the card's own allowing option (`ALLOW_SESSION` or `ALLOW_ONCE`).
  - `settledWords`: `Allowed once` for `ALLOW_ONCE`; the rest as today.
  - `ActionCard.tsx`: a `start_session` card with `hasOwnWorktree` adds the line `It gets a worktree of its own, on a new branch.`; a folder card shows no session-wide line and, in its place, `This asks every time: a session in another folder is never allowed in advance.`; `usableZorvoTool` accepts both tools.

- [ ] **Step 1: Write the failing tests**

```ts
it('titles a single session request and shows the brief as text', …)
it('heads mixed waiting tasks by kind', …)                    // prompt === 'For Qwen Code:\n…\n\nNew Codex session, in its own worktree:\n…'
it('builds the folder card with Allow once and Deny', …)
it('a folder card says it asks every time and has no session-wide line', …)
it('reads "Allowed once" once approved', …)
it('still renders a phase 2 delegate card saved before this change', …)   // zorvoTool without the new fields
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tool-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, plus `src/test/chat-cards.test.tsx` and `src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-tool-card.ts src/types/index.ts src/components/ActionCard.tsx src/test/agent-tool-card.test.tsx
git commit -m "feat: cards for a session an agent wants to open"
```

---

### Task 4: Open the session

**Files:**
- Create: `src/hooks/useOpenedSessions.ts`
- Test: `src/test/use-opened-sessions.test.tsx`

**Interfaces:**
- Consumes: `openedSessionsOf`, `openRefusal`, `sessionTitleOf`, `MAX_RUNNING_OPENED` (Task 2); `createSessionWorktree` (`src/lib/session-worktree.ts`); `SessionSpec.openedBy` (Task 1).
- Produces:

```ts
export interface OpenedSessionsDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  isBusy: (sessionId: string) => boolean;
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
}
export interface OpenRequest { agentId: string; brief: string; title?: string; hasOwnWorktree: boolean; folderPath?: string }
export type OpenResult =
  | { ok: true; sessionId: string; sessionName: string; folder: string }
  | { ok: false; reason: string; isInternal?: true; detail?: string };
export function useOpenedSessions(deps: OpenedSessionsDeps): {
  open: (openerId: string, request: OpenRequest) => Promise<OpenResult>;
  /** The opener's sessions, for list_agents. */
  openedOf: (openerId: string) => { agent: string; title: string; state: 'idle' | 'working'; folder: string }[];
};
```

- `open`:
  - opener unknown: `{ ok: false, reason: 'This session no longer exists.' }`; agent unknown: `{ ok: false, reason: 'The agent is not available.' }`.
  - the cap: `runningOpened` is the opener's opened sessions that are busy, plus the opens of this opener still in flight (a ref counted up before anything awaits and down when the session is listed or the open failed). `openRefusal` decides.
  - the folder: `request.folderPath ?? opener.cwd`; without `folderPath` the opener's `worktree` is the new session's too, unless `hasOwnWorktree`.
  - `hasOwnWorktree`: `createSessionWorktree(repoPath, title)` where `repoPath` is `opener.worktree?.repoPath ?? folder` for the opener's own folder, and `folderPath` for another folder. A failure is `{ ok: false, reason: 'A worktree could not be made there. Open the session without one, or in a repository.', isInternal: true, detail: String(error) }`, and no session is started.
  - then `startSession({ id, agent, cwd, worktree, name, openedBy: { sessionId: openerId, at: now } }, { text: request.brief }, { choices: NO_CHOICES, focus: false })`. No `context`: the brief is all the session knows.
- `openedOf`: `openedSessionsOf`, each with its agent's name, its session name, `working` when busy, its `cwd`.

- [ ] **Step 1: Write the failing tests**

```ts
it('opens a session in the opener\'s folder with the brief as its first message, without selecting it', …)
it('records who opened it and gives it no handoff context', …)            // spec.openedBy; first.context undefined
it('opens it in a worktree of its own when asked', …)                     // invoke('create_session_worktree', { repoPath, title }); spec.worktree, spec.cwd
it('uses the repository of the opener\'s own worktree as the base', …)
it('opens it in another folder, with no worktree unless asked', …)
it('opens no session when the worktree cannot be made, and keeps the cause from the caller', …)   // isInternal, detail holds the error, reason does not
it('opens three of four requests made in the same tick', …)
it('counts only the opener\'s sessions that are in a turn', …)            // three idle opened sessions do not block
it('frees its place when an open failed', …)
it('lists the opener\'s sessions with their state and folder', …)
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/use-opened-sessions.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOpenedSessions.ts src/test/use-opened-sessions.test.tsx
git commit -m "feat: open a session for an agent"
```

---

### Task 5: Answer `start_session`

**Files:**
- Modify: `src/hooks/useAgentTools.ts`, `src/App.tsx`
- Test: `src/test/use-agent-tools.test.tsx`, `src/test/delegation-app.test.tsx`

**Interfaces:**
- Consumes: `resolveAgent`, `statusRefusal`, `resolveFolder`, `otherFolders`, `openedResultText`, `listAgentsText` (Task 2); `toolCardFor`, `folderCard`, `ALLOW_ONCE` (Task 3); `open`, `openedOf` (Task 4).
- Produces:
  - `AgentToolsDeps` gains `workspaces: readonly { name: string; path: string }[]`, `openSession: (openerId: string, request: OpenRequest) => Promise<OpenResult>`, `openedOf: (sessionId: string) => …`.
  - `list_agents` answers with `opened` and `folders` filled.
  - `start_session`, in this order: arguments readable (`agent`, `brief` strings; `title` string or absent; `worktree` boolean or absent; `folder` string or absent), else `Zorvo could not do that.`; `resolveAgent`; `statusRefusal`; `resolveFolder` when `folder` is given.
    - without `folder`: with a grant, `openSession` and answer `openedResultText` or the refusal; without one, the call joins the session's waiting card exactly as a `delegate` call does (one card, all tasks shown, Allow grants and runs them in order).
    - with `folder`: always its own card (`folderCard`), one per call, kept apart from the session's grant card. **Allow once** opens that session and answers; it records no grant. **Deny** answers `The user declined.` A session may show a grant card and folder cards at the same time.
  - `agent-tool-call-ended` withdraws a folder card whose call ended.
  - `isWaiting(sessionId)` is true for a pending folder card too; `chooseCard` takes either kind and returns false for a card it did not make.
  - An `OpenResult` with `isInternal` is answered `Zorvo could not do that.`, except the worktree refusal, whose `reason` is safe and is passed on.
  - `read_session`, `stop_session`: still `NOT_YET`.
- `App.tsx`: mounts `useOpenedSessions`, passes `workspaces`, `openSession`, `openedOf`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists the sessions this session opened and the other folders', …)
it('opens a session after Allow on the session\'s card, and with a grant asks nothing', …)
it('shows a delegate call and a start_session call on one card', …)
it('asks with Allow once for another folder even with a grant, and keeps no grant from it', …)   // Review Focus 2
it('shows a folder card next to the session\'s card, each answered on its own', …)
it('refuses a folder that is not listed, without a card', …)
it('refuses the caller\'s own folder as "folder"', …)
it('tells the agent when three opened sessions still work', …)
it('passes the worktree refusal on and hides any other internal failure', …)
it('withdraws a folder card when its call ended', …)
it('declines a folder call on Deny', …)
// delegation-app.test.tsx
it('an agent\'s start_session call opens a session in the sidebar without leaving the current one', …)
```

- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, `pnpm vitest run src/test/tauri-contract.test.ts`, `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAgentTools.ts src/App.tsx src/test/use-agent-tools.test.tsx src/test/delegation-app.test.tsx
git commit -m "feat: let an agent open a session after the user allows it"
```

---

### Task 6: "Opened by" in the chat

**Files:**
- Create: `src/components/delegation/OpenedByLine.tsx`
- Modify: `src/App.tsx` (the slot that shows `DelegatedFromLine`), `src/components/PopoutApp.tsx` only if the slot is drawn there too
- Test: `src/test/opened-by-line.test.tsx`, `src/test/delegation-app.test.tsx`

**Interfaces:**
- Produces: `OpenedByLine({ openerName, openerSessionId, onOpen, canAct })` — one quiet line above the session's first message, in `DelegatedFromLine`'s place and look: `Opened by {Agent} from {Session name}` with **Open** when `canAct` and the opener exists; `The session that opened this is gone.` when `openerSessionId` is null. A session has `delegatedFrom` or `openedBy`, never both.

- [ ] **Step 1: Write the failing tests**

```ts
it('says who opened the session and opens that session', …)
it('has no Open in a popout', …)
it('says the opener is gone when it was deleted', …)              // Review Focus 5
it('an opened session shows the line and no delegation line', …)  // app level
```

- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, plus the popout tests (`grep -ln "popout" src/test | xargs pnpm vitest run`), `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/delegation/OpenedByLine.tsx src/App.tsx src/test/opened-by-line.test.tsx src/test/delegation-app.test.tsx
git commit -m "feat: say which session opened a session"
```

---

### Task 7: Tell the command path, docs, PR

**Files:**
- Modify: `src/lib/agent-tools-context.ts` (`COMMAND_PATH_CONTEXT` names `start_session`; still at most 700 characters), `src/test/agent-tools-context.test.ts`, `CLAUDE.md` ("Agent tools"), `CHANGELOG.md`, `README.md` (the privacy bullet: an agent can also open a session, and another folder asks every time), the spec ("Phases": what phase 3 built and what it left for phase 4)

- [ ] **Step 1: Write the failing test**: the context contains `start_session {"agent": "<id>", "brief": "<text>"}` and stays within 700 characters.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tools-context.test.ts`. Expected: FAIL. Implement; run again; expected PASS.
- [ ] **Step 3: Drive the real app once** if it can be done without loading the maintainer's laptop (they asked for light work): under `pnpm tauri dev`, a Qwen Code or Pi session, "start this in a new Codex session", Allow; then the same with another folder. If it is not done, say so at the top of the PR's "Not verified" list; phase 2 was merged without a run in the app, so this would be the first.
- [ ] **Step 4: Write the docs and the changelog line.**
- [ ] **Step 5: One fresh review of the whole branch** against the spec sections named at the top and this plan's Review Focus; fix what is Critical or Important with a failing test first.
- [ ] **Step 6: Commit, push, open the PR against `main`.** Do not merge.

```bash
git add src/lib/agent-tools-context.ts src/test/agent-tools-context.test.ts CLAUDE.md CHANGELOG.md README.md docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md
git commit -m "docs: describe sessions an agent opens"
GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30' git push -u origin <branch>
```
