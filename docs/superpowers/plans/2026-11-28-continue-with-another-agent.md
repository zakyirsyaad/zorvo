# Continue with Another Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move a conversation to another agent from the composer (option D, from the last message, the typed message going first) and from the Fork button (option A, from any agent reply), each making a new handoff session marked "Continued with {Agent} from {session}".

**Architecture:** Both entry points end in the existing `useSessionFork` handoff path, which already accepts another agent. A pure module (`lib/agent-switch.ts`) decides who can switch and lists the agents; a hook (`useAgentSwitch`) holds the composer's pending switch in memory and sends it; the composer reuses the draft's control builder for the picked agent. A transcript mark (`continuedFrom`) on the new session's first message draws the line.

**Tech Stack:** React 19, TypeScript, Tailwind 4, Vitest + Testing Library (jsdom). No Rust, no Tauri command.

**Spec:** `docs/superpowers/specs/2026-11-28-continue-with-another-agent-design.md`. Look and copy: canvas section 21, artboards `SwitchAgentOptions` (A), `SwitchAgentComposer` (D), `SwitchAgentResult` (the new session), https://claude.ai/artifact/NkShdh56RavBM73MEb9WbU.

## Global Constraints

- Work in a worktree on branch `feat/continue-with-another-agent`, cut from `main`; other sessions share the main checkout. Stage explicit paths only (never `git add -A`).
- No new Tauri command, event or Rust change; `src/test/tauri-contract.test.ts` must stay green untouched.
- `STATE_VERSION` stays 2; new transcript fields are read leniently in `normalizeTranscript`.
- Design tokens only (no raw colours), `focus-ring` on every focusable control, `src/components/ui/` primitives (`Button`, `IconButton`, `Popover`) before hand-styled buttons; transitions name no `duration-*`.
- UI copy, verbatim: menu header "Continue in a new session with"; private header "Continue outside the TEE with"; menu footer "This conversation goes with it. This session stays as it is."; source row word "This session" (private: "Private"); note "Your message starts a new {Agent} session that continues this one. {Source agent}'s session stays as it is."; button "Keep {Source agent}"; placeholder "Message {Agent}"; Send name "Send to {Agent} in a new session"; busy note "{Source agent} is still working. Wait for it to finish, or press Stop."; review lock "Send or clear the review comments first."; Fork menu "Fork with {Agent}" and header "Continue with another agent"; line "Continued with {Agent} from {source name}", deleted source "a deleted session".
- Status words: `SIGN_IN_STATUS_WORDS` (`Ready`, `Needs sign-in`, `Not checked yet`) from `src/lib/agent-sign-in.ts`, plus `Not installed` for an agent `isAgentRunnable` rejects.
- The source session is never sent `acp_set_model`, `acp_set_mode` or `acp_set_config_option` for the picked agent's chips.
- Local checks: `pnpm lint` and `pnpm vitest run <touched test files>` only (the full suite is CI's).

## Review Focus

1. **A pending switch on a session that is then deleted or archived** must not resurrect when another session takes its id slot or leave a stale note: Task 7 tests drop-on-delete and drop-on-archive.
2. **Picking a model chip while a switch is pending** must change the pending choices, not the running source session: Task 9 test asserts no `setModel` on the source engine.
3. **A failed handoff write** (disk full, permission) must give the typed message back to the source's composer and keep the pending switch: Task 3 (`false` result) and Task 9 (give back) tests.
4. **Sending while the source is waiting on a permission card** (not "busy" but waiting) must not fork: Task 8 `switchWaits` covers `isSessionWaiting`, Task 9 asserts nothing is forked.
5. **The picked agent taken out of use in Settings meanwhile** must drop the switch rather than fork to an agent the user removed: Task 7 test.

---

### Task 0: Branch

- [ ] **Step 1:** `git worktree add .claude/worktrees/continue-agent -b feat/continue-with-another-agent main`, `cd` there, `pnpm install`.
- [ ] **Step 2:** Copy the spec and this plan into the worktree if they are not on `main` yet, and commit them: `git add docs/superpowers/specs/2026-11-28-continue-with-another-agent-design.md docs/superpowers/plans/2026-11-28-continue-with-another-agent.md && git commit -m "docs: spec and plan for continuing with another agent"`.

### Task 1: Switch rules (`lib/agent-switch.ts`)

**Files:**
- Create: `src/lib/agent-switch.ts`
- Test: `src/test/agent-switch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SwitchStatus = 'ready' | 'needed' | 'unchecked' | 'not-installed';
  export interface SwitchTarget { id: string; name: string; isSource: boolean; status: SwitchStatus; word: string; isDisabled: boolean }
  export function switchTargets(agentsInUse: readonly AgentProfile[], sourceProfileId: string,
    signInOf: (profileId: string) => SignInState, isPrivate: boolean): SwitchTarget[];
  export function switchHiddenFor(session: Session, messageCount: number, isPopout: boolean): boolean;
  export const SWITCH_TEXT: { menuHeader: string; privateHeader: string; footer: string; forkHeader: string;
    reviewLock: string; deletedSource: string };
  export function switchNote(agent: string, source: string): string;      // the note above the card
  export function switchWaitsNote(source: string): string;                // the busy note
  export function continuedLine(agent: string, source: string): string;   // without the link split
  ```
  (`SignInState` from `src/lib/agent-sign-in.ts`; `AgentProfile`, `Session` from `src/types`.)

- [ ] **Step 1: Write the failing tests**
  - `lists the source first, then the other agents in use in their order` — agents `[codex, qwen, claude]`, source `qwen` → ids `['qwen-code', 'codex-acp', 'claude-acp']`, first `isSource: true, word: 'This session'`.
  - `a private source reads Private` — `isPrivate: true` → source `word: 'Private'`.
  - `status words come from the sign-in state` — `ready → 'Ready'`, `needed → 'Needs sign-in'`, `unchecked → 'Not checked yet'`.
  - `an agent that cannot run is listed disabled as Not installed` — `availability: 'not_installed'` → `{ status: 'not-installed', word: 'Not installed', isDisabled: true }`; `needed` is not disabled.
  - `switchHiddenFor` is true for: `messageCount === 0`; `compareRunId` set; `delegatedFrom` without `endedAt`; `isPopout`; false for a plain running or terminated session with messages and for a worker whose link has `endedAt`.
  - Copy: `switchNote('Claude Code', 'Qwen Code')` equals the Global Constraints note; `switchWaitsNote('Qwen Code')` equals the busy note; `continuedLine('Claude Code', 'Fix login bug')` is `'Continued with Claude Code from Fix login bug'`.
- [ ] **Step 2:** `pnpm vitest run src/test/agent-switch.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement in `src/lib/agent-switch.ts`. Use `isAgentRunnable` (`src/lib/agent-readiness.ts`) and `SIGN_IN_STATUS_WORDS`.
- [ ] **Step 4:** Re-run — PASS.
- [ ] **Step 5:** `git add src/lib/agent-switch.ts src/test/agent-switch.test.ts && git commit -m "feat: rules for continuing with another agent"`

### Task 2: The `continuedFrom` mark

**Files:**
- Modify: `src/types/index.ts` (`ChatMessage`, near `delegationTask`)
- Modify: `src/hooks/session-engine/useAcpEngine.ts:46` (`FirstMessage.marks`)
- Modify: `src/lib/persistence.ts:435-490` (beside `withValidAgentMark`)
- Test: `src/test/persistence.test.ts`

**Interfaces:**
- Produces: `ChatMessage.continuedFrom?: { sessionId: string; agentId: string }`; `FirstMessage.marks?: Pick<ChatMessage, 'delegationTask' | 'continuedFrom'>`.

- [ ] **Step 1: Write the failing tests** in `persistence.test.ts`:
  - `keeps a well-formed continuedFrom mark` — a user message with `continuedFrom: { sessionId: 's-1', agentId: 'qwen-code' }` survives `normalizeTranscript` unchanged.
  - `drops a continuedFrom mark with an empty or missing id` — `{ sessionId: '', agentId: 'x' }`, `{ agentId: 'x' }`, `'s-1'` → the message has no `continuedFrom` and keeps its other fields.
- [ ] **Step 2:** Run `pnpm vitest run src/test/persistence.test.ts` — the second test FAILS.
- [ ] **Step 3:** Add `withValidContinuedFrom(message)` in `persistence.ts` and chain it where `withValidAgentMark` is applied (line ~490). Widen `FirstMessage.marks` (line 46); the engine already spreads `options.first.marks` onto the added user message (`useAcpEngine.ts:583`), so no engine logic changes.
- [ ] **Step 4:** Re-run — PASS. `pnpm lint` — clean.
- [ ] **Step 5:** Commit `feat: keep the continued-from mark in transcripts` with the four paths.

### Task 3: `useSessionFork` takes a first message and reports

**Files:**
- Modify: `src/hooks/useSessionFork.ts`
- Modify: `src/App.tsx:920-948,1599` (callers: `void forkSession(...)` stays valid)
- Modify: `src/hooks/usePrivateWiring.ts:110` (the `forkSession` dep type becomes `Promise<boolean>`, no behaviour change)
- Test: create `src/test/session-fork-agent.test.tsx` (pattern of `src/test/private-fork.test.tsx`)

**Interfaces:**
- Consumes: `FirstMessage.marks.continuedFrom` (Task 2).
- Produces:
  ```ts
  interface ForkOptions { /* existing */ firstMessage?: { text: string; attachments?: readonly string[] } }
  useSessionFork(deps): (messageId: string, options?: ForkOptions) => Promise<boolean>
  ```

- [ ] **Step 1: Write the failing tests:**
  - `firstMessage replaces the shown text and keeps the handoff context` — fork to `claude` with `firstMessage: { text: 'Fix it', attachments: ['/w/a.png'] }` → `startSession`'s second argument has `text: 'Fix it'`, `attachments: ['/w/a.png']`, and a `context` containing the path `write_fork_handoff` returned.
  - `without firstMessage the fork starts with FORK_FIRST_MESSAGE` — same as today.
  - `marks the first message continuedFrom only for another agent` — to `claude`: `marks.continuedFrom` is `{ sessionId: 's-1', agentId: 'qwen-code' }`; a same-agent handoff fork has no `continuedFrom`.
  - `resolves true once the session is started` and `resolves false when the handoff cannot be written` — make the fake `invoke('write_fork_handoff')` reject (`vi.mocked(invoke)` as other tests do, or the setup's command override) → `false`, `onNotice` called, `startSession` not called.
  - `resolves false when the agent is not installed` (`detected: false`).
- [ ] **Step 2:** `pnpm vitest run src/test/session-fork-agent.test.tsx` — FAIL.
- [ ] **Step 3:** Implement: return `false` on each early return and in `catch`, `true` after `startSession` and after a native `acp.fork` call; build `first` from `options.firstMessage ?? { text: FORK_FIRST_MESSAGE }` plus `context`, and add `marks: { continuedFrom: { sessionId: source.id, agentId: source.profileId } }` when `isOtherAgent`.
- [ ] **Step 4:** Re-run, plus `pnpm vitest run src/test/private-fork.test.tsx` — PASS.
- [ ] **Step 5:** Commit `feat: fork to another agent with the user's own first message`.

### Task 4: Shared "outside the TEE" dialog

**Files:**
- Create: `src/components/private/ContinueOutsideTeeDialog.tsx` (moved `ContinueDialog` from `PrivateCreditsOut.tsx:215-260`)
- Modify: `src/components/private/PrivateCreditsOut.tsx`
- Test: `src/test/private-credits-out.test.tsx` (existing, must stay green), add `src/test/continue-outside-tee-dialog.test.tsx`

**Interfaces:**
- Produces: `ContinueOutsideTeeDialog({ agents: readonly ContinueChoice[]; onCancel: () => void; onConfirm: (agentId: string) => void })`, `ContinueChoice` re-exported from it. With exactly one agent the radio list is replaced by the sentence "{Agent} gets the conversation so far, outside the TEE." and Continue is enabled at once.

- [ ] **Step 1:** Failing tests: one agent shows that sentence and no radio, Continue calls `onConfirm('claude-acp')`; Cancel calls `onCancel` and not `onConfirm`; several agents keep today's radio list.
- [ ] **Step 2:** Run both test files — the new one FAILS.
- [ ] **Step 3:** Move the component, add the one-agent branch, import it in `PrivateCreditsOut.tsx`.
- [ ] **Step 4:** Run both — PASS.
- [ ] **Step 5:** Commit `refactor: share the continue-outside-the-TEE dialog`.

### Task 5: The "Continued with" line

**Files:**
- Create: `src/components/chat/ContinuedFromLine.tsx`
- Modify: `src/components/chat/MessageRow.tsx` (above a user message with `continuedFrom`)
- Modify: `src/components/ChatCanvas.tsx` (pass a resolver through)
- Modify: `src/App.tsx` (resolver from `sessions`, `agents`, `selectSession`)
- Test: create `src/test/continued-from-line.test.tsx`

**Interfaces:**
- Consumes: `continuedLine`, `SWITCH_TEXT.deletedSource` (Task 1); `ChatMessage.continuedFrom` (Task 2).
- Produces:
  ```ts
  export interface ContinuedFromView { agentName: string; sourceName: string | null; onOpenSource?: () => void }
  ContinuedFromLine(props: ContinuedFromView)
  // ChatCanvas / MessageRow prop:
  continuedFromOf?: (mark: NonNullable<ChatMessage['continuedFrom']>) => ContinuedFromView
  ```
  `agentName` is the **new** session's agent (the session on screen), resolved in App.

- [ ] **Step 1:** Failing tests: with `sourceName: 'Fix login bug'` the line reads "Continued with Claude Code from Fix login bug" and the name is a button that calls `onOpenSource`; with `sourceName: null` it reads "… from a deleted session" with no button; `MessageRow` draws it only above a message that has the mark (extend `message-row-delegation.test.tsx` or a new case in the new file).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement: a centred caption between two `bg-border` hairlines, `text-caption text-fg-subtle`, the link a text button with `focus-ring` and underline (look: `SwitchAgentResult`'s divider without the BARU tag).
- [ ] **Step 4:** Run, plus `src/test/chat-canvas.test.tsx` — PASS.
- [ ] **Step 5:** Commit `feat: mark where a session continued with another agent`.

### Task 6: Fork menu (option A)

**Files:**
- Create: `src/components/chat/ForkMenu.tsx`
- Modify: `src/components/MessageActionBar.tsx`, `src/components/chat/MessageRow.tsx:51,115,321`, `src/components/ChatCanvas.tsx:59,131,214,231,314`
- Modify: `src/App.tsx:1599` (wiring, private confirm via Task 4)
- Test: create `src/test/fork-menu.test.tsx`

**Interfaces:**
- Consumes: `switchTargets`, `switchHiddenFor`, `SWITCH_TEXT.forkHeader` (Task 1); `forkSession` (Task 3); `ContinueOutsideTeeDialog` (Task 4).
- Produces: `MessageActionBar` prop `fork?: { agents: readonly SwitchTarget[]; sourceName: string; onFork: (agentId?: string) => void }` replacing `onFork`; `ChatCanvas` prop `forkAgents?: readonly SwitchTarget[]` beside `onForkBranch: (messageId: string, agentId?: string) => void`.

- [ ] **Step 1:** Failing tests:
  - `with other agents the Fork button opens a menu whose first item is focused` — items in order "Fork with Qwen Code", header "Continue with another agent", "Claude Code Ready", …; `document.activeElement` is the first item.
  - `the first item forks with the same agent` — `onFork` called with no argument; picking "Claude Code" → `onFork('claude-acp')`.
  - `a Not installed row is disabled` (`aria-disabled="true"`, no call).
  - `Escape closes and returns focus to the Fork button`.
  - `with no other agents the button forks at once` (`agents` holding only the source) — no menu, `onFork()` called.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `ForkMenu` on `Popover` (`role="menu"`, `side` top/bottom as the action bar's other popovers do), the trigger `IconButton` "Fork from here" with `GitBranch` and a 10px `ChevronDown`. In App, `onForkBranch(messageId, agentId)`: same agent → `forkSession(messageId)`; another → for a private source open `ContinueOutsideTeeDialog` with that one agent, then `forkSession(messageId, { agent, choices: withPreferred(NO_CHOICES, agentOptions[agent.id]) })` (the pattern of `usePrivateContinue`). `forkAgents` is `[]` when `switchHiddenFor` is true; popouts pass none.
- [ ] **Step 4:** Run, plus `chat-canvas.test.tsx` and `message-row-*.test.tsx` — PASS.
- [ ] **Step 5:** Commit `feat: continue with another agent from the Fork menu`.

### Task 7: Pending switch hook (`useAgentSwitch`)

**Files:**
- Create: `src/hooks/useAgentSwitch.ts`
- Test: create `src/test/use-agent-switch.test.tsx`

**Interfaces:**
- Consumes: `forkSession` (Task 3), `switchTargets` / `switchHiddenFor` (Task 1).
- Produces:
  ```ts
  export interface PendingSwitch { agentId: string; choices: AcpChoices }
  export interface AgentSwitch {
    pendingOf: (sessionId: string) => PendingSwitch | undefined;
    pick: (sessionId: string, agentId: string) => void;      // the source's id clears it
    keep: (sessionId: string) => void;
    setChoices: (sessionId: string, choices: AcpChoices) => void;
    send: (sessionId: string, message: { text: string; attachments?: readonly string[] }) => Promise<boolean>;
  }
  export function useAgentSwitch(deps: {
    sessions: readonly Session[]; agentsInUse: readonly AgentProfile[];
    transcripts: Readonly<Record<string, ChatMessage[]>>; agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
    forkSession: (messageId: string, options?: ForkOptions) => Promise<boolean>;
  }): AgentSwitch;
  ```
  State is `useState<Record<string, PendingSwitch>>`, memory only; `pick` seeds `choices` with `withPreferred(NO_CHOICES, agentOptions[agentId])`.

- [ ] **Step 1:** Failing tests:
  - `pick stores the agent with its remembered choices`; `picking the source agent clears it`; `keep clears it`.
  - `survives showing another session` (no dependency on the active id).
  - `drops a switch whose session is deleted or archived` (rerender with the session gone / `archived: true` → `pendingOf` undefined).
  - `drops a switch whose agent was taken out of use` (rerender without that agent in `agentsInUse`).
  - `send forks from the last message with the agent, the choices and the message, then clears` — `forkSession` called with `('m-2', { agent: claude, choices, firstMessage: { text, attachments } })`, resolves `true`, `pendingOf` undefined.
  - `a send that fails keeps the switch and resolves false`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; derive the drops during render (filter the record against `sessions` and `agentsInUse`), not in an effect.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: hold a pending switch to another agent`.

### Task 8: Composer picker and the busy note

**Files:**
- Create: `src/components/composer/SessionAgentPicker.tsx`
- Modify: `src/lib/composer-state.ts:153-182` (`composerNote`)
- Test: create `src/test/session-agent-picker.test.tsx`; extend `src/test/composer-state.test.ts`

**Interfaces:**
- Consumes: `SwitchTarget`, `SWITCH_TEXT` (Task 1).
- Produces:
  ```ts
  SessionAgentPicker(props: { targets: readonly SwitchTarget[]; pickedId: string; isPrivate: boolean;
    disabledReason?: string; isOpen: boolean; onToggle: () => void; onClose: () => void;
    onPick: (agentId: string) => void })
  composerNote({ ..., switchWaits?: string })   // the source agent's name
  ```

- [ ] **Step 1:** Failing tests:
  - Picker: trigger shows the picked agent's tile and name, `aria-haspopup="menu"`; rows are `menuitemradio` with `aria-checked` on `pickedId`; header "Continue in a new session with" (private: "Continue outside the TEE with", other rows' names end in "…"); footer text; a disabled row does not call `onPick`; with `disabledReason` the trigger is `aria-disabled` and `aria-describedby` that text.
  - `composerNote`: `switchWaits: 'Qwen Code'` → the busy note; it ranks after `reviewOwner` and before `queueFull` (assert `reviewOwner` still wins and that `queueFull` loses to it).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement the picker on `Popover` with the composer's chip classes (as `OptionDropdown` uses); `composerNote` gains the branch at that rank.
- [ ] **Step 4:** Run, plus `composer-state.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat: agent picker for a running session's composer`.

### Task 9: Wire D into the composer and Send

**Files:**
- Modify: `src/components/ComposerDock.tsx:189,257,640-660,753-760` (picker replaces the `sessionAgent` label; note slot; placeholder and Send name come in as props)
- Modify: `src/hooks/useMessageDeliveryWiring.ts:15-56,224-238` (deps and the branch)
- Modify: `src/App.tsx` (build `useAgentSwitch`; controls via `composerStateFor({ session: undefined, draftAgent: picked, acpChoices: pending.choices, setAcpChoices: (c) => agentSwitch.setChoices(id, c), ... })` while a switch is pending; `switchWaits`; review lock; mention suppression; private confirm on pick)
- Modify: `CHANGELOG.md` (Unreleased: "Continue a conversation with another agent from the composer's agent menu or the Fork menu.")
- Test: `src/test/use-message-delivery-wiring.test.tsx`, `src/test/composer-dock.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `MessageDeliveryWiringDeps.agentSwitch: Pick<AgentSwitch, 'pendingOf' | 'send'>`; `ComposerDock` props `agentPicker?: Omit<SessionAgentPickerProps, 'isOpen' | 'onToggle' | 'onClose'>` (uses the dock's `openDropdown === "agent"`), `switchNote?: { text: string; keepLabel: string; onKeep: () => void }`.

- [ ] **Step 1:** Failing tests in `use-message-delivery-wiring.test.tsx`:
  - `a pending switch sends through the switch, not to the source` — `agentSwitch.send` called with `('s-1', { text, attachments })`, `sendAcp` not called.
  - `a switch that fails gives the message back` — `send` resolves `false` → `giveBackMessage('s-1', text, attachments)`.
  - `a pending switch sends nothing while the source works or waits` — `isTurnUnderWay` true → neither `send` nor `sendAcp`; same with `isSessionWaiting` true.
  - `an @Agent prefix is not delegated while a switch is pending` — `delegationMention` set, `delegation.start` not called, `send` called.
  In `composer-dock.test.tsx`:
  - `the switch note shows above the card with Keep` — text equals the note, clicking "Keep Qwen Code" calls `onKeep`.
  - `the picker replaces the agent label in a running session` — no `[data-agent-chip]` span when `agentPicker` is given.
- [ ] **Step 2:** Run both files — FAIL.
- [ ] **Step 3:** Implement the branch at the top of `handleSendMessage` (before the mention branch): `pendingOf(activeSession.id)` → guard busy/waiting → `send(...).then(ok => { if (!ok) giveBackMessage(...) })`. In App: placeholder "Message {Agent}" and `sendLabel` "Send to {Agent} in a new session" while pending; `sendDisabled` also when `switchWaits`; picker `disabledReason` = `SWITCH_TEXT.reviewLock` while `review.isHeldFor(activeSessionId)` holds comments; `onPick` for a private session opens `ContinueOutsideTeeDialog` first; `delegationMention` is treated as `null` while pending. Model-chip picks while pending go to `agentSwitch.setChoices` only (Review Focus 2: add `a chip pick while a switch is pending does not reach the source` to `use-agent-switch.test.tsx` or an App-level test asserting the engine's `setModel` mock is not called).
- [ ] **Step 4:** Run the two files plus `use-agent-switch.test.tsx`, `composer-state.test.ts`; then `pnpm lint` — PASS, clean.
- [ ] **Step 5:** Commit `feat: continue with another agent from the composer`.

### Task 10: Check in the app

- [ ] **Step 1:** `pnpm tauri dev` (or the real-app harness with fake agents) and walk: pick another agent in the composer, read the note, Keep, pick again, type and Send → the new session opens with the line and your message first; Fork menu from an earlier reply; a busy source blocks Send with the note; a private session asks first.
- [ ] **Step 2:** Compare with artboards `SwitchAgentComposer`, `SwitchAgentOptions` (A) and `SwitchAgentResult`, in dark and light.
- [ ] **Step 3:** Push the branch and open the pull request (`gh pr create`), body linking the spec; review before the push (`/code-review --fix`).
