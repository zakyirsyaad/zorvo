# Zorvo agent tools, phase 2 (delegation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can call `list_agents` and `delegate`: the first call in a session shows a Zorvo card, an allowed call starts a delegate or gives a further task to the one that agent already has, and the answer comes back as a report.

**Architecture:** The backend from phase 1 already delivers each call as `agent-tool-call` and waits for `agent_tool_respond`. This phase replaces the webview's placeholder with the real handler and changes the delegation rules it calls: a session may hold one open delegate per agent, a delegate can be given further tasks, a report waits for its source's turn to end, and the source's Send is no longer blocked while a delegate works. The rules stay pure functions in `src/lib/`; the hooks hold only refs and side effects. The feature is switched on by default in the last task, behind one switch in Settings → Agents.

**Tech Stack:** React 19 hooks, TypeScript, Vitest and Testing Library; two small Rust changes (`store.rs`, `service.rs`).

**Spec:** `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md`: "Tools" (`list_agents`, `delegate`), "From tool call to session", "Approval", "Changes to the delegation rules", "UI", "Security". The 2026-11-08 delegation spec still governs what this plan does not change. `start_session`, `read_session`, `stop_session`, handles, `worktree` and `folder` are phases 3 and 4: here they answer "not available yet".

## Global Constraints

- An agent sends an agent id or name and text. Folder, worktree, mode and model are never taken from a tool call: a delegate works where its source works.
- One open delegate per agent per source. A delegated session cannot delegate and gets no tools (`sessionGetsAgentTools`).
- `task`: the backend already trims it, caps it at 20,000 characters and refuses a leading `/`. The webview does not repeat those checks; it shows the task through `escapeVisible`, as text, never markdown.
- The grant is memory only, keyed by session id, covers `delegate` (and later `start_session`), and is gone after a reload. `list_agents` needs none.
- A call must be answered before the shortest agent timeout. The spike measured Antigravity at 180 s, so the backend's `CALL_TIMEOUT` becomes 170 s (Task 8), and the webview answers every call on every path: allow, deny, blocked, unknown session, error thrown.
- Task text and tool arguments are never logged and never put in a notice.
- Card copy, exactly: title `{Caller} wants to give {Target} a task`, buttons `Allow for this session` and `Deny`. Declined answer to the agent: `The user declined.`
- UI copy follows `docs/design-system/README.md`: sentence case, the agents' names, no "AI". No raw colours; `src/components/ui/` primitives; the delegate artboards in `docs/superpowers/specs/2026-11-08-delegate-artboards` for the lines and the card.
- `STATE_VERSION` stays 2. New fields are optional and read leniently.
- Only the main window handles tool calls. A popout shows the card from the session's snapshot and forwards its answer as it forwards any `choose-option`.
- Targeted tests only locally; stage explicit paths; Conventional Commits; push with `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30'`; add a line under Unreleased in `CHANGELOG.md` (this phase is user-visible).

## Review Focus

1. **The agent calls `delegate` in the middle of its own turn.** That is the normal case, and today's `start` refuses a busy source. Expected: an agent's call starts the delegate while its source is busy, and the handoff holds the conversation up to the call. Test in Task 3.
2. **A card saved in a transcript whose call is gone** (a reload, the 170 s timeout, the agent cancelled, the session stopped): expected, no button on it can do anything; it reads as not answered, and after a reload it is not pending. Tests in Tasks 5 and 6.
3. **Two calls at once from one session** (an agent that calls `delegate` for Qwen Code and Codex in one step) with no grant yet: expected, one card; allowing it runs both, denying it declines both. Test in Task 6.
4. **Reports from two delegates while the source is still in its turn, or waiting on a permission card**: expected, both wait, then go out one per turn, oldest first, and neither lands in the composer. Test in Task 2.
5. **The agent names the target loosely** ("qwen", "Qwen", "Qwen Code", an id that is not in use, a name two agents share a prefix of): expected, an exact id or one exact case-insensitive name matches; anything else is an error that lists the valid ids. Test in Task 4.

---

### Task 1: Rules for several delegates

**Files:**
- Modify: `src/lib/delegation.ts`
- Test: `src/test/delegation.test.ts` (the existing file for these functions; find it with `grep -ln "delegateBlockedReason" src/test`)

