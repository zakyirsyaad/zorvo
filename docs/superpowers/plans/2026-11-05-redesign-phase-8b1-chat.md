# Redesign phase 8b1: the chat column as drawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat column (messages, tool cards, permission and question cards, the working, failed and stalled states, message actions and the Reply toolbar) matches the design canvas. Right-click no longer shows WebKit's default menu in release builds.

**Architecture:** This is a restyle of existing components under `src/components/chat/` and `src/components/`. It adds:
- three tokens: a 680px column, the selection colour, and `terminal-fg`;
- one data field: a permission card's edited files, parsed where the card is built;
- one small module that keeps WebKit's own menu out of release builds.

No behaviour changes except the right-click rules, the files a permission card lists, and the removed folder card.

**Tech Stack:** React 19, Tailwind 4 (tokens in `src/styles/globals.css`), Vitest + Testing Library (jsdom), lucide-react.

**Spec:**
- `docs/superpowers/specs/2026-11-05-canvas-conformance-audit.md`, section "8b", the chat parts only. The composer, draft, pickers and menus are 8b2; the full diff review moved to 8c.
- The artboards `Main` (chat column), `ChatStates` and `ChatCards` of the design canvas https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz. A local copy is under the session scratchpad's `artifact-files/16db2991-c883-48a8-8e2f-7e8548da3ca5/project/`.
- Behaviour: `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`.

## Global Constraints

- **Authority.** The artboard decides the look, the spec decides behaviour, and earlier explicit user choices stay. Functions the canvas does not draw are kept and restyled. Pure decoration goes, which here means the folder/branch card above the first message.
- **Primitives.** No raw colours in components (`design-tokens.test.ts`). Tokens change in `globals.css` and `docs/design-system/tokens.json` together (`design-system-docs.test.ts`). Use the `ui/` primitives, and give every focusable control `focus-ring`.
- **Sizes.** Button sizes come only from `size` (`sm` 24px / `md` 28px / `lg` 32px); a caller's className never carries `px-`, `py-` or `text-[…]` (`button-sizes.test.ts`). The artboard's 30px card buttons and 26px icon buttons fall between steps. They take `md` (28) and `IconButton size="sm"` (24), the nearest primitive step.
- **Copy.** Sentence case, short declarative sentences, "you", and agents named rather than "AI".
- **Type scale.** `text-body` 14/22, `text-ui` 13, `text-ui-sm` 12, `text-caption` 11.
- **The composer slot.** `ComposerDock` is never re-parented or re-keyed at runtime. Only its width class changes in this phase.
- **Light checks.** Run the named files while working, and the full suite once, in Task 7.
- **CHANGELOG.** One line under Unreleased.

## Review Focus

1. **A long unbroken path or command in a tool row** (a 200-character path, a command with no spaces). The row stays 30px, the path truncates, and the status word stays visible on the right. Task 3 pins it.
2. **Right-click in text fields and on selected text in a release build.** Copy, Paste and Undo still work there; a right-click on plain chrome shows nothing. Task 6 pins it.
3. **A permission request with no files, one file, or a file whose diff was too large to keep** (`changed`). The card shows only what it knows and never shows "+0 −0". Task 5 pins it.
4. **Hovering a message while a card inside it waits for an answer.** The message's hover fill must not hide the card's own fill or move its buttons. Task 2 pins it: the fill is on the agent message's text block only, not on cards.
5. **An imported session whose history stays in the agent** (`historyElsewhere`). With the folder card gone, the note still shows above the first message. Task 1 pins it.

---

### Task 1: The column, the canvas, and the folder card gone

**Files:**
- Modify:
  - `src/styles/globals.css`
  - `docs/design-system/tokens.json`
  - `src/components/ChatCanvas.tsx` (canvas padding, header and footer width, message gap)
  - `src/components/chat/MessageRow.tsx` (width only)
  - `src/components/chat/ReplyExtras.tsx` (width only)
  - `src/components/chat/AgentStallNotice.tsx` (width only)
  - `src/components/FailedTurnBanner.tsx` (width only)
  - `src/components/ComposerDock.tsx` (width only)
  - `src/components/RemovedAgentPanel.tsx`
  - `src/App.tsx` (the session header and the blockers wrapper)
  - `src/components/chat/HistoryElsewhereNote.tsx`
