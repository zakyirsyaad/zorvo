# Redesign phase 4a: messages, tool calls, cards and turn status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat of the spec: your message as a bubble on the right, the agent's with a logo/name/time header, message actions on hover or focus, tool runs with verbs, targets and status words, the permission and elicitation cards in their new shape, and the working, stalled and failed states under the last message.

**Architecture:** Restyle the existing chat components in place (`MessageRow`, `MessageActionBar`, `UserMessageBar`, `ToolsPart`, `ToolCallList`, `ToolDetails`, `ActionCard`, `ElicitationCard`, `WorkingIndicator`, `AgentStallNotice`, `FailedTurnBanner`), with the wording in small pure helpers in `src/lib/` so it is unit-tested. No data model changes: what the transcript does not carry (a command's exit code and duration) is not shown.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`, section "Chat and composer" (Messages, Tool calls, Cards that wait for you, Turn status) and "Accessibility". The composer, its menus and the new-session draft are phase 4b.

## Global Constraints

- Tokens only, no raw colors (`design-tokens.test.ts`); `fg-subtle` never on `surface-hover` (`theme-contrast.test.ts`). Type scale: `text-body` (14/22), `text-ui` (13/18), `text-ui-sm`, `text-caption` (11/16).
- `src/components/ui/` primitives (`Button` variants `primary | outline | ghost | danger`, `IconButton`, `StatusLine`); `focus-ring` on every control.
- Every status is a word next to its icon or dot; hover-only actions also appear on keyboard focus.
- Copy: sentence case, plain, agents by name.
- `index.html` keeps `select-none` on `<body>`; message text keeps `data-selectable-text` with `select-text [&_button]:select-none` (`chat-reply.test.tsx`).
- Light local checks: the test files a task names plus `pnpm lint`; the full suite once before the final review.

## Decisions this plan makes (against the spec's letter)

- **One summary row per run of tools, not per turn.** An agent message interleaves text and tools; folding every tool of a turn into one row would move them away from the text they belong to (`chat-canvas.test.tsx` pins the order). The existing `summarizeTools` wording stays ("Read 2 files, ran a command").
- **No exit code or duration on commands, and no link from an edit to the Changes tab.** `ToolExecution` carries neither an end time nor an exit code, and the Changes tab cannot select a file yet. Edits show `+N −N` when a diff detail is present.
- **The permission card's header icon stays `AlertTriangle`.** The spec's `ShieldAlert` belongs to risky modes in the composer's mode menu (4b), where it already is.

## Review Focus

1. A permission whose agent title does not start with a verb, or is empty, gets the fallback title "<Agent> wants your permission", never a broken sentence (Task 4).
2. A tool still `running` in a turn that has ended reads "Did not finish"; in the running turn it shows a spinner and claims nothing (Task 3).
3. Keyboard users reach the message actions: the row reveals on focus within the message, not only on hover (Task 2).
4. A replayed message with no time, or a very long agent name, keeps a one-line header with no "ago" (Task 1).
5. The failed-turn banner still offers Try again (disabled while busy), Details and dismiss after moving under the last message (Task 6).

---

### Task 1: Message layout — your bubble, the agent's header

**Files:**
- Modify: `src/components/chat/MessageRow.tsx`, `src/components/ChatCanvas.tsx` (new prop), `src/App.tsx` and `src/components/PopoutApp.tsx` (pass it)
- Test: `src/test/chat-canvas.test.tsx`

**Interfaces:**
- Produces: `ChatCanvasProps.agentProfileId?: string` → `MessageRowProps.agentProfileId?: string`, used for `AgentLogo`.

Your message: no header row; the body is `ml-auto max-w-[85%] rounded-2xl bg-surface-2 px-4 py-3 text-body text-fg` (no border), aligned right. The agent's message: a header `flex items-center gap-2` with `AgentLogo` (`size={16}`, `name=""`), the name in `text-ui font-medium text-fg-secondary truncate`, and the time (`formatRelativeTime` of the message's `timestamp`) in `text-caption text-fg-muted` when known; the body has no bubble, `text-body text-fg-secondary`. Cards keep their place in the body.