**Interfaces:**
- Produces, replacing today's `openDelegateOf(sourceId, sessions)`:
  - `openDelegatesOf(sourceId: string, sessions: readonly Session[]): Session[]` — open, not archived, oldest first.
  - `openDelegateOf(sourceId: string, agentId: string, sessions: readonly Session[]): Session | undefined` — that agent's; the newest when a hand-edited file holds two.
  - `export type TaskRoute = { kind: 'start' } | { kind: 'follow-up'; delegate: Session } | { kind: 'blocked'; reason: string };`
  - `taskRoute(input: { source: Session; agentId: string; sessions: readonly Session[]; isBusy: (id: string) => boolean; isWaiting: (id: string) => boolean; hasMessages: boolean; isSourceBusyAllowed: boolean; agentNameOf: (profileId: string) => string }): TaskRoute`
    - a delegated source (open or ended link): blocked, `A delegated session can't delegate.`
    - no messages in the source: blocked, `''`
    - source busy and `isSourceBusyAllowed` false: blocked, `Wait for {Source} to finish.`
    - that agent's open delegate is busy or waiting: blocked, `{Agent} is still working on the previous task.`
    - that agent's open delegate is idle: `follow-up`
    - else `start`
  - `delegateBlockedReason` stays, with `agentId` added to its input, as `taskRoute`'s reason or null (`isSourceBusyAllowed: false`); its callers in `App.tsx` pass the agent in question, and where none is known (the ⋯ menu item) the source's own checks only.
  - `sendBlockedReason`: the block "{Agent} is working on the task you delegated." for the source is removed. The delegate's block while its source works on its report stays.

- [ ] **Step 1: Write the failing tests**

```ts
describe('openDelegatesOf / openDelegateOf', () => {
  it('lists every open delegate of a source, oldest first, without archived or ended ones', …)
  it('finds the delegate of one agent and not another agent\'s', …)
});
describe('taskRoute', () => {
  it('starts when the agent has no open delegate, even if another agent has one', …)
  it('is a follow-up for an idle open delegate of that agent', …)
  it('is blocked while that delegate works or waits for an answer', …)   // reason: 'Qwen Code is still working on the previous task.'
  it('is blocked for a busy source unless the caller is its own agent', …)
  it('is blocked for a delegated session, open or ended', …)
  it('is blocked without words for a source with no messages', …)
});
describe('sendBlockedReason', () => {
  it('lets the user send in a source while its delegate works', …)       // null
  it('still blocks the delegate while its source works on its report', …)
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/delegation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the existing tests that pinned the old rules (one open delegation per source; the source's Send blocked) to the new ones, in the same commit, and say which in the message.
- [ ] **Step 4: Run again**, then `pnpm lint` (the callers in `App.tsx` and `useDelegation.ts` must compile: adapt them minimally here; Tasks 2 and 3 finish them). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/delegation.ts src/test/delegation.test.ts src/hooks/useDelegation.ts src/App.tsx
git commit -m "feat: let a session hold one delegate per agent"
```

---

### Task 2: Reports that wait their turn

**Files:**
- Modify: `src/hooks/useDelegation.ts`
- Test: `src/test/use-delegation.test.tsx` (the existing hook test; `grep -ln "useDelegation" src/test`)

**Interfaces:**
- Consumes: `openDelegatesOf`, `sendBlockedReason` (Task 1).
- Produces:
  - Internal state: `pending` stays `Map<delegateId, sourceId>` in arrival order; `handingOver` (one delegate per source) is replaced by `delivering: Set<delegateId>`, the reports being sent right now.
  - `deliver` sends only when `canPrompt(source)`; when the source is busy (`isBusy`) or waiting (`isWaiting`), the report stays in `pending` and the drain runs again when the transcripts, the sessions or the revision change. It is given back into the composer, with the existing notice, only when the source is neither busy nor waiting and still cannot be prompted (not running, agent removed, sign-in needed), or when the agent refuses the prompt.
  - At most one report per source goes out per drain; the next waits for that turn to end.
  - `sendBlockedReason(delegateId)`: blocked while its report is in `pending` or `delivering`, or the source's last prompt is its report and the source is busy. Wording: `{Delegate}'s report waits for {Source} to finish.` while queued, the existing `{Source} is working on {Delegate}'s report.` once sent.
  - The same-tick block on the source ("…is working on the task you delegated.") is removed: a user message that takes the source's turn only delays the report.
  - `viewsFor(sessionId): DelegationView[]` — a source's lines, one per open delegate, oldest first; a delegate's own single line. `viewFor` stays as `viewsFor(id)[0] ?? null` until Task 7 moves its callers.
  - `end(delegateId)` drops that delegate's queued report as today.

