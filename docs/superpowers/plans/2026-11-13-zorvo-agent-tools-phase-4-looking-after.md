# Zorvo agent tools, phase 4 (looking after sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can read the last answer of a session it opened or delegated to, and stop its running turn, naming the session by a handle Zorvo gave it.

**Architecture:** A handle is a short name that means something only for the session that owns it: a delegate's is its agent's id (a session holds one open delegate per agent, so nothing needs storing), an opened session's is `session-N`, stored on its `openedBy` link. `delegate`, `start_session` and `list_agents` return handles; `read_session` and `stop_session` take one. Both are answered in `useAgentTools` with no card: they reach only what the caller's own grant started, and neither starts anything nor loses work. The rules are pure functions in `src/lib/agent-tools.ts`.

**Tech Stack:** React 19 hooks, TypeScript, Vitest; one Rust change (`store.rs`, to keep the handle).

**Spec:** `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md`: "Tools" (`read_session`, `stop_session`, handles), "Approval" (the card in a popout).

## Global Constraints

- A handle resolves only among the caller's own sessions: its open delegates and the sessions it opened that are not archived. Any other string is `No session with that handle. Use list_agents to see yours.`; the error never repeats the handle.
- Zorvo's session ids never reach an agent, in any answer.
- `read_session` returns the newest finished agent answer only, cut to `max_chars` (default and cap 20,000), never the user's messages, tool output or cards. The answer comes with the report's framing line: it is another agent's output, not instructions.
- `stop_session` cancels the running turn as the user's Stop does. It does not archive, end a delegation or remove a worktree.
- Neither tool needs a grant or shows a card.
- `STATE_VERSION` stays 2; `openedBy.handle` is optional and read leniently (`^session-[1-9][0-9]{0,5}$`), in `persistence.ts` and `store.rs`.
- Targeted tests only locally; stage explicit paths; Conventional Commits; push with the SSH keepalive; a line under Unreleased in `CHANGELOG.md`.

## Review Focus

1. **A handle that names someone else's session**: another opener's `session-1`, an archived one, a delegate whose link ended, a handle that is a real session id. Expected: refused, same sentence. Test in Task 2.
2. **Two sessions opened in one tick**: expected, two different handles. Test in Task 1.
3. **A session opened before handles existed** (phase 3 state): expected, it is listed without a handle and cannot be read or stopped by one; nothing crashes. Test in Task 1.
4. **`read_session` on a session whose transcript is not loaded** (opened in an earlier run, never viewed): expected, its saved transcript is read; a transcript that cannot be read answers that it could not be read. Test in Task 2.
5. **`stop_session` on a session that waits on a permission card, or is idle, or is still starting**: expected, a working or waiting turn is cancelled as Stop does; an idle one says nothing was running. Test in Task 2.

---

### Task 1: Handles

**Files:** `src/types/index.ts`, `src/lib/persistence.ts`, `src/lib/agent-tools.ts`, `src/hooks/useOpenedSessions.ts`, `src/hooks/useAgentTools.ts` (answers carry handles), `src-tauri/src/store.rs`; tests `src/test/agent-tools-rules.test.ts`, `src/test/use-opened-sessions.test.tsx`, `src/test/use-agent-tools.test.tsx`, `src/test/persistence.test.ts`, `src-tauri/tests/it/store_test.rs`.

**Interfaces (produced):**
- `OpenedByLink.handle?: string`; Rust `OpenedByRecord.handle: Option<String>`.
- `nextSessionHandle(taken: readonly string[]): string` — `session-N`, N one more than the highest in `taken`.
- `handleOf(session: Session): string | undefined` — an opened session's stored handle; a delegate's agent id while its link is open.
- `ownedByHandle(openerId: string, handle: string, sessions: readonly Session[]): Session | undefined`.
- `useOpenedSessions.open` issues the handle (a ref keeps handles issued before their session is listed) and returns it in `OpenResult`; `ListedOpened.handle?`, `ListedAgent.delegate.handle`.
- `delegateResultText` and `openedResultText` gain `handle`.

- [ ] Tests first (each bullet of Review Focus 1 to 3 for `ownedByHandle`/`nextSessionHandle`; `open` gives two handles in one tick; the answers carry handles; `openedBy.handle` round trips in TS and Rust and a malformed one is dropped alone), run them failing, implement, run them passing, commit `feat: handles for the sessions an agent started`.

### Task 2: `read_session` and `stop_session`

**Files:** `src/lib/agent-tools.ts`, `src/lib/delegation.ts` (export the framing line), `src/hooks/useAgentTools.ts`, `src/App.tsx`; tests `src/test/agent-tools-rules.test.ts`, `src/test/use-agent-tools.test.tsx`, `src/test/delegation-app.test.tsx`.

**Interfaces (produced):**
- `readSessionText(input: { messages: readonly ChatMessage[]; state: DelegateState; cwd: string; maxChars?: number }): string` — `JSON.stringify({ state, answer, files, note })`; with no finished answer, `answer: null` and `note: 'It has not finished an answer yet.'`; a cut answer says so in `note`.
- `AgentToolsDeps` gains `messagesOf: (sessionId: string) => Promise<ChatMessage[]>`, `stateOf: (sessionId: string) => DelegateState`, `stopTurn: (sessionId: string) => void`.
- `read_session`: resolve the handle, `messagesOf`, answer; a rejected `messagesOf` answers `That session could not be read.`
- `stop_session`: `working` or `needs-answer` → `stopTurn`, answer `{ stopped: true }`; `idle` → `{ stopped: false, note: 'It was not working.' }`.
- `App.tsx`: `messagesOf` is the loaded transcript, else `loadTranscript` from disk; `stopTurn` is `handleInterrupt`.

- [ ] Tests first (Review Focus 1, 4, 5; no card and no grant needed; the answer holds no session id; `max_chars`), run them failing, implement, run them passing, commit `feat: let an agent read and stop the sessions it started`.

### Task 3: Popout, the command path, docs, PR

**Files:** `src/test/popout.test.tsx` (a Zorvo card in a popout's snapshot forwards its answer as `choose-option`), `src/lib/agent-tools-context.ts` (+ its test; names `read_session` and `stop_session`, at most 700 characters), `CLAUDE.md`, `CHANGELOG.md`, the spec ("Phases": all four built).

- [ ] Tests first where there is behaviour, then docs, one fresh review of the whole branch with fixes for Critical and Important findings test-first, push, PR against `main` (stacked on phase 3 until that merges). Do not merge.