- Delete: `src/components/workspace/WorkspaceSummary.tsx` (its only importer is `App.tsx`)
- Test: `src/test/chat-canvas.test.tsx`, `src/test/design-tokens.test.ts`, and the App-level test that renders an open session (grep `historyElsewhere` in `src/test/`)

**Interfaces:**
- Produces:
  - `max-w-chat`, a Tailwind utility from `@theme { --container-chat: 680px; }`;
  - `::selection` using `--color-selection`;
  - `text-terminal-fg` from `--color-terminal-fg: #d4d4d8`. It has no light override, like `terminal-bg`, since the output panel stays dark in both themes.
  - Every later task uses `max-w-chat` for the column.

- [ ] **Step 1: Write the failing tests.**
  - **ChatCanvas:**
    - the scroller carries `pt-8 px-6 pb-4`, the artboard's `padding: 32px 24px 16px`;
    - messages sit `space-y-6` apart (`gap: 24px`);
    - the header and footer wrappers carry `max-w-chat`.
  - **MessageRow, WorkingIndicator, AgentStallNotice, FailedTurnBanner and the ComposerDock footer:** each carries `max-w-chat`, and none carries `max-w-3xl`.
  - **An open session in App:**
    - no folder name card above the first message (`queryByText` of the workspace path is null in the chat);
    - with `historyElsewhere`, the note's text still shows, with no `rounded-xl` card around it.
  - **globals.css** defines `--container-chat: 680px`, `--color-selection: rgba(161, 161, 170, 0.32)` and `--color-terminal-fg: #d4d4d8`, and a `::selection` rule reads `var(--color-selection)`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the three tokens to `@theme`, and to `tokens.json` (`size-chat-column` 680px; colour tokens `selection` and `terminal-fg`, each with the same value in both themes).
  - Add the `::selection` rule.
  - Swap `max-w-3xl` for `max-w-chat` in the files listed: the App blockers wrapper at the `SignInLayer` and `RemovedAgentPanel` call.
  - Remove the `header` card in `App.tsx` and the `WorkspaceSummary` import. Pass `header={activeSession.historyElsewhere ? <HistoryElsewhereNote … /> : undefined}`.
  - `HistoryElsewhereNote` becomes a quiet line: `text-ui-sm text-fg-muted`, no border or fill.
  - Delete `WorkspaceSummary.tsx`.
- [ ] **Step 4:** Run them, plus `src/test/design-system-docs.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the chat column is 680px, and the folder card above it is gone`.

### Task 2: Messages, their actions, and the Reply toolbar

**Files:**
- Modify:
  - `src/components/chat/MessageRow.tsx`
  - `src/components/chat/UserMessageBar.tsx`
  - `src/components/MessageActionBar.tsx`
  - `src/components/chat/SelectionToolbar.tsx`
- Test: `src/test/chat-canvas.test.tsx` (or the `MessageRow`/`MessageActionBar` tests; grep `UserMessageBar` and `MessageActionBar` in `src/test/`), `src/test/chat-selection*.test.tsx`