- [ ] **Step 1: Write the failing tests** in `chat-canvas.test.tsx`: `shows your message as a bubble on the right without a header` (the user body has `bg-surface-2` and `ml-auto`, no "You" text); `heads the agent's message with its logo, name and time` (the name text "Codex" and "2 minutes ago" inside the message's header element); `leaves the time out of a replayed message's header` (no `/ago/` in a message without `timestamp`).
- [ ] **Step 2: Run** `pnpm vitest run src/test/chat-canvas.test.tsx` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement**; migrate existing assertions on "You", the `User`/`Sparkles` header and `/ago/` placement (the agent's time now shows in its header also during a running turn).
- [ ] **Step 4: Run** `pnpm vitest run src/test/chat-canvas.test.tsx src/test/chat-reply.test.tsx src/test/chat-jump.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: your message as a bubble, the agent's with a header`.

### Task 2: Message actions on hover or focus

**Files:**
- Modify: `src/components/MessageActionBar.tsx`, `src/components/chat/UserMessageBar.tsx`, `src/components/chat/MessageRow.tsx`
- Test: `src/test/chat-canvas.test.tsx`, `src/test/chat-wiring.test.tsx`, `src/test/acp-app.test.tsx`, `src/test/popout.test.tsx`

**Interfaces:**
- Produces: `MessageActionBarProps` without `timeLabel`; Fork's label becomes `"Fork from here"`. `UserMessageBarProps` keeps `timeLabel` (your message's time stays in its row).

Both rows are icon-only `IconButton`s, left-aligned with the message text (`-ml-1.5 mt-1 flex items-center gap-0.5`), revealed by the message root's `group` with `REVEAL_ON_ROW` from `lib/sidebar-status` (opacity 0 until `group-hover` or `group-focus-within`). Agent: Copy message (the copied state is a `Check` in `text-status-running`, label "Copied"), Fork from here (`GitBranch`), Read aloud / Stop reading. You: the time, Copy message, Rewind to here (its confirm step unchanged). Shown only when `showActions`, as today.

