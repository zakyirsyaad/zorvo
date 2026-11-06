# Redesign phase 8d: the compare run, blocker cards, terminal dialog, empty state and update card as drawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main column's other states match the design canvas: the compare run panel, the install, sign-in, setup and removed-agent cards, the terminal sign-in dialog, the empty window and the update card.

**Architecture:**
- The compare run gets one-row cards. Its status words carry the elapsed time and an unread dot, which come from facts the row already reads (`Session.createdAt`, `hasUnread`, the transcript's last finished reply) plus a minute clock.
- `ui/BlockerCard` changes once: a padded shadowed card, a logo tile, and the main button on its own row under the body. The four cards then change only their own copy and rows.
- The dialog, the empty state and the update card are restyled where they are. `restartWarning` gains counts.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:**
- **Audit:** `docs/superpowers/specs/2026-11-05-canvas-conformance-audit.md`, section "8d: other states".
- **Artboards:** `CompareRun.dc.html`, `DraftBlockers.dc.html`, `EmptyUpdate.dc.html` and `SignInDialog.dc.html` in the "Zorvo redesign layouts" Design artifact (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz, `project/`).
- **Behavior:** CLAUDE.md "Compare agents", "Terminal sign-in", "Which agents are ready", "Installer" and "App updates".

## Global Constraints

- **Authority.** The artboard decides the look; the spec and CLAUDE.md decide behavior. No behavior changes beyond the copy and the elapsed time and unread dot named here.
- **Canvas variable → token.**
  - Surfaces and lines: `--bg` `bg`, `--s1` `surface-1`, `--s2` `surface-2`, `--s3` `surface-3`, `--hover` `surface-hover`, `--line` `border`, `--strong` `border-strong`.
  - Text: `--fg` `fg`, `--fg2` `fg-secondary`, `--muted` `fg-muted`, `--subtle` `fg-subtle`.
  - Status: `--run` `status-running`, `--att` `status-attention`, `--unread` `status-unread`, `--danger` `danger`.
  - Shadows: `--pop` `shadow-popover`, `--dlg` `shadow-dialog`.
- **Type.**
  - 13/18 `text-ui`, 12/16 `text-ui-sm`, 11/16 `text-caption`.
  - 20/28 `text-xl` with `tracking-[-0.02em]`; 16/24 `text-base`.
  - Mono is `font-mono`.
- **No raw colours** (`design-tokens.test.ts`). Every focusable control keeps `focus-ring`.
- **Primitives first.**
  - `ui/Button` sizes: `sm` 24, `row` 26, `md` 28, `lg` 32.
  - `ui/Button` variants: `primary`, `outline`, `ghost` (ghost takes `tone`).
  - `ui/IconButton` and `ui/StatusLine` (statuses `running | attention | unread | danger | idle`).
  - A caller's className never sets padding, height or text size on a `Button` (`button-sizes.test.ts`). It may set colour.
- **Copy.** Sentence case and "you". No keyboard shortcuts, no voice input. Zorvo never asks for or stores keys.
- **Checks.** Run the targeted test files while working, and the full suite once at the end. Nothing here touches `src-tauri`.

## Review Focus

1. **An elapsed time that never moves.** A compare card that reads "Working · 12 min" must reach "13 min" a minute later with no agent output, so the panel needs its own clock. Task 1's `useNow` test and Task 2's "the working time moves on with the clock" pin this.
2. **A transcript with no known times.** An imported or replayed reply has `hasKnownTime: false`. A finished card then reads plain "Finished", never a duration made from a replay's timestamp. Task 1 test "a finished row with no known reply time shows no duration".
3. **Install progress announced byte by byte.** The visible line becomes "Downloading Node.js · 18 of 42 MB", but the `role="status"` region must still announce each step, never each byte. Task 4 test "the status announces the step, not the bytes".
4. **Long names and copy in the narrow column.**
   - A long agent name with "Working · 1 h 5 min" and three buttons must not push Pick out of the card.
   - The confirm bar's sentence wraps; its buttons do not.
   - Task 2 test "the card keeps its buttons when the name is long" checks `min-w-0` / `truncate` / `shrink-0`.
5. **The setup card with more than one way in.** An agent that offers setup and sign-in methods together is not `isSetupOnly`, so it gets the sign-in card. Its setup method row's outline button must still read "Open setup in terminal". Task 5 test "a setup method in the sign-in list keeps its own label".

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/compare-run.ts` | Status words, elapsed time, unread dot, the confirm sentence | 1 |
| `src/hooks/useNow.ts` (new) | A clock that ticks once a minute | 1 |
| `src/components/compare/CompareRunPanel.tsx`, `CompareRunRow.tsx` | The panel and its one-row cards | 2 |
| `src/components/ui/BlockerCard.tsx` | The shared card | 3 |
| `src/components/AgentInstallPanel.tsx`, `InstallProgressLine.tsx`, `src/lib/install-plan.ts` | The install card and its progress | 4 |
| `src/components/AuthPanel.tsx`, `src/lib/acp-auth.ts`, `src/components/RemovedAgentPanel.tsx` | The sign-in, setup and removed-agent cards | 5 |
| `src/components/TerminalSignInDialog.tsx` | The terminal dialog | 6 |
| `src/components/AppPlaceholders.tsx`, `AppUpdateNotice.tsx`, `src/lib/app-update.ts` | The empty state and the update card | 7 |
| `docs/design-system/components/{BlockerCard,Dialog,Toast}/README.md`, `CHANGELOG.md` | Docs | 8 |

---

### Task 1: Compare run status words, elapsed time and the confirm sentence

**Files:**
- Create: `src/hooks/useNow.ts`
- Modify: `src/lib/compare-run.ts` (`STATUS_LABELS`, `RowFacts`, `rowFactsOf`, `runStatusDot`, `stopsLine`)
- Test: `src/test/compare-run.test.ts` (extend), `src/test/use-now.test.ts` (new); migrate `compare-run-panel.test.tsx` and `compare-run-start.test.tsx` where they pin "Done" or "This stops … mid-turn."

**Interfaces:**
- Produces:
  - `useNow(intervalMs?: number): number`. `Date.now()`, updated every `intervalMs` (default `60_000`) while mounted.
  - `RowFacts` gains two fields:
    - `finishedAt: number | null`: the timestamp of the last agent message with `isComplete` and `hasKnownTime !== false`, else null;
    - `hasUnread: boolean`: `session.hasUnread === true`.
  - `elapsedWords(ms: number): string`:
    - "1 min" under two minutes;
    - "N min" under an hour;
    - "H h" or "H h M min" from an hour.
  - `rowStatusWords(facts: RowFacts, status: RunRowStatus, now: number): string`:
    - `working` reads `Working · ${elapsedWords(now - session.createdAt)}`;
    - `done` reads `Finished · ${elapsedWords(finishedAt - session.createdAt)}` when `finishedAt` is set, else `Finished`;
    - any other status reads its label.
  - `runStatusDot(status: RunRowStatus, hasUnread = false): Status` returns `"unread"` for `done` with `hasUnread`; everything else is unchanged.
  - `stopsLine(names: readonly string[]): string`:
    - one name: `` `${name} is still working and will be stopped.` ``;
    - more names: `` `${listed} are still working and will be stopped.` ``, with the list built as today ("A, B and C").
  - `STATUS_LABELS.done` is `"Finished"`.

- [ ] **Step 1: Write failing tests:**
  - in `compare-run.test.ts`:
    - `elapsedWords`:
      - `elapsedWords(30_000)` is `"1 min"`;
      - `elapsedWords(12 * 60_000)` is `"12 min"`;
      - `elapsedWords(65 * 60_000)` is `"1 h 5 min"`;
      - `elapsedWords(120 * 60_000)` is `"2 h"`.
    - `rowStatusWords` for working: `"Working · 12 min"` with `createdAt = now − 12 min`.
    - `rowStatusWords` for done: `"Finished · 8 min"` from `finishedAt`.
    - "a finished row with no known reply time shows no duration": a transcript whose last agent message has `hasKnownTime: false` reads `"Finished"`.
    - `runStatusDot("done", true)` is `"unread"`, and `runStatusDot("done")` is `"idle"`.
    - `stopsLine(["Qwen Code"])` is `"Qwen Code is still working and will be stopped."`.
    - `stopsLine(["Qwen Code", "Kimi CLI"])` is `"Qwen Code and Kimi CLI are still working and will be stopped."`.
    - `statusLabel("done")` is `"Finished"`.
  - in `use-now.test.ts`, with fake timers: the value moves by 60 s after `vi.advanceTimersByTime(60_000)`, and the interval is cleared on unmount.
- [ ] **Step 2: Run** `pnpm vitest run src/test/compare-run.test.ts src/test/use-now.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, plus `compare-run-panel.test.tsx` and `compare-run-start.test.tsx`. Migrate their "Done" and "This stops … mid-turn." assertions to the new words. Expected: PASS.
- [ ] **Step 5: Commit** `feat: say how long each compare agent has worked, and who Pick stops`.

### Task 2: The compare run panel and its one-row cards

**Files:**
- Modify: `src/components/compare/CompareRunPanel.tsx`, `src/components/compare/CompareRunRow.tsx`
- Test: `src/test/compare-run-look.test.tsx` (new); migrate `src/test/compare-run-panel.test.tsx`

**Interfaces:**
- Consumes: `useNow`, `rowStatusWords`, `runStatusDot(status, hasUnread)`, `stopsLine` (Task 1).
- Produces:
  - `CompareRunRow` prop `isPicking: boolean` (this row's Pick opened the confirm bar);
  - `CompareRunRow` prop `now: number`.

**Values** (`CompareRun.dc.html`):
- **Panel.**
  - Root `relative flex flex-1 flex-col overflow-y-auto px-6 pt-10 pb-28`. The bottom padding leaves room for the floating bar.
  - Inner `mx-auto flex w-full max-w-chat flex-col gap-4`.
  - Title `text-xl font-semibold tracking-[-0.02em] text-fg`.
  - Subtitle `text-ui text-fg-muted`, under it with `gap-1`.
  - List `flex flex-col gap-2`.
- **Card** (`li`, `aria-label` = agent name, kept):
  - `flex items-center gap-3.5 rounded-xl border bg-surface-2 px-4 py-3.5`, with `border-border-strong` while `isPicking`, else `border-border`.
  - **Logo tile.** `flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-hover`, holding `AgentLogo size={16}`.
  - **Name and status.** `flex min-w-0 flex-1 flex-col`:
    - the name is `truncate text-ui font-medium text-fg`;
    - the status is a `StatusLine` with `runStatusDot(status, facts.hasUnread)` and `text-ui-sm text-fg-secondary`, reading `rowStatusWords(...)`.
  - **Changes.**
    - The button is `flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-caption text-fg-muted hover:bg-surface-hover focus-ring`, reading "3 files" then `+54` (`text-status-running`) and `−9` (`text-danger`). Its `aria-label` "Review <agent>'s changes" is kept.
    - With no changes it is the text "No changes yet" in `shrink-0 text-ui-sm text-fg-subtle`; the old "0 files" goes.
    - Unreadable stats keep "—", with the error in `title`.
  - **Open.** `Button variant="ghost" tone="secondary"` (`md`), `aria-label` kept.
  - **Pick.**
    - `Button variant="outline"` (`md`), `aria-label` kept.
    - While `isPicking` it gets `aria-pressed="true"` and `bg-surface-hover text-fg`.
    - Disabled with no changes: the outline at its 40% disabled opacity, with the title "No changes to keep yet" kept.
  - The pending permission card (`ActionCard`) stays, under the row: the card becomes `flex-col`, with the row as its first child.
- **Confirm bar.**
  - `role="group" aria-label="Confirm pick"`, kept.
  - `absolute bottom-6 left-1/2 flex w-[min(680px,calc(100%-48px))] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 shadow-popover`.
  - The text is one sentence `min-w-0 flex-1 text-ui text-fg`: `pickQuestion(name)` and `stopsLine(working)` joined with a space.
  - Cancel is `Button ghost tone="secondary"`, Pick <agent> is `Button primary` (`md`). Focus handling and Escape are unchanged.

- [ ] **Step 1: Write failing tests:**
  - "a card is one row with a logo tile, the status and its buttons": `bg-surface-2`, `py-3.5`; the tile is `size-7` `bg-surface-hover`; Open's className has `border-transparent`; Pick's has `border-border-strong`.
  - "a finished unread card shows the unread dot": `.bg-status-unread` inside the card.
  - "the working time moves on with the clock": with fake timers, "Working · 12 min", then "Working · 13 min" after 60 s.
  - "with no changes the card reads No changes yet".
  - "picking marks the card and its Pick": the card has `border-border-strong`, and Pick has `aria-pressed="true"`.
  - "the confirm bar floats as one sentence": the bar has `absolute` and `bg-surface-3`, and its text is "Keep Codex's work and archive the others? Claude Code is still working and will be stopped.".
  - "the card keeps its buttons when the name is long": the name has `truncate`, its column has `min-w-0`, and the buttons are `shrink-0` or Buttons.
- [ ] **Step 2: Run** `pnpm vitest run src/test/compare-run-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `CompareRunPanel` calls `useNow()` once and passes `now` and `isPicking` to each row.
- [ ] **Step 4: Migrate** `compare-run-panel.test.tsx`:
  - "0 files" becomes "No changes yet";
  - "Done" becomes "Finished · …";
  - the second line of the confirm bar becomes part of its sentence.
  Run it, plus `compare-run-sign-in.test.tsx`, `compare-run-start.test.tsx` and `button-sizes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the compare run as on the canvas`.

### Task 3: `ui/BlockerCard` as drawn

**Files:**
- Modify: `src/components/ui/BlockerCard.tsx`
- Test: `src/test/ui-primitives.test.tsx:207-241` (migrate and extend)

**Interfaces:**
- Produces: the same props (`label, profileId?, title, children, actions?, footer?`).
  - `actions` now render on their own row under the body: `flex justify-end gap-2`.
  - `children` and `footer` keep their meaning.

**Values** (`DraftBlockers.dc.html` `.blk`):
- **Card.** `flex flex-col gap-3.5 rounded-xl border border-border bg-surface-2 p-[18px] shadow-popover`.
- **Head.** `flex items-start gap-3`:
  - the logo tile is `flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover`, holding `AgentLogo size={18} name=""` (still decorative);
  - the text is `flex min-w-0 flex-1 flex-col gap-1`;
  - the title is `h2 text-ui font-semibold text-fg`;
  - the body is `text-ui text-fg-muted`.
- **Footer.** `border-t border-border pt-3`, with no top margin (the card's gap spaces it).

- [ ] **Step 1: Write failing tests:**
  - "the card is padded 18px with the popover shadow";
  - "its logo sits in a 32px tile";
  - "the title is 600 and the body 13px";
  - "the main button sits on its own row under the body": the actions' parent has `justify-end` and is not inside the head row.
- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, plus `agent-install.test.tsx`, `auth-panel.test.tsx` and `removed-agent.test.tsx`. Migrate only className checks that the new card breaks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the blocker card as on the canvas`.

### Task 4: The install card and its progress

**Files:**
- Modify: `src/components/AgentInstallPanel.tsx`, `src/components/InstallProgressLine.tsx`
- Test: `src/test/agent-install.test.tsx` (migrate and extend)

**Values:**
- **Idle.**
  - Title "{name} isn't installed yet".
  - Body "Zorvo downloads {describePlan(plan)} into its own folder." then "Once it is installed, Zorvo checks whether you are signed in." in the same paragraph.
  - Action `Button primary` "Install {name}" with **no icon**.
- **Installing.**
  - Title "Installing {name}". The body paragraph is replaced by the progress line's status.
  - No action row; Cancel is in the progress block.
- **Failed.** As today ("Install failed: …"), with Retry as `Button primary` and no icon.
- **`InstallProgressLine`.** It keeps its props, and Settings' catalog row uses it too.
  - Status: `<p role="status" className="text-ui text-fg-muted">`.
    - It reads `describePhase(...)` without its trailing "…".
    - When `totalBytes` is known it adds `<span aria-hidden="true"> · {formatSize(received)} of {formatSize(total)}</span>`, so the visible line is "Downloading Node.js · 18 of 42 MB".
    - Before the first report it reads "Starting the install…" as today.
  - Bar:
    - a `<progress>` kept for its role and name, with `h-1 w-full appearance-none overflow-hidden rounded-full bg-surface-hover`;
    - webkit bar `bg-surface-hover`, webkit value `bg-fg-secondary`.
  - Cancel: `Button variant="ghost" tone="secondary"` on its own row, `flex justify-end`.

- [ ] **Step 1: Write failing tests:**
  - "the install card says what Zorvo downloads": "Zorvo downloads Node.js 24.11.1 (49 MB) and Codex 0.4.2 into its own folder. Once it is installed, Zorvo checks whether you are signed in.";
  - "Install has no icon": no `svg` in the button;
  - "while installing the title says so": heading "Installing Codex";
  - "the bar is 4px on a surface-hover track";
  - "the status announces the step, not the bytes": the status region's text without `aria-hidden` children is "Downloading Node.js", and the visible text contains "· 1 KB of 4 KB";
  - "Cancel is a ghost on its own row".
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-install.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate** the old copy ("needs … before it can start", "Downloading Node.js… (1 KB)"). Run it, plus `agent-catalog-ui.test.tsx` (the catalog row uses the same line) and `ui-primitives.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the install card and its progress as on the canvas`.

### Task 5: The sign-in, setup and removed-agent cards

**Files:**
- Modify: `src/components/AuthPanel.tsx`, `src/lib/acp-auth.ts` (`authCopy` lead), `src/components/RemovedAgentPanel.tsx` (layout only, if the card change needs it)
- Test: `src/test/auth-panel.test.tsx` (migrate and extend)
- Migrate the copy in:
  - `src/test/acp-auth.test.ts`
  - `sign-in-layer.test.tsx`
  - `acp-sign-in.test.tsx`
  - `review-message.test.tsx`
  - `compare-run-sign-in.test.tsx`
  - `removed-agent.test.tsx`

**Values:**
- **Sign-in lead.**
  - `authCopy`'s lead for an agent with a method button becomes "Pick how {agent} signs in. It uses its own tool; Zorvo never sees your password or key.".
  - The setup and keys-only leads stay. `cliHint` and `keysNote` stay; see Rulings.
- **Methods.**
  - The list is `ul aria-label="Sign-in methods"` with `rounded-lg border border-border divide-y divide-border overflow-hidden`.
  - Each row is `flex items-center gap-2.5 px-3 py-2.5`.
  - The text column is `flex min-w-0 flex-1 flex-col`:
    - the name is `text-ui text-fg` for a method with a button, `text-ui text-fg-secondary` for an explained one;
    - the description is `text-ui-sm text-fg-subtle`.
  - On the right:
    - a runnable method has `Button variant="outline"` with `text-fg` and no icon, reading `signInButtonLabel` or "Open setup in terminal";
    - an explained method has "In your shell" in `shrink-0 text-caption text-fg-subtle`.
- **Status line.** The always-mounted `role="status"` reads `flex min-w-0 flex-1 items-center gap-2 text-ui-sm`.
  - Idle with a returned message: an attention dot (`StatusLine status="attention"`), then "Your message will be sent again after you sign in." with a period, in `fg-secondary`.
  - The other states keep their copy and colours.
- **Setup card** (`isSetupOnly`):
  - Body "{agent} connects to a provider you pick in its own setup, and keeps the choice and the key in its settings."
  - Then a row `flex items-center gap-2`: `Button variant="outline"` with `text-fg` and a 14px `SquareTerminal`, reading "Open setup in terminal"; then "Already set up in {agent}? Check again." in `text-ui-sm text-fg-subtle`.
  - No action row on the title.
  - The footer's idle status reads "Not checked yet." in `fg-muted`. The footer's own "Already set up?" span goes.
- **Removed agent.** Copy unchanged. "Add {agent}" stays `primary` and moves to the action row with the card change.

- [ ] **Step 1: Write failing tests:**
  - "methods are a bordered list with outline buttons": `ul` named "Sign-in methods" has `divide-y`; "Log in with Google" has `border-border-strong` and no `svg`;
  - "In your shell sits at the row's end";
  - "the waiting line has an attention dot and ends with a period";
  - "the setup card opens the setup from its body": "Open setup in terminal" is an outline in the body, beside "Already set up in Qwen Code? Check again.", and the idle status reads "Not checked yet.";
  - "a setup method in the sign-in list keeps its own label": methods `[setup, oauth]` give a sign-in card whose setup row's button reads "Open setup in terminal".
- [ ] **Step 2: Run** `pnpm vitest run src/test/auth-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate** the copy in the test files listed under **Files** (the lead, the added period, "Already set up?"). Run them, plus `agent-sign-in-settings.test.tsx` if it pins the lead. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the sign-in, setup and removed-agent cards as on the canvas`.

### Task 6: The terminal dialog

**Files:**
- Modify: `src/components/TerminalSignInDialog.tsx`
- Test: `src/test/terminal-sign-in.test.tsx` (migrate and extend), `src/test/github-app.test.tsx:229-231` (still passes)

**Values** (`SignInDialog.dc.html`):
- **Dialog.** `flex w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 text-fg-secondary shadow-dialog`. The parts carry their own padding, so `p-5 gap-3` goes.
- **Header.** `flex items-center gap-2.5 px-5 py-4`:
  - a logo tile `flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-hover` holding `AgentLogo size={14}`, only with a `profileId`;
  - the title `h2 flex-1 text-base font-semibold text-fg`;
  - the X, `IconButton label="Cancel sign-in"` with a 14px `X`.
  - The method-name subtitle goes, for every kind, GitHub's "GitHub CLI" included.
- **Terminal.** `mx-5 flex h-[380px] overflow-hidden rounded-lg border border-border bg-terminal-bg px-4 py-3.5`, wrapping `TerminalView`.
- **Footer.** `flex items-center gap-3 px-5 py-4`:
  - the `role="status"` line moves here, `min-w-0 flex-1 text-ui-sm` in `text-fg-muted` (or `text-danger` on failure), with its copy unchanged;
  - then Close (`Button outline`, `text-fg`), then Try again (`primary`) after a failure.

- [ ] **Step 1: Write failing tests:**
  - "the title is 16/24 with no method line": the heading has `text-base`, and "Log in with Google" or "Qwen Code's own setup" is not in the dialog;
  - "the status sits left of Close in the footer": the status and Close share a parent;
  - "the terminal is padded 14/16".
- [ ] **Step 2: Run** `pnpm vitest run src/test/terminal-sign-in.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Focus handling, Escape and `useFocusTrap` are unchanged.
- [ ] **Step 4: Migrate** the method-name assertions (lines 322-323 and 380-381). Run it, plus `github-app.test.tsx` and `sign-in-layer.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the terminal dialog as on the canvas`.

### Task 7: The empty state and the update card

**Files:**
- Modify: `src/components/AppPlaceholders.tsx` (`EmptyFolderState`), `src/components/AppUpdateNotice.tsx`, `src/lib/app-update.ts` (`restartWarning`)
- Test: `src/test/new-session.test.tsx:50-57`, `src/test/app-update.test.tsx` (migrate and extend)

**Values** (`EmptyUpdate.dc.html`):
- **Empty state.**
  - Root `flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center`. The inner column is `flex max-w-[400px] flex-col items-center gap-4`.
  - Tile `flex size-12 items-center justify-center rounded-xl border border-border bg-surface-2`, holding a closed `Folder` at 22px in `text-fg-secondary`.
  - Text `flex flex-col gap-1.5`:
    - the heading is `h1 text-xl font-semibold tracking-[-0.02em] text-fg`;
    - the body is `text-ui text-fg-muted`, with its copy unchanged.
  - Button: `Button variant="primary" size="lg"` with a 14px `Plus` icon, reading "Open folder".
- **Update card.**
  - `w-[340px] flex flex-col gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 shadow-popover`, with `role="status"` kept.
  - Text `flex flex-col gap-1`:
    - the title is `text-ui font-semibold text-fg`;
    - the warning and progress lines are `text-ui-sm text-fg-muted`.
  - Buttons in `flex justify-end gap-2`: Later is `Button ghost tone="secondary" size="md"`, and Update & restart is `Button outline size="md"` with `text-fg`.
  - Placement is unchanged; see Rulings.
- **`restartWarning(workingAgents, openTerminals)`.** The counts are spelled out:
  - both: "Restarting stops {n} agent(s) mid-turn and {m} shell(s).";
  - agents only: "Restarting stops {n} agent(s) mid-turn.";
  - shells only: "Restarting stops {m} shell(s).";
  - neither: "".

- [ ] **Step 1: Write failing tests:**
  - "the empty state uses a closed folder and a 32px Open folder with a plus": the button has `h-8`, and the heading has `font-semibold`;
  - "the update card is surface-3 with a 600 title";
  - `restartWarning(2, 1)` is "Restarting stops 2 agents mid-turn and 1 shell.";
  - `restartWarning(1, 0)` is "Restarting stops 1 agent mid-turn.";
  - `restartWarning(0, 3)` is "Restarting stops 3 shells.".
- [ ] **Step 2: Run** `pnpm vitest run src/test/app-update.test.tsx src/test/new-session.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate** the `restartWarning` table and the card class assertions (line 75). Run them, plus `button-sizes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the empty state and the update card as on the canvas`.

### Task 8: Docs and changelog

**Files:**
- Modify:
  - `docs/design-system/components/BlockerCard/README.md`: the card's new values and each card's copy; add "Compare run" and "Empty window" sections there, since every component folder needs a `preview.html` and these have none;
  - `docs/design-system/components/BlockerCard/preview.html`: bring the preview in line with the README;
  - `docs/design-system/components/Dialog/README.md`, the terminal dialog;
  - `docs/design-system/components/Toast/README.md`, the update card;
  - `CHANGELOG.md`.

- [ ] **Step 1: Write the README sections** with the values from Tasks 1–7. Fix the BlockerCard README's stale "768px column (`max-w-3xl`)": the column is `max-w-chat`, 680px.
- [ ] **Step 2: Add the CHANGELOG lines** under Unreleased: "**A compare run, the cards that stand in the way, the sign-in terminal, the empty window and the update card look as designed:** each compare agent says how long it has worked ("Working · 12 min"), sign-in methods are listed with their own buttons, and the update card says what a restart stops ("2 agents mid-turn and 1 shell")."
- [ ] **Step 3: Run** `pnpm vitest run src/test/design-system-docs.test.ts`, then `pnpm lint`, `pnpm build` and the full `pnpm test` once. Expected: all green.
- [ ] **Step 4: Commit** `docs: describe the compare run, blocker cards, dialog, empty state and update card as drawn`.

---

## Rulings in this plan

- **The update card stays in the shared notice stack above the composer.**
  - The artboard puts it in the window's corner, 20/20. It draws the empty window, though, where the stack already sits in that corner, since there is no composer.
  - In a session the corner is the composer's Send button, and covering Send is worse than sitting 20px above it.
  - *Cost if wrong:* moving the stack's anchor.
- **The setup card names no providers.** The artboard lists Qwen Code's providers (QwenCloud, Alibaba ModelStudio, …). That list belongs to Qwen Code and changes with its releases, so the copy says "connects to a provider you pick in its own setup". *Cost if wrong:* one agent-specific sentence.
- **`cliHint` and `keysNote` stay on the sign-in card.** The artboard has neither. They are the only words for an agent that lists no method, and the only place that says Zorvo never stores keys. *Cost if wrong:* two sentences.
- **Elapsed time and its start.**
  - A working card counts from the session's start, `createdAt`, which is when the run started.
  - A finished card counts to its last finished reply with a known time.
  - Status words other than Working and Finished carry no time.
  - *Cost if wrong:* another start point (the current turn's), which no stored fact gives today.
- **"Done" becomes "Finished"**, as the artboard and the sidebar's "Finished, unread" say.
- **The confirm bar stays `role="group"`**, not the artboard's `dialog`: it is not modal, and the cards stay usable. *Cost if wrong:* none to the look.
- **The install line drops the trailing "…" only when it shows the size.** "Downloading Node.js · 18 of 42 MB" reads as a measure, and "Starting the install…" keeps its ellipsis.