**Interfaces:**
- Consumes: `IconButton size="sm" tone="secondary"` (phase 8a).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests.** Values come from `ChatStates` and `ChatCards`.
  - **Your bubble:** `px-3.5 py-2.5 rounded-xl border border-border bg-surface-2 text-body text-fg`, at most 85% wide (`max-w-[85%]`). The bar under it shows Copy and Rewind on hover or focus and no time label (`queryByText` of the time is null under a user message).
  - **The agent header:**
    - the logo is 16px;
    - the name is `text-ui-sm font-medium text-fg-secondary` (12px/500);
    - the time is `text-caption text-fg-subtle`, with `gap-2` between them;
    - the header sits `mb-2.5` (10px) above the text.
  - **An agent message whose turn ended:**
    - its text block takes the hover fill: `group-hover:bg-surface-1` with `p-3 -mx-3 rounded-[10px]` (`padding: 12px; margin: 0 -12px; border-radius: 10px`);
    - the action icons are `IconButton size="sm" tone="secondary"` in the order Copy, Fork, then Read aloud where supported.
  - **Review Focus 4:** an agent message holding a pending `actionCard` puts the hover fill on its text block only. The card's own element never carries `bg-surface-1`.
  - **The Reply toolbar:** the panel is `p-0.5 rounded-lg border border-border bg-surface-3 shadow-popover`, and the Reply button is 28px (`h-7`), `text-ui text-fg`, with its icon before the label.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** the values above.
  - Rewind stays on your messages only. The artboard draws it on an agent message, but rewinding to a reply is behaviour the spec does not define (ruling).
  - The time stays in your message's tooltip (`title`) so it is not lost.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: messages, their actions and Reply as drawn`.

### Task 3: The tool card

**Files:**
- Modify:
  - `src/components/chat/ToolsPart.tsx`
  - `src/components/chat/ToolCallList.tsx`
  - `src/components/chat/ToolDetails.tsx` (the text output only)
- Test: `src/test/tool-call-list*.test.tsx` and `src/test/tools-part*.test.tsx` (grep `ToolsPart` and `ToolCallList` in `src/test/`)

**Interfaces:**
- Consumes: `text-terminal-fg` (Task 1).
- Produces: `lastTouchedLabel(tools: readonly ToolExecution[]): string | null` in `src/lib/tool-summary.ts`. It returns the last touched file as its last two path segments, plus " +N" for the other files touched, for example `"sidebar/SessionList.tsx +1"`; null when no tool names a file.