- [ ] **Step 1: Write the failing tests**: `reveals a message's actions on hover or keyboard focus` (the bar's className contains `group-focus-within:opacity-100` and `group-hover:opacity-100`; the message root has `group`); `offers Fork from here on the agent's message` (button "Fork from here").
- [ ] **Step 2: Run** `pnpm vitest run src/test/chat-canvas.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**, then migrate "Fork branch" to "Fork from here" in the `chat-canvas`, `chat-wiring`, `acp-app` and `popout` tests.
- [ ] **Step 4: Run** `pnpm vitest run src/test/chat-canvas.test.tsx src/test/chat-wiring.test.tsx src/test/acp-app.test.tsx src/test/popout.test.tsx src/test/failed-turn-banner.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: message actions on hover or focus`.

### Task 3: Tool runs — summary, verbs, targets and status words

**Files:**
- Modify: `src/lib/tool-summary.ts`, `src/components/chat/ToolsPart.tsx`, `src/components/chat/ToolCallList.tsx`, `src/components/chat/ToolDetails.tsx`, `src/components/chat/MessageRow.tsx` (pass `isTurnOver`)
- Test: `src/test/tool-summary.test.ts`, `src/test/tools-part.test.tsx`, `src/test/tool-call-list.test.tsx`, `src/test/chat-canvas.test.tsx`, `src/test/chat-long-session.test.tsx`

**Interfaces:**
- Produces in `lib/tool-summary.ts`:
  - `toolRow(tool: ToolExecution): { verb: string; target?: string }` — by `kind`: `execute` → "Ran" + `command`; `read` "Read", `edit` "Edited", `delete` "Deleted", `move` "Moved" + the first of `locations`; `search` → "Searched" + the first location if any; `fetch` → "Fetched" + the first location; any other kind, or a file kind with no location → `{ verb: tool.name }`.
  - `toolStatusWord(tool: ToolExecution, isTurnOver: boolean): "Done" | "Failed" | "Did not finish" | null` — `completed` "Done", `failed` "Failed", `running` → "Did not finish" when `isTurnOver`, else `null` (a spinner).
  - `stillRunning(tools: readonly ToolExecution[], isTurnOver: boolean): number` — running tools while the turn is not over, else 0.
- `ToolsPartProps` and `ToolCallList` gain `isTurnOver: boolean` (`MessageRow` passes `showActions`).

Summary row: the card stays `rounded-lg border border-border bg-bg`; the label is `summarizeTools(tools)` (no longer the running tool's name); on the right "N still running" in `text-caption text-fg-muted` while any run, and "{n} failed" in `text-danger`. Each expanded row: kind icon (`Terminal` execute, `FileText` read, `Pencil` edit, `Trash2` delete, `Search` search, `Globe` fetch, else `Wrench`), the verb in `text-ui text-fg-secondary`, the target in `font-mono text-ui-sm text-fg-muted truncate` with `title` the agent's full title, then the status word (Done in `text-status-running`, Failed in `text-danger`, Did not finish in `text-fg-muted`) or a `Loader2` spinner with an sr-only "Running". An edit with a `diff` detail shows `+N −N` (`countChanges(diffRows(...))`) before the status. Command output (`TextOutput`) sits on `bg-terminal-bg` with `text-terminal-fg-subtle`.

- [ ] **Step 1: Write the failing tests**: `tool-summary.test.ts` — `toolRow` cases (execute with a command → `{verb:"Ran", target:"pnpm test"}`, edit with a location, a file kind without location → the name, an unknown kind → the name); `toolStatusWord` four cases; `stillRunning`. `tools-part.test.tsx` — `says how many tools still run` ("1 still running"); `reads Did not finish for a tool left running when the turn is over`. `tool-call-list.test.tsx` — `shows the verb, the target and the status word` ("Edited", "src/app.ts", "Done"), `counts an edit's lines` ("+2", "−1"), `shows a command's output on the terminal ground` (the `pre`'s container has `bg-terminal-bg`).
- [ ] **Step 2: Run** `pnpm vitest run src/test/tool-summary.test.ts src/test/tools-part.test.tsx src/test/tool-call-list.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; migrate assertions on the old row text (`"Edit src/app.ts"` becomes verb + target; buttons are found by `/Edited.*src\/app\.ts/`), the sr-only "Completed" (now the visible "Done"), and the summary showing the running tool's name.
- [ ] **Step 4: Run** `pnpm vitest run src/test/tool-summary.test.ts src/test/tools-part.test.tsx src/test/tool-call-list.test.tsx src/test/chat-canvas.test.tsx src/test/chat-long-session.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: tool runs with verbs, targets and status words`.

### Task 4: The permission card

**Files:**
- Create: `src/lib/permission-copy.ts`
- Modify: `src/components/ActionCard.tsx`, `src/components/chat/MessageRow.tsx`, `src/components/compare/CompareRunRow.tsx` (pass `agentName`)
- Test: `src/test/permission-copy.test.ts` (new), `src/test/chat-canvas.test.tsx`, `src/test/user-questions.test.tsx`, `src/test/compare-run-panel.test.tsx`

**Interfaces:**
- Produces: `permissionTitle(agentName: string, prompt: string): string` — when the prompt's first word, lowercased, is one of `edit, write, create, delete, remove, move, rename, read, run, execute, fetch, open, search, install, use`: `"<Agent> wants to <prompt with its first letter lowercased>"`; otherwise `"<Agent> wants your permission"`. `orderedChoices(options: readonly PermissionChoice[]): PermissionChoice[]` — `reject*` kinds first, then `allow_always`, then `allow_once`, keeping the agent's order within a kind.
- `ActionCardProps.agentName?: string` ("The agent" when absent).

The card keeps `rounded-xl border border-attention-border bg-attention-surface p-4`; its `h2` is `permissionTitle(...)` (no "Permission requested", no "Tool: X" badge); the prompt line stays only in the fallback case, where the title does not hold it; the command snippet stays in mono. Buttons in `orderedChoices` order with variants: reject kinds `ghost`, `allow_always` `outline`, `allow_once` `primary`; labels stay the agent's. A card with questions keeps its form and its Submit/Cancel.

- [ ] **Step 1: Write the failing tests**: `permission-copy.test.ts` — "Edit src/app.ts" → "Claude Code wants to edit src/app.ts"; "Run pnpm test" → "Claude Code wants to run pnpm test"; "src/app.ts" and "" → "Claude Code wants your permission"; `orderedChoices` puts reject, always, once in that order. `chat-canvas.test.tsx` — `titles a permission with what the agent wants`, `orders Deny, Always allow and Allow once` (button order by document position; the reject button has no `bg-danger-surface`).
- [ ] **Step 2: Run** `pnpm vitest run src/test/permission-copy.test.ts src/test/chat-canvas.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; migrate the "Permission requested" and `/Tool: Bash/` assertions.
- [ ] **Step 4: Run** `pnpm vitest run src/test/permission-copy.test.ts src/test/chat-canvas.test.tsx src/test/user-questions.test.tsx src/test/compare-run-panel.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: the permission card says what the agent wants`.

### Task 5: The elicitation card

**Files:**
- Modify: `src/components/chat/ElicitationCard.tsx`
- Test: `src/test/elicitation-card.test.tsx`

The shell becomes `rounded-xl border border-border-strong bg-surface-2 p-4` with a `MessageSquare` icon in `text-fg-muted` (it is not a permission); Decline is `ghost`, Submit `primary`, Dismiss stays `ghost`. Copy unchanged.

- [ ] **Step 1: Write the failing test**: `looks like a question, not a permission` (the card root has `bg-surface-2` and `border-border-strong`, not `bg-attention-surface`; Decline does not have the outline variant's `border-border-strong`).
- [ ] **Step 2: Run** `pnpm vitest run src/test/elicitation-card.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/test/elicitation-card.test.tsx src/test/use-acp-elicitation.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: the elicitation card as a question`.

### Task 6: Turn status under the last message

**Files:**
- Modify: `src/components/chat/ReplyExtras.tsx` (`WorkingIndicator`), `src/lib/agent-stall.ts`, `src/components/chat/AgentStallNotice.tsx`, `src/components/FailedTurnBanner.tsx`, `src/components/ChatCanvas.tsx`, `src/App.tsx`
- Test: `src/test/chat-canvas.test.tsx`, `src/test/agent-stall-notice.test.tsx`, `src/test/failed-turn-banner.test.tsx`, `src/test/notice-banners.test.tsx`

**Interfaces:**
- Produces: `WorkingIndicator({ agentName: string; since?: number })` — `StatusLine status="running"` with "<Agent> is working" and, when `since` is known, the elapsed time (`formatElapsed(now - since)` from `lib/background-tasks`, ticking once a second); keeps `data-testid="agent-working" role="status"`. `ChatCanvas` passes the `timestamp` of the running turn's newest user message as `since`.
- `ChatCanvasProps.footer?: ReactNode`, rendered after the turn status inside the scrolling column; App passes `FailedTurnBanner` there instead of above the chat.

Stalled: the silent-agent text gains " It may be stuck." (`stallNoticeText`); the notice becomes muted (`rounded-lg border border-border bg-surface-1 px-3 py-2 text-ui-sm text-fg-muted`) with Stop (`outline`). Failed: `FailedTurnBanner` drops `NOTICE_BANNER_LAYOUT` for `rounded-lg border border-danger bg-danger-surface px-3 py-2 text-ui-sm text-danger`, keeps `role="alert"`, Try again (`outline`, disabled while busy), Details and Dismiss notice.

- [ ] **Step 1: Write the failing tests**: `chat-canvas.test.tsx` — `says which agent is working and for how long` ("Codex is working", "45s" with fake timers); `shows the footer under the last message` (the footer's text follows the last message in document order). `agent-stall-notice.test.tsx` — the text ends "It may be stuck."; the notice has `text-fg-muted`, not `bg-attention-surface`. `failed-turn-banner.test.tsx` — `the banner keeps Try again, Details and dismiss in its new place` (rendered as `ChatCanvas`'s `footer`).
- [ ] **Step 2: Run** `pnpm vitest run src/test/chat-canvas.test.tsx src/test/agent-stall-notice.test.tsx src/test/failed-turn-banner.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; migrate `notice-banners.test.tsx`'s failed-turn layout assertion and any `/working/i` match that no longer fits.
- [ ] **Step 4: Run** `pnpm vitest run src/test/chat-canvas.test.tsx src/test/agent-stall-notice.test.tsx src/test/failed-turn-banner.test.tsx src/test/notice-banners.test.tsx src/test/acp-app.test.tsx src/test/popout.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: working, stalled and failed under the last message`.

### Task 7: Docs

**Files:**
- Create: `docs/design-system/components/Message/README.md` and `preview.html` (`<!-- @dsCard group="Chat" height=200 -->`, variables from `tokens.json` only)
- Modify: `docs/design-system/components/PermissionCard/README.md` and its `preview.html`, `CHANGELOG.md`
- Test: `src/test/design-system-docs.test.ts`, `src/test/design-tokens.test.ts`

The Message README covers both messages, the actions row, tool runs and the turn status; PermissionCard covers the sentence title, the order and variants of its buttons, and the elicitation card's look. CHANGELOG line: "**The chat reads more easily.** Your messages are bubbles on the right, the agent's have its logo, name and time, and Copy, Fork and Rewind show when you point at a message or tab to it. Tool runs say what each tool did and whether it finished, a permission says what the agent wants, and the working, stalled and failed states sit under the last message."

- [ ] **Step 1: Write** the docs and the CHANGELOG line.
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts` — Expected: PASS.
- [ ] **Step 3: Commit** `docs: the chat in the design system`, then the full suite once and the whole-branch review before pushing.