- [ ] **Step 1: Write the failing tests**

```ts
it('holds a report while the source is in a turn and sends it when the turn ends', …)
it('holds a report while the source waits on a permission card', …)
it('sends two delegates\' reports one per turn, oldest first', …)          // send called once; after the source's turn ends, once more
it('never puts a held report in the composer', …)                          // giveBack not called
it('gives the report back when the source is not running', …)
it('gives the report back when the agent refuses it', …)
it('blocks Send in the delegate while its report is queued, with the waiting wording', …)
it('does not block Send in the source while a report is queued', …)
it('drops a queued report when the delegation ends', …)
it('lists one line per open delegate for the source', …)
it('sends a report once under StrictMode', …)                              // the existing guard still holds
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/use-delegation.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**; then `grep -ln "useDelegation\|delegation\." src/test | xargs pnpm vitest run`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDelegation.ts src/test/use-delegation.test.tsx
git commit -m "feat: hold a delegate's report until its source can take it"
```

---

### Task 3: Further tasks for a delegate, and a start from a busy source

**Files:**
- Modify: `src/hooks/useDelegation.ts`, `src/types/index.ts` (`ChatMessage.delegationTask`), `src/lib/persistence.ts` (read it leniently), `src/components/chat/MessageRow.tsx`, `src/hooks/session-engine/useAcpEngine.ts` (the `marks` of `send` accept `delegationTask`)
- Test: `src/test/use-delegation.test.tsx`, `src/test/message-row.test.tsx` (or the file that tests `delegationReport`'s label)

**Interfaces:**
- Consumes: `taskRoute` (Task 1).
- Produces:
  - `ChatMessage.delegationTask?: { agentName: string; agentId?: string }` — on the user message that carries a task into a delegate: who gave it. `MessageRow` shows `Task from {agentName}` where it shows `From {agentName}` for a report.
  - `export type GiveTaskResult = { ok: true; kind: 'started' | 'sent'; sessionId: string; sessionName: string } | { ok: false; reason: string };`
  - `useDelegation(...).giveTask(sourceId: string, agentId: string, task: string, options?: { attachments?: readonly string[]; choices?: AcpChoices; byAgent?: boolean }): Promise<GiveTaskResult>`
    - routes with `taskRoute` (`isSourceBusyAllowed: options.byAgent === true`);
    - `start`: today's `start` body. With `byAgent`, the new session is started with `{ focus: false }` and not selected, and the handoff is built from the messages before the source's unfinished reply (the reply that holds the tool call is still streaming);
    - `follow-up`: `send(delegate.id, task, attachments, { delegationTask: { agentName: <source's agent>, agentId: <source's profile id> } })`, then `patchSession(delegate.id, { delegatedFrom: { ...link, task } })` so the next report quotes this task; a refused send is `{ ok: false, reason: '{Agent} did not take the task.' }` and nothing is given back;
    - `blocked`: `{ ok: false, reason }`.
  - `start` stays as a wrapper for the dialog and the mention: `giveTask` without `byAgent`, the notice on failure, `true`/`false`.

- [ ] **Step 1: Write the failing tests**

```ts
it('starts a delegate from a busy source when its own agent asked', …)        // startSession called with focus false; selectSession not called
it('leaves the source\'s unfinished reply out of the handoff', …)             // write_fork_handoff content lacks the streaming text
it('refuses a busy source when the user asked', …)
it('sends a further task to an idle delegate and marks who gave it', …)       // send(delegateId, task, [], { delegationTask: { agentName: 'pi ACP', agentId: 'pi-acp' } })
it('makes the next report quote the further task', …)
it('refuses a further task while the delegate works', …)                      // reason: '… is still working on the previous task.'
it('starts a second delegate for another agent', …)
it('labels a task message "Task from pi ACP"', …)                             // MessageRow
```

- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, `pnpm vitest run src/test/persistence.test.ts`, `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDelegation.ts src/types/index.ts src/lib/persistence.ts src/components/chat/MessageRow.tsx src/hooks/session-engine/useAcpEngine.ts src/test/use-delegation.test.tsx src/test/message-row.test.tsx
git commit -m "feat: give a delegate further tasks"
```

---

### Task 4: What a tool call means (pure)

**Files:**
- Modify: `src/lib/agent-tools.ts`
- Test: `src/test/agent-tools-rules.test.ts`

**Interfaces:**
- Produces:
  - `export interface ListedAgent { id: string; name: string; status: 'ready' | 'not-checked' | 'needs-sign-in'; delegate?: { state: 'idle' | 'working' | 'needs-answer'; task: string } }`
  - `listAgentsText(input: { agents: readonly { id: string; name: string; status: MentionAgentStatus }[]; delegates: readonly { agentId: string; state: 'idle' | 'working' | 'needs-answer'; task: string }[] }): string` — `JSON.stringify({ agents: ListedAgent[] })`; agents with status `not-installed` are left out; a `task` is cut at 200 characters.
  - `resolveAgent(wanted: string, agents: readonly { id: string; name: string }[]): { id: string } | { error: string }` — an exact id; else exactly one agent whose name equals `wanted` ignoring case and surrounding space; else `No agent called "{wanted}". Use one of: {ids, comma separated}.` (`wanted` through `escapeVisible`, cut at 60 characters).
  - `statusRefusal(agentName: string, status: MentionAgentStatus): string | null` — `not-installed`: `{Agent} isn't installed.`; `needs-sign-in`: `{Agent} needs a sign-in first. Ask the user to sign in.`; else null.
  - `delegateResultText(result: { kind: 'started' | 'sent'; sessionName: string; agentName: string }): string` — `JSON.stringify({ [kind]: true, session: sessionName, note: 'The answer arrives as a message when {Agent} finishes. Do not wait for it.' })`
  - `export const DECLINED = 'The user declined.'; export const NOT_YET = 'This tool is not available yet.'; export const NO_SESSION = 'This session cannot use Zorvo\'s tools.';` (`NOT_READY` is removed with its last use in Task 6.)
  - `parseToolCall(payload: unknown): AgentToolCall | null` — `callId`, `sessionId`, `tool` strings and `args` an object, else null.

- [ ] **Step 1: Write the failing tests** — one `it` per bullet above, including: a name that differs only by case resolves; `qwen` does not resolve to `Qwen Code`; two agents with the same name do not resolve by name; the error lists ids; a quote or a newline in `wanted` comes back escaped; `listAgentsText` omits `delegate` for an agent without one and omits not-installed agents; `parseToolCall` refuses a payload whose `args` is a string.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tools-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-tools.ts src/test/agent-tools-rules.test.ts
git commit -m "feat: decide what an agent's tool call means"
```

---

### Task 5: The approval card

**Files:**
- Create: `src/lib/agent-tool-card.ts`
- Modify: `src/types/index.ts` (`ActionCard.zorvoTool`), `src/lib/persistence.ts` (`normalizeTranscript`), `src/components/ActionCard.tsx`, `src/lib/permission-copy.ts` if the card's wording lives there
- Test: `src/test/agent-tool-card.test.ts`, `src/test/action-card.test.tsx` (the existing card test), `src/test/persistence.test.ts`

**Interfaces:**
- Produces:
  - `ActionCard.zorvoTool?: { tool: 'delegate'; callerName: string; targetName: string; targetId: string; folder: string }` — a card Zorvo made for an agent's tool call. No call id is stored on it.
  - `export const ALLOW_SESSION = 'zorvo-allow-session'; export const DENY = 'zorvo-deny';`
  - `toolCard(input: { cardId: string; sessionId: string; callerName: string; targetName: string; targetId: string; folder: string; task: string; now: number }): ActionCard` — `title: '{Caller} wants to give {Target} a task'`, `prompt`: the task through `escapeVisible`, `status: 'pending'`, `options: [{ optionId: ALLOW_SESSION, name: 'Allow for this session', kind: 'allow_always' }, { optionId: DENY, name: 'Deny', kind: 'reject_once' }]`, no `requestId`.
  - `withToolCard(messages: ChatMessage[], card: ActionCard): ChatMessage[]` — puts the card on the agent's open reply, or on a new agent message, the way `applyPermissionRequest` places a permission card (reuse its helper; do not copy it).
  - `settleToolCard(messages, cardId, outcome: 'approved' | 'rejected' | 'withdrawn'): ChatMessage[]` — `withdrawn` is `status: 'rejected'` with no `chosenOptionId`.
  - `ActionCard.tsx`: a card with `zorvoTool` shows the folder on its own line under the title (`In {folder}`), the task as preformatted text with the chat's wrapping, and one line under the buttons: `After you allow it, {Caller} can give tasks to other agents in this session without asking again.` A settled one reads `Allowed for this session`, `Denied`, or `Not answered`.
  - `normalizeTranscript`: a pending card with `zorvoTool` loads as `rejected` with no `chosenOptionId` (its call did not survive the reload).

- [ ] **Step 1: Write the failing tests**

```ts
it('builds the card with the exact title and the two buttons', …)
it('shows a task with backticks, a heading and a link as plain text', …)       // rendered text equals the escaped task; no <a>, <h1>, <code> from it
it('shows the folder and the session-wide line', …)
it('places the card on the open reply, else on a new agent message', …)
it('reads "Not answered" once withdrawn, with no buttons', …)
it('loads a pending Zorvo card as not answered', …)                            // persistence
it('leaves a pending agent permission card pending on load', …)                // unchanged behaviour
```

- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** Check the card against the delegate artboards; where copy here and the artboard disagree, the artboard's look and this plan's words.
- [ ] **Step 4: Run again**, plus `pnpm vitest run src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-tool-card.ts src/types/index.ts src/lib/persistence.ts src/components/ActionCard.tsx src/test/agent-tool-card.test.ts src/test/action-card.test.tsx src/test/persistence.test.ts
git commit -m "feat: a card that asks before an agent starts another agent"
```

---

### Task 6: Answer the calls

**Files:**
- Modify: `src/hooks/useAgentTools.ts`, `src/App.tsx` (pass the deps; route a card's answer; `isSessionWaiting`), `src/hooks/session-engine/useAcpEngine.ts` (`chooseOption` hands a card with `zorvoTool` to `onZorvoCard` instead of `acp_respond_permission`)
- Test: `src/test/use-agent-tools.test.tsx` (new), `src/test/agent-tools.test.ts` (the placeholder tests are replaced)

**Interfaces:**
- Consumes: `parseToolCall`, `resolveAgent`, `statusRefusal`, `listAgentsText`, `delegateResultText`, `DECLINED`, `NOT_YET`, `NO_SESSION` (Task 4); `toolCard`, `withToolCard`, `settleToolCard`, `ALLOW_SESSION`, `DENY` (Task 5); `giveTask`, `viewsFor` (Tasks 2, 3); `sessionGetsAgentTools`.
- Produces:

```ts
export interface AgentToolsDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  statusOf: (agentId: string) => MentionAgentStatus;          // the function App.tsx already gives the mention menu
  delegatesOf: (sessionId: string) => { agentId: string; state: 'idle' | 'working' | 'needs-answer'; task: string }[];
  giveTask: (sourceId: string, agentId: string, task: string, options: { byAgent: true }) => Promise<GiveTaskResult>;
  updateMessages: (sessionId: string, update: (prev: ChatMessage[]) => ChatMessage[]) => void;
  onAttention: (sessionId: string, reason: 'needs-answer') => void;
}
export function useAgentTools(deps: AgentToolsDeps): {
  /** True when the card was Zorvo's and this hook took the answer. */
  chooseCard: (sessionId: string, cardId: string, optionId: string) => boolean;
  hasGrant: (sessionId: string) => boolean;
  revokeGrant: (sessionId: string) => void;
  /** A Zorvo card of this session waits for the user. */
  isWaiting: (sessionId: string) => boolean;
};
```

- Behaviour, per `agent-tool-call`:
  - payload not a call: ignored. Session unknown, or `sessionGetsAgentTools` false: `NO_SESSION`.
  - `list_agents`: `ok: true` with `listAgentsText`.
  - `start_session`, `read_session`, `stop_session`: `ok: false`, `NOT_YET`.
  - `delegate`: `resolveAgent` → `statusRefusal` → then, with a grant, `giveTask` and answer `delegateResultText` or the refusal's `reason`; without one, add the call to that session's waiting list and, if the session has no pending Zorvo card, show one (`withToolCard`) and raise `onAttention`.
  - Allow: the grant is recorded, the card settles `approved`, and every waiting call of the session runs in arrival order. Deny: the card settles `rejected` and every waiting call of the session answers `DECLINED`; no grant.
  - `agent-tool-call-ended`: that call leaves the waiting list; when it was the session's last waiting call, the card settles `withdrawn`.
  - Any exception while handling: answer `ok: false`, `Zorvo could not do that.`, never leave a call unanswered.
  - A session that stops or disappears from `sessions`: its grant and waiting calls are dropped.
- `App.tsx`: the hook is mounted where `delegation` exists (main window only); `isSessionWaiting` also returns true for `agentTools.isWaiting`; the ⋯ menu gets **Stop allowing delegation** while `hasGrant(activeSession.id)`.
- `useAcpEngine.chooseOption`: when the card has `zorvoTool`, call the new optional dep `onZorvoCard(sessionId, cardId, optionId)` and return; a popout's `choose-option` reaches the same function through the bridge, so it needs no change.

- [ ] **Step 1: Write the failing tests** (the fake `listen` from `agent-tools.test.ts`; `invoke` spied)

```ts
it('answers list_agents with the agents and this session\'s delegates, no card', …)
it('shows one card for the first delegate call and answers nothing yet', …)
it('on Allow, gives the task and answers that it started', …)                 // giveTask(sourceId, 'qwen-code', task, { byAgent: true })
it('with a grant, the next call runs with no card', …)
it('on Deny, answers "The user declined." and keeps no grant', …)             // the next call shows a card again
it('two calls before an answer share one card; Allow runs both in order', …)
it('two calls before an answer; Deny declines both', …)
it('withdraws the card when its only call ended', …)                          // agent-tool-call-ended → card "Not answered"
it('keeps the card when one of two waiting calls ended', …)
it('refuses an unknown agent with the list of ids, without a card', …)
it('refuses an agent that needs a sign-in, without a card', …)
it('passes a busy delegate\'s refusal back to the agent', …)
it('answers a compare-run session and a delegated session that they cannot use the tools', …)
it('answers start_session as not available yet', …)
it('answers even when giving the task throws', …)
it('forgets the grant when the session is gone', …)
it('revokeGrant makes the next call ask again', …)
it('routes a Zorvo card\'s button through chooseCard, never acp_respond_permission', …)   // engine
it('counts a session with a pending Zorvo card as waiting', …)
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/use-agent-tools.test.tsx src/test/agent-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Refs for the grants and the waiting lists (decisions must hold in the same tick, as `useDelegation` does); state only to re-render `isWaiting` and `hasGrant`.
- [ ] **Step 4: Run again**, then `pnpm vitest run src/test/tauri-contract.test.ts` and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAgentTools.ts src/App.tsx src/hooks/session-engine/useAcpEngine.ts src/test/use-agent-tools.test.tsx src/test/agent-tools.test.ts
git commit -m "feat: let an agent delegate after the user allows it"
```

---

### Task 7: Several delegates in the UI, and the user's own follow-up

**Files:**
- Modify: `src/App.tsx`, `src/components/delegation/DelegationStatusLine.tsx`, `src/components/delegation/DelegateDialog.tsx`, `src/hooks/useDelegateDialog.ts`, `src/lib/delegation.ts` (`mentionBlockedReason`, `startSummary`), `src/components/TopBar.tsx` (the ⋯ menu's End delegation), `src/lib/popout-bridge.ts` only if a type changes
- Test: the existing tests of each (`grep -ln "DelegationStatusLine\|DelegateDialog\|mentionBlockedReason" src/test`)

**Interfaces:**
- Consumes: `viewsFor`, `giveTask`, `taskRoute`, `openDelegatesOf`.
- Produces:
  - The chat of a source shows one `DelegationStatusLine` per open delegate (`viewsFor`), oldest first.
  - The ⋯ menu lists **End delegation to {Agent}** per open delegate (one item, worded as today, when there is one).
  - `@Agent task` at the start of a message, and the Delegate dialog: for an agent with an open idle delegate the summary reads `Goes to the {Agent} session this session already delegated to.` and Send gives a further task (`giveTask` without `byAgent`); with a busy one the note is the route's reason; the dialog's agent list no longer disables the whole dialog because some other agent has a delegate.
  - Archiving a source ends every open delegate's link (today: the one).

- [ ] **Step 1: Write the failing tests**

```ts
it('shows a line for each open delegate', …)
it('offers End delegation per delegate', …)
it('an @mention of an agent with an idle delegate says where the task goes and sends it there', …)
it('an @mention of an agent whose delegate works is refused with the reason', …)
it('lets the dialog pick a second agent while the first has a delegate', …)
it('ends every delegation when the source is archived', …)
```

- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement.** Sidebar nesting already keys on `delegatedFrom.sessionId` (`lib/session-helpers.ts`): check two delegates nest under one source and add a test there if none covers it.
- [ ] **Step 4: Run again**, `pnpm lint`, and the popout tests (`grep -ln "popout" src/test | xargs pnpm vitest run`). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/delegation/DelegationStatusLine.tsx src/components/delegation/DelegateDialog.tsx src/hooks/useDelegateDialog.ts src/lib/delegation.ts src/components/TopBar.tsx
git commit -m "feat: show and steer several delegates of one session"
```