- [ ] **Step 1: Write the failing tests.** Values come from `Main` and `ChatStates`.
  - **The card:** `rounded-lg border border-border bg-surface-1 overflow-hidden`.
  - **The header:**
    - 34px (`h-[34px]`), `text-ui-sm text-fg-secondary`, chevron first;
    - on the right, "N still running" in `text-caption text-fg-subtle` while something runs, else `lastTouchedLabel` in `font-mono text-caption text-fg-subtle`;
    - a bottom border only while open.
  - **`lastTouchedLabel`:** `[read a/b/c/List.tsx, edit a/b/c/Row.tsx]` gives `"c/Row.tsx +1"`; a single file gives `"c/Row.tsx"`; no files gives `null`.
  - **A row:**
    - 30px (`h-7.5`), `gap-2 px-3 text-ui-sm`;
    - the verb in a `w-14 shrink-0 text-fg-muted` column (56px);
    - the path as one `font-mono text-caption` span holding the full path, with `truncate`;
    - no `h-px` divider between rows.
  - **Status:**
    - "Done" is `text-caption text-fg-subtle`, not `text-status-running`; "Failed" stays `text-danger`;
    - a running tool shows a `LoaderCircle` in `text-status-running` and the visible word "Running" in `text-caption text-status-running`;
    - the edit counts are `font-mono`.
  - **Command output:** `ml-[76px] mr-3 mb-2 rounded-md bg-terminal-bg px-2.5 py-2 font-mono text-caption leading-[17px] text-terminal-fg`, with no border.
  - **Review Focus 1:** a row with a 200-character path and status Running keeps `h-7.5`; the path span has `truncate min-w-0`, and the status span has `shrink-0`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** the values above.
  - "Exit 0 · 2.1 s" is not built: a `ToolExecution` records neither an exit code nor an end time, and adding them is data work outside 8b1 (ruling). A command row shows Done or Failed like the others.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the tool card as drawn`.

### Task 4: The failed turn, the working line and the stall notice

**Files:**
- Modify:
  - `src/components/FailedTurnBanner.tsx`
  - `src/components/chat/ReplyExtras.tsx` (`WorkingIndicator`)
  - `src/components/chat/AgentStallNotice.tsx`
- Test: `src/test/failed-turn*.test.tsx`, `src/test/agent-stall-notice.test.tsx`, and the `WorkingIndicator` test (grep `agent-working`)

**Interfaces:**
- Consumes: `Button size="md"` / `size="sm"`.

- [ ] **Step 1: Write the failing tests.** Values come from `ChatStates` and `ChatCards`.
  - **The failed turn:**
    - one row (`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-danger bg-danger-surface`);
    - a `CircleAlert` in `text-danger`;
    - the summary in `text-ui text-fg`;
    - **Try again** on the right as `Button variant="outline" size="md"` with its label in `text-fg`.
    - Details and Dismiss stay, after Try again. The details text opens under the row.
  - **The working line:**
    - the dot is `size-1.5 rounded-full bg-status-running ring-4 ring-status-running/20`;
    - `gap-2.5`;
    - the words are `text-ui text-fg-secondary`;
    - the time is `text-caption text-fg-subtle tabular-nums` and stays `aria-hidden`.
  - **The stall notice:**
    - `flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-surface-1`;
    - a `Clock` icon in `text-status-attention`;
    - the words are `text-ui text-fg-secondary`;
    - Stop is `Button variant="outline" size="sm"` with a `Square` icon.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** the values above. `WorkingIndicator` draws its own dot instead of `StatusLine`, because the ring is not one of `StatusLine`'s states.
- [ ] **Step 4:** Run them, plus `src/test/button-sizes.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the failed turn, the working line and the stall notice as drawn`.

### Task 5: The permission card and the question card

**Files:**
- Modify:
  - `src/types/index.ts` (`ActionCard.edits`)
  - `src/lib/acp-events.ts` (`applyPermissionRequest`)
  - `src/components/ActionCard.tsx`
  - `src/components/chat/ElicitationCard.tsx`
  - `src/components/chat/ElicitationFields.tsx` (labels and inputs)
- Test: `src/test/acp-events*.test.ts` (the permission request parsing), `src/test/action-card*.test.tsx`, `src/test/elicitation-card*.test.tsx` (grep each)

**Interfaces:**
- Produces:
  - `ActionCard.edits?: { path: string; added: number; removed: number }[]`, optional, so saved transcripts without it still load;
  - `editsOf(content: unknown): ActionCard["edits"]` in `src/lib/acp-events.ts`. It reads the request's `toolCall.content` through the same `toDetails` as tool calls:
    - a `diff` item counts its rows with `countChanges(diffRows(oldText, newText))`;
    - a `changed` item (a diff too large to keep) has no counts, so it is left out of `edits` and only its path shows;
    - undefined when there is nothing to list.

- [ ] **Step 1: Write the failing tests.**
  - **`applyPermissionRequest`:** a request whose `toolCall.content` holds two diffs gives `edits` with each path and its counts. A request with no content gives no `edits` key.
  - **The permission card** (values from `ChatCards`):
    - `flex flex-col gap-3 p-4 rounded-xl border border-attention-border bg-attention-surface`;
    - the title is `text-ui font-semibold text-fg`;
    - the edits list sits in `rounded-md border border-border bg-bg`, with one row per file: the path in `font-mono text-ui-sm text-fg-secondary`, then `+N` in `text-status-running` and `−N` in `text-danger`, both `font-mono text-caption`, and rows separated by `border-b border-border`;
    - the command snippet keeps its box (`rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-ui-sm`);
    - the buttons are right-aligned (`justify-end gap-2`), with no top border, no icons and `size="md"`, in the order Deny (ghost), Always allow (outline), Allow once (primary).
  - **Review Focus 3:** with `edits` of `[{path, added: 0, removed: 3}]` the row shows `−3` and no `+0`. With no `edits`, no list renders.
  - **The question card:**
    - `flex flex-col gap-3.5 p-4 rounded-xl border border-border-strong bg-surface-2`;
    - the agent's logo (16px, decorative) then "<Agent> needs a few details" in `text-ui font-semibold text-fg`, with the message under it in `text-ui text-fg-muted`;
    - labels are `text-ui font-medium text-fg-secondary`;
    - text inputs are `h-8 rounded-lg border border-border-strong bg-bg px-2.5`;
    - Decline (ghost) then Submit (primary), right-aligned, `size="md"`;
    - Dismiss stays, restyled as `IconButton size="sm"`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** the values above.
  - Which permission options map to Deny, Always allow and Allow once comes from the existing option kinds. Only their order, variants and icons change.
  - The question card's heading wording ("needs a few details") replaces the current heading only for a form request. A URL request keeps its own wording.
- [ ] **Step 4:** Run them, plus `src/test/persistence.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the permission and question cards as drawn, with an edit's files listed`.

