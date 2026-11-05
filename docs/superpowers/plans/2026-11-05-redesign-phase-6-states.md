# Redesign phase 6: the other states — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the states around the chat to the spec's "Other states":
- the compare run panel as one card per agent, with a confirm bar for Pick;
- the draft blockers (install, sign-in with every method, removed agent) as one `surface-2` card each, with the agent's logo;
- the terminal sign-in dialog;
- the no-folder empty state;
- the app update notice as a card.

**Architecture:**
- One new primitive, `ui/BlockerCard`, gives the install, sign-in and removed-agent cards (and phase 7's setup card) one shape: logo, title, body, actions on the right.
- Every component keeps its props, hooks and behavior. Only its markup and copy change, plus the two behavior changes the spec asks for in the compare panel.
- `App.tsx` only moves the blockers next to the composer, routes the no-folder case to the empty state, and moves the update card into the toast anchor.

**Tech Stack:** React 19, Tailwind 4 tokens, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`, section "Other states". The agent setup card and its terminal command are phase 7.

## Global Constraints

- **Tokens and primitives.**
  - Tokens only: `text-ui` and `text-ui-sm` for rows, `text-caption` for hints and status lines, `text-body` where prose.
  - No raw colors (`design-tokens.test.ts`), and `focus-ring` on every control.
  - `Button` / `IconButton`. Shadows are `shadow-popover` / `shadow-dialog`.
- **Every status is a word next to its dot** (`ui/StatusLine`). Color never stands alone.
- **No secret fields.** A sign-in method Zorvo cannot run (`kind: "explain"`) shows its name and "In your shell" with one line, never an input (CLAUDE.md: the app never asks for or stores API keys).
- **Live regions stay.**
  - `AuthPanel`'s status line is always mounted (`role="status"`).
  - `SignInLayer`'s sr-only live region stays mounted before the panel.
  - The install step line is `role="status"`.
  - The app update notice does not announce each percent.
- **Behavior stays.** Every component's handlers, props and the hooks behind them stay. The only behavior changes are the two the spec names for the compare panel: Pick always asks, and Pick is disabled while a row has no changes.
- **Copy:** the spec's strings verbatim:
  - "N agents, each in its own worktree · started 12 min ago";
  - "Keep Codex's work and archive the others?" and "Pick <Agent>";
  - "<Agent> isn't installed yet" and "Install <Agent>";
  - "Sign in to <Agent>", "In your shell", "Your message will be sent again after you sign in" and "Check again";
  - "<Agent> is no longer in use", "Add it again to continue this session. Its messages stay here either way." and "Add <Agent>";
  - "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this." and "Close";
  - "Open a folder to start", "Pick a project folder. Your agents work inside it, and its sessions show in the sidebar." and "Open folder";
  - "Zorvo <version> is ready", "Later", "Update & restart", "Downloading…" and "Installing…".
- **Light checks:** targeted test files while working, and the full `pnpm test` once at the end. There are no Rust changes.

## Decisions taken here (the spec leaves them open, or the code argues with it)

- **"Draft blockers take the composer's place"** becomes "sit in the composer's place, directly above it". The install and sign-in cards render in the slot right before the composer, in the same 680px column, and the composer stays visible. Two existing rules depend on the box staying:
  - a draft's prompt can be written while its agent installs (`sendDisabled`, not `disabled`);
  - a refused message comes back into the box (`giveBack`), which the sign-in card's status line refers to.

  Hiding the box would break both. The removed-agent card already replaces the composer (`isComposerHidden`) and keeps doing so. **This is the one deviation to confirm with the user before executing.**
- **Pick is disabled only when the row's changes are known and empty.**
  - The row, not `Changes`, reads `useDiffStatsSince`. It passes `stats` and `error` to a presentational `Changes`, and gives Pick `disabled={isPickDisabled || stats?.length === 0}`.
  - While the stats load, or when the read fails, Pick stays enabled, so a stats failure never strands the run.
  - The disabled button says why in its `title`: "No changes to keep yet".
- **Pick always raises the confirm bar.**
  - The first line is "Keep <Agent>'s work and archive the others?".
  - When others still work, a second line follows: "This stops <A> and <B> mid-turn.".
  - The buttons are Cancel and **Pick <Agent>**. The bar is sticky at the panel's bottom.
- **The run's start** is the oldest session's `createdAt` (`run.sessions[0]`), through `formatRelativeTime` ("started 12 min ago").
- **The row's status dot.** `RunRowStatus` maps to `StatusLine`:
  - starting and working → `running`;
  - needs-you and needs-sign-in → `attention`;
  - failed → `danger`;
  - done and stopped → `idle` (the word alone).
- **The empty state** shows when no folder is open (`!activeWorkspace`), in the chat's place. The composer stays mounted (disabled, as now) so its slot never moves. The spec allows the real Zorvo symbol in place of the tile; this phase uses the 48px tile with a `FolderOpen` icon. The unused `EmptySessionState` is removed.
- **The update card** sits at the bottom right of the main area, in the anchor the toasts use (`ToastStack`, above the composer), so it never covers Send or Stop.

## Review Focus

1. **A run whose agents all finish while the confirm bar is open** keeps the bar, now with no "stops" line, and Pick still works (Task 1).
2. **A sign-in agent with only `explain` methods** (keys only) shows no sign-in button, only Dismiss and **Check again**. The lead is `authCopy`'s keys lead (Task 3).
3. **The install card while installing.** The `role="status"` line changes as the phase moves, the bytes stay in the progress bar, and focus does not jump to Cancel (Task 2).
4. **The terminal dialog's focus.** While the login runs, the terminal has focus. Escape closes, and Close (or Try again after a failure) takes focus when it stops (Task 5).
5. **The update notice during an install**, with Later hidden and the button disabled. The words move "Downloading…" → "Installing…", and the percent is not announced (Task 7).

---

### Task 1: The compare run panel

**Files:**
- Modify: `src/components/compare/CompareRunPanel.tsx`, `src/components/compare/CompareRunRow.tsx`, `src/lib/compare-run.ts`
- Test: `src/test/compare-run-panel.test.tsx`

**Interfaces:**
- Produces:
  - `export function runStatusDot(status: RunRowStatus): Status`, in `lib/compare-run.ts` (`Status` from `components/ui/StatusLine`).
  - `export function pickQuestion(winnerName: string): string`: "Keep Codex's work and archive the others?".
  - `export function stopsLine(names: readonly string[]): string`. One name gives "This stops Claude Code mid-turn.", two give "This stops Claude Code and Qwen Code mid-turn.", and three give "This stops A, B and C mid-turn.".
  - `stopQuestion` is removed.

- [ ] **Step 1: Write the failing tests.**
  - The panel shows the heading `run.name` and "2 agents, each in its own worktree · started 12 min ago" (`createdAt` 12 minutes before now, with fake timers).
  - Each agent is a `listitem` named by the agent, with:
    - the `StatusLine` word from `statusLabel`;
    - its changes "4 files +86 −12" as a button named "Review Codex's changes";
    - **Open Codex** and **Pick Codex**.
  - A row whose stats come back `[]` has **Pick Codex** disabled, with title "No changes to keep yet".
  - Clicking Pick on a row with changes, with no one working, shows a group named "Confirm pick" with "Keep Codex's work and archive the others?". It does not call `onPick`. Pressing **Pick Codex** in that group calls `onPick("s-codex")`; Cancel closes it without a call.
  - With another agent working, the bar also reads "This stops Claude Code mid-turn."
  - `pickQuestion`, `stopsLine` (one, two and three names) and `runStatusDot` for every `RunRowStatus`.
  - **Review Focus 1:** the bar stays when the working agent finishes; its "stops" line goes.
  - Migrate the existing tests that relied on Pick acting at once for idle runs: they now press Pick, then **Pick <Agent>** in the bar.
- [ ] **Step 2:** Run `pnpm vitest run src/test/compare-run-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Cards are `<li className="rounded-xl border border-border bg-surface-1 p-4">` in a `space-y-3` list.
  - The first line is the logo, the name (`text-ui font-medium`) and `StatusLine` (`text-caption`).
  - The second line is the changes numbers on the left, then **Open** (outline, named "Open <Agent>") and **Pick** (primary, named "Pick <Agent>") on the right.
  - The pending card (`ActionCard`) stays under the row.
  - The confirm bar is `sticky bottom-0`: `rounded-xl border border-border-strong bg-surface-2 p-4 shadow-popover`.
  - Remove the auto-close `useEffect`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the compare run as one card per agent, and Pick always asks`.

### Task 2: `BlockerCard` and the install card

**Files:**
- Create: `src/components/ui/BlockerCard.tsx`
- Modify: `src/components/AgentInstallPanel.tsx`, `src/components/InstallProgressLine.tsx`
- Test: `src/test/ui-primitives.test.tsx`, `src/test/agent-install.test.tsx`

**Interfaces:**
- Produces:
  - `BlockerCard({ label: string; profileId?: string; title: string; children: ReactNode; actions?: ReactNode; footer?: ReactNode })`.
  - It renders a `<section aria-label={label}>` as `rounded-xl border border-border bg-surface-2 p-4`.
  - Inside are `AgentLogo` (24px, `name=""`), an `h2` (`text-ui font-medium text-fg`), the body (`text-ui-sm text-fg-muted`), the actions right-aligned on the title's row, and the footer under a `border-t border-border pt-3 mt-3`.
  - The step text of `InstallProgressLine` is a `role="status"` paragraph. When the progress reports `totalBytes`, the size follows it through `formatSize` (`lib/file-content.ts`): "Downloading Node.js (12 MB)".

- [ ] **Step 1: Write the failing tests.**
  - `BlockerCard` renders the logo, the heading, the body, the actions and the footer, named by `label`.
  - Agent install:
    - Idle: a card named "Install Codex" with "Codex isn't installed yet", the `describePlan` sentence, and a primary **Install Codex**.
    - While installing: a `role="status"` line with the step and its size, the progress bar, and **Cancel**.
    - Failed: the reason and **Retry**.
  - **Review Focus 3:** while installing, `document.activeElement` is not Cancel unless it was clicked.
  - Migrate the button name "Install" to "Install Codex" in the existing tests.
- [ ] **Step 2:** Run `pnpm vitest run src/test/ui-primitives.test.tsx src/test/agent-install.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. `useAgentInstall` and its states are unchanged.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: a blocker card, and the install card in it`.

### Task 3: The sign-in card with every method

**Files:**
- Modify: `src/components/AuthPanel.tsx`, `src/components/SignInLayer.tsx` (passes `profileId`)
- Test: `src/test/auth-panel.test.tsx`, `src/test/sign-in-layer.test.tsx`

**Interfaces:**
- Consumes: `BlockerCard` (Task 2), `authCopy`, `signInButtonLabel` and `plainReason`.
- Produces: `AuthPanelProps` gains `profileId?: string`. Everything else is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - The card is named "Sign in to Gemini CLI" and lists every method as a `listitem`.
  - An `agent` or `terminal` method has a button worded by `signInButtonLabel`.
  - An `explain` method shows its name, the words "In your shell", and its description as the one line, with **no button and no textbox**.
  - The footer holds the always-mounted `role="status"` line, **Dismiss** (the existing `aria-label="Dismiss sign-in"`) and **Check again**.
  - While `hasReturnedMessage` and idle, the status line reads "Your message will be sent again after you sign in". "checking" and "failed" take precedence.
  - **Review Focus 2:** with only `explain` methods, the lead is `authCopy`'s keys lead, and the card's only buttons are Dismiss and Check again.
  - Migrate any test that pinned the old "Your message is back in the box below…" paragraph.
- [ ] **Step 2:** Run `pnpm vitest run src/test/auth-panel.test.tsx src/test/sign-in-layer.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement on `BlockerCard`. `SignInLayer` passes the requested agent's id as `profileId`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the sign-in card lists every method`.

### Task 4: The removed-agent card, and the blockers beside the composer

**Files:**
- Modify: `src/components/RemovedAgentPanel.tsx`, `src/App.tsx`
- Test: `src/test/removed-agent.test.tsx`, `src/test/new-session.test.tsx`

**Interfaces:**
- Consumes: `BlockerCard`.
- Produces: `RemovedAgentPanelProps` gains `profileId?: string`.

- [ ] **Step 1: Write the failing tests.**
  - The removed-agent card reads "Codex is no longer in use" and "Add it again to continue this session. Its messages stay here either way.", with a primary **Add Codex** that calls `onAdd`.
  - In `new-session.test.tsx`, a draft whose agent is not installed shows the install card after the "New session in …" heading and before the prompt in document order (`compareDocumentPosition`), and the prompt is still enabled.
- [ ] **Step 2:** Run `pnpm vitest run src/test/removed-agent.test.tsx src/test/new-session.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `App.tsx`, move `<SignInLayer …>` and the `AgentInstallPanel` from the top of the `<article>` to just before the composer's `<div hidden={isComposerHidden}>`, in a `mx-auto w-full max-w-3xl px-4` wrapper.
  - The composer's slot, index and key are untouched (phase 4b's rule).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the blockers sit by the composer, and the removed-agent card`.

### Task 5: The terminal dialog

**Files:**
- Modify: `src/components/TerminalSignInDialog.tsx`, `src/components/SignInLayer.tsx` and `src/components/AppSettingsDialog.tsx` (pass `profileId`)
- Test: `src/test/terminal-sign-in.test.tsx`

**Interfaces:**
- Produces: `TerminalSignInDialogProps` gains `profileId?: string`.

- [ ] **Step 1: Write the failing tests.**
  - The dialog has `max-w-[760px]` and `shadow-dialog`.
  - Its heading "Sign in to Qwen Code" sits beside the agent's logo.
  - While running, the status line reads "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this." (a `note` still wins).
  - The terminal's container is `h-[380px]` with `bg-terminal-bg`.
  - The footer button is **Close**; after a failure it is **Close** and **Try again**.
  - **Review Focus 4:** the terminal has focus while running, Close or Try again has it otherwise, and Escape closes.
  - Migrate "Cancel" to "Close" and the old running line in the existing tests.
- [ ] **Step 2:** Run `pnpm vitest run src/test/terminal-sign-in.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the header's `IconButton label="Cancel sign-in"`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the terminal sign-in dialog`.

### Task 6: The empty state

**Files:**
- Modify:
  - `src/components/AppPlaceholders.tsx` (`EmptySessionState` → `EmptyFolderState`)
  - `src/App.tsx` (render it in the chat's place while `!activeWorkspace`)
  - `src/components/workspace/NewSessionView.tsx` (drop the no-folder branch of `NewSessionHeading`)
- Test: `src/test/new-session.test.tsx`, `src/test/smoke.test.tsx`

**Interfaces:**
- Produces: `EmptyFolderState({ onOpenFolder: () => void })`.

- [ ] **Step 1: Write the failing tests.**
  - With no recent folders, the app shows a heading "Open a folder to start", the sentence "Pick a project folder. Your agents work inside it, and its sessions show in the sidebar.", and a primary **Open folder** that runs `openFolder`. Assert through the dialog plugin mock in `setup.ts`, or spy on `open`.
  - There is no "New session" heading, and the prompt is disabled, as before.
  - Migrate the no-folder test in `new-session.test.tsx` ("Open a project folder to start a session in it.") to the new copy.
- [ ] **Step 2:** Run `pnpm vitest run src/test/new-session.test.tsx src/test/smoke.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement with a `size-12 rounded-xl border border-border bg-surface-2` tile holding `FolderOpen` (24px, `text-fg-muted`).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the empty state asks for a folder`.

### Task 7: The app update card

**Files:**
- Modify: `src/components/AppUpdateNotice.tsx`, `src/App.tsx`
- Test: `src/test/app-update.test.tsx`

**Interfaces:**
- Produces: `AppUpdateNoticeProps` unchanged.

- [ ] **Step 1: Write the failing tests.**
  - The card reads "Zorvo 0.9.0 is ready" with the `restartWarning` line, **Later** (ghost) and **Update & restart** (outline). It is `role="status"` with `rounded-xl border border-border bg-surface-2 shadow-popover`.
  - **Review Focus 5:**
    - During an install with `progress.phase: "downloading"`, it reads "Downloading…", with the percent `aria-hidden`.
    - With `phase: "installing"`, it reads "Installing…".
    - Later is gone, and the button is disabled.
  - Migrate "is available." to "is ready" in the existing tests.
- [ ] **Step 2:** Run `pnpm vitest run src/test/app-update.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `App.tsx`, the `relative h-0` toast anchor is always present. Its `ToastStack` holds the update card, then the notice toast when there is one.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the app update notice as a card`.

### Task 8: Docs, changelog and the full run

**Files:**
- Create: `docs/design-system/components/BlockerCard/README.md` and `preview.html` (`@dsCard group="Feedback"`)
- Modify:
  - `docs/design-system/components/Dialog/README.md` (the terminal dialog)
  - `CLAUDE.md`, only where a sentence names the old update banner or `EmptySessionState` (`grep -n "EmptySessionState\|update banner" CLAUDE.md` first)
  - `CHANGELOG.md`
- Test: `src/test/design-system-docs.test.ts`, the full suite

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**Clearer cards when something stands in the way.** A compare run shows one card per agent and asks before Pick keeps one. Installing, signing in and a removed agent each get a card by the message box with the agent's logo, and signing in lists every way the agent offers. The terminal sign-in is wider, the empty window asks for a folder, and a Zorvo update shows as a card."
- [ ] **Step 3:** Run `pnpm lint`. Expected: clean.
- [ ] **Step 4:** Run `pnpm test > <workspace>/full.log 2>&1`, then read its last 20 lines. Expected: every file passes. Migrate tests that pinned old copy or the instant Pick, and record a ruling for each.
- [ ] **Step 5:** Commit `docs: the blocker card and the other states`.