(Add the test files you touched to the `git add`.)

---

### Task 8: The switch, on by default, and the shorter timeout

**Files:**
- Modify: `src-tauri/src/store.rs` (`Settings.agent_tools` reads as `true` when absent; `false` only when the file says `false`), `src-tauri/src/agent_tools/service.rs` (`CALL_TIMEOUT` 170 s, with the reason), `src/lib/persistence.ts` (`agentTools !== false`), `src/types/index.ts`, the Settings → Agents section (`src/components/agents/AgentCatalogPanel.tsx` or the component that heads it: find where the section's top row is drawn), `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md` (the timeout sentence: 170 s, Antigravity's 180)
- Test: `src-tauri/tests/it/store_test.rs`, `src/test/persistence.test.ts`, the Agents section's test

**Interfaces:**
- Produces: a switch in Settings → Agents, label `Let agents delegate and open sessions`, description `An agent asks first in each session. Applies to sessions you start or reopen from now on.`, bound to `settings.agentTools`, saved with the existing settings path (`saveNow`).

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn agent_tools_is_on_unless_the_state_says_off() { /* absent -> true; false -> false; "no" -> true */ }
```

```ts
it('reads agentTools as on unless it is false', …)
it('shows the switch on by default and saves a change', …)
it('describes when the change applies', …)
```

- [ ] **Step 2: Run** `cargo test --test it store_test::agent_tools`, `pnpm vitest run src/test/persistence.test.ts` and the section's test. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the phase 1 test `agent_tools_is_off_unless_the_state_says_on` to the new default and say so in the commit. Any `agent_tools_*` test that relied on the 240 s constant uses `AgentTools::CALL_TIMEOUT`.
- [ ] **Step 4: Run again**, `cargo test --test it agent_tools`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/agent_tools/service.rs src-tauri/tests/it/store_test.rs src/lib/persistence.ts src/types/index.ts src/test/persistence.test.ts docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md
git commit -m "feat: turn agent delegation on, with a switch in Settings"
```