### Task 6: Right-click

**Files:**
- Create: `src/lib/context-menu.ts`
- Modify:
  - `src/main.tsx` (install the guard in release builds)
  - `src/components/sidebar/SessionRow.tsx`
  - `src/components/sidebar/SessionMenu.tsx`
- Test: `src/test/context-menu.test.ts`, `src/test/session-row.test.tsx`

**Interfaces:**
- Produces:
  - `keepsNativeMenu(target: EventTarget | null, selectedText: string): boolean`. It is true when the target is inside an `input`, a `textarea` or a `[contenteditable]`, or when `selectedText.trim()` is not empty.
  - `installContextMenuGuard(doc: Document): () => void`. It adds a `contextmenu` listener that calls `preventDefault()` unless `keepsNativeMenu(event.target, doc.getSelection()?.toString() ?? "")`, and returns its removal.
  - `SessionMenu` takes optional `isOpen?: boolean` and `onOpenChange?: (open: boolean) => void`; uncontrolled when they are absent.

- [ ] **Step 1: Write the failing tests.**
  - **`keepsNativeMenu`:** true for an `input`, a `textarea`, a child of `[contenteditable="true"]`, and any element while text is selected. False for a plain `div` with no selection.
  - **`installContextMenuGuard`:** after install, a `contextmenu` event on a plain div is `defaultPrevented` and one on an input is not. After the returned removal runs, neither is prevented.
  - **The session row:** a `contextmenu` on the row opens its ⋯ menu (`getByRole("menu", { name: "Actions for <label>" })`) and is `defaultPrevented`. A right-click while renaming does nothing extra.
  - **`main.tsx`** installs the guard only when `import.meta.env.PROD` is true (a source assertion in `context-menu.test.ts`, as other tests read source), so dev builds keep Inspect Element.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
  - `SessionRow` owns the menu's open state and passes it to `SessionMenu`. The menu opens at its ⋯ button, which the collapsed actions show while a menu is open (`has-[[role=menu]]`).
  - Popout windows load `main.tsx` too, so they get the guard as well.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: right-click keeps WebKit's menu to text, and opens a session's actions`.

### Task 7: Docs, CHANGELOG, the full run, and a look in the app

**Files:**
- Modify:
  - `docs/design-system/components/Message/README.md` and `preview.html`
  - `docs/design-system/components/PermissionCard/README.md` and `preview.html`
  - `CHANGELOG.md`
- Test: `src/test/design-system-docs.test.ts`, the full suite

- [ ] **Step 1:** Update the two components' docs and previews to Tasks 2–5's values.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**The chat matches its design.** The conversation sits in a 680px column without the folder card above it; tool runs, permission and question cards, the working, failed and stalled states and message actions look as designed, and a permission to edit lists the files with their changed lines. Right-click shows the Mac's menu only for text, and on a session it opens that session's actions."
- [ ] **Step 3:** Run `pnpm lint`, then `pnpm test`, and read the last 20 lines. Expected: clean, and all pass. Migrate any tests that pinned old classes or copy, and record a ruling for each.
- [ ] **Step 4:** With `pnpm tauri dev` from this worktree, ask the user to compare a session with tool runs, a permission request, a question, a failed turn and a stalled turn against the `Main`, `ChatStates` and `ChatCards` artboards, in both themes, and to try right-click on a session, on chat text and in the composer. Record what they report.
- [ ] **Step 5:** Commit `docs: the chat column as drawn`.