(Add the section's component and test to the `git add`.)

---

### Task 9: The real app, docs, PR

**Files:**
- Modify: `CLAUDE.md` ("Agent tools" and "Delegation" paragraphs), `CHANGELOG.md` (Unreleased, Added), `README.md` (privacy section: agents can start other agents after you allow it in that session)

- [ ] **Step 1: Drive the real app once** with the project's E2E harness (fake agents, scratch HOME; see the harness notes in the repository's test docs): a fake agent calls `delegate` (the card shows; Allow; a delegate session appears under its source; its answer returns as a report), calls `delegate` again for the same agent (no card; the task lands in the same session), and a second fake agent on the command path does the same through `zorvo tools`. Record what was seen. If the harness cannot drive it, write the exact manual steps into the PR and say it was not done.
- [ ] **Step 2: Try one real pair** if the maintainer is at the keyboard: a Pi session, "have Qwen Code review this", Allow. Not a gate for the PR; say whether it was done.
- [ ] **Step 3: Write the docs and the changelog line.**
- [ ] **Step 4: Review the whole diff** against the spec sections named at the top and this plan's Review Focus; fix what it finds.
- [ ] **Step 5: Commit, push, open the PR against `main`.** The body lists what an agent can now do, the rules that changed for the user (one delegate per agent; Send in the source is no longer blocked; reports wait), what Step 1 and Step 2 showed, and what is not verified. Do not merge.

```bash
git add CLAUDE.md CHANGELOG.md README.md
git commit -m "docs: describe agent delegation"
GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30' git push -u origin <branch>
```
